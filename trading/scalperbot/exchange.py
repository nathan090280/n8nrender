"""Exchange abstraction (plan G).

Two implementations behind one interface:
    PaperExchange  - fills simulated against live book prices with fee +
                     slippage modelling; used for paper trading and tests.
    LiveExchange   - KuCoin signed REST; real orders are always tracked to
                     a confirmed fill - submission is never assumed filled.

All orders carry a deterministic clientOid so retries can't double-fire.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field

from .utils import floor_to_increment, now_s

log = logging.getLogger("exchange")


@dataclass
class Fill:
    order_id: str
    client_oid: str
    symbol: str
    side: str
    qty: float
    avg_price: float
    fee: float
    slippage_pct: float
    ts: float = field(default_factory=time.time)
    status: str = "filled"            # filled | partial | open | cancelled


@dataclass
class Balance:
    currency: str
    available: float


class BaseExchange:
    mode = "base"

    async def buy_market(self, symbol: str, quote_amount: float,
                         client_oid: str | None = None) -> Fill: ...
    async def sell_market(self, symbol: str, qty: float,
                          client_oid: str | None = None) -> Fill: ...
    async def order_status(self, order_id: str) -> Fill: ...
    async def balances(self) -> dict[str, float]: ...
    async def account_totals(self) -> dict[str, dict[str, float]]:
        return {}
    async def base_balance(self, symbol: str) -> float: ...
    async def taker_fee_pct(self, symbol: str) -> float: ...
    async def recent_fills(self, symbol: str) -> list[dict]:
        return []


# ------------------------------------------------------------------- paper

class PaperExchange(BaseExchange):
    mode = "paper"

    def __init__(self, cfg, mds):
        self.cfg, self.mds = cfg, mds
        self._balances: dict[str, float] = {
            cfg.market.quote_currency: cfg.risk.starting_capital}
        self._orders: dict[str, Fill] = {}
        self._seen_oids: set[str] = set()

    async def taker_fee_pct(self, symbol: str) -> float:
        return getattr(self, "pair_fees", {}).get(
            symbol, self.cfg.execution.taker_fee_pct)

    def restore_holdings(self, positions) -> None:
        """Rebuild in-memory paper balances so restored stops remain sellable."""
        quote = self.cfg.market.quote_currency
        for pos in positions:
            base = pos.symbol.split("-")[0]
            self._balances[base] = self._balances.get(base, 0) + pos.qty
            self._balances[quote] -= (
                pos.qty * pos.entry_price + pos.fees_paid)

    def _book_px(self, symbol: str, side: str, quote_amount: float) -> tuple[float, float]:
        """Average fill price + slippage% walking the real book; falls back
        to last price + configured slippage when the book is empty."""
        st = self.mds.states.get(symbol)
        slip_cfg = self.cfg.execution.slippage_bps / 100
        if not st:
            return 0.0, 0.0
        book = st.asks if side == "buy" else st.bids
        if book:
            remaining, cost = quote_amount, 0.0
            if side == "sell":
                remaining, proceeds = quote_amount, 0.0   # qty for sells
                for p, s in book:
                    take = min(remaining, s)
                    proceeds += take * p
                    remaining -= take
                    if remaining <= 0:
                        break
                if remaining > 0:
                    return 0.0, 0.0
                return proceeds / quote_amount, 0.0
            for p, s in book:
                take = min(remaining, p * s)
                cost += take / p
                remaining -= take
                if remaining <= 0:
                    break
            if remaining > 0 or cost == 0:
                return 0.0, 0.0
            base = book[0][0]
            avg = quote_amount / cost
            slip = abs(avg - base) / base * 100
            return avg, slip
        px = st.last_price * (1 + slip_cfg / 100 * (1 if side == "buy" else -1))
        return px, slip_cfg

    async def buy_market(self, symbol, quote_amount, client_oid=None) -> Fill:
        oid = client_oid or uuid.uuid4().hex
        if oid in self._seen_oids:                       # dedupe (plan G)
            raise RuntimeError(f"duplicate client_oid {oid}")
        self._seen_oids.add(oid)
        px, slip = self._book_px(symbol, "buy", quote_amount)
        if px == 0:
            raise RuntimeError(f"{symbol}: book too thin to fill")
        fee = quote_amount * await self.taker_fee_pct(symbol) / 100
        if quote_amount + fee > self._balances.get(
                self.cfg.market.quote_currency, 0):
            raise RuntimeError("insufficient paper quote balance")
        qty = quote_amount / px
        self._balances[self.cfg.market.quote_currency] -= quote_amount + fee
        base = symbol.split("-")[0]
        self._balances[base] = self._balances.get(base, 0) + qty
        f = Fill(uuid.uuid4().hex, oid, symbol, "buy", qty, px, fee, slip)
        self._orders[f.order_id] = f
        return f

    async def sell_market(self, symbol, qty, client_oid=None) -> Fill:
        oid = client_oid or uuid.uuid4().hex
        if oid in self._seen_oids:
            raise RuntimeError(f"duplicate client_oid {oid}")
        self._seen_oids.add(oid)
        px, _ = self._book_px(symbol, "sell", qty)
        if px == 0:
            raise RuntimeError(f"{symbol}: book too thin to fill")
        base = symbol.split("-")[0]
        if qty > self._balances.get(base, 0) + 1e-12:
            raise RuntimeError(f"insufficient paper {base} balance")
        proceeds = qty * px
        fee = proceeds * await self.taker_fee_pct(symbol) / 100
        self._balances[base] = self._balances.get(base, 0) - qty
        self._balances[self.cfg.market.quote_currency] = \
            self._balances.get(self.cfg.market.quote_currency, 0) + proceeds - fee
        f = Fill(uuid.uuid4().hex, oid, symbol, "sell", qty, px, fee, 0.0)
        self._orders[f.order_id] = f
        return f

    async def order_status(self, order_id: str) -> Fill:
        return self._orders[order_id]

    async def balances(self) -> dict[str, float]:
        return dict(self._balances)

    async def account_totals(self) -> dict[str, dict[str, float]]:
        return {cur: {"available": amt, "holds": 0.0, "balance": amt}
                for cur, amt in self._balances.items()}

    async def base_balance(self, symbol: str) -> float:
        return self._balances.get(symbol.split("-")[0], 0.0)


# -------------------------------------------------------------------- live

class LiveExchange(BaseExchange):
    mode = "live"

    def __init__(self, cfg, priv, mds):
        self.cfg, self.priv, self.mds = cfg, priv, mds
        self._pending: dict[str, asyncio.Future] = {}
        self._fee_rates: dict[str, tuple[float, float]] = {}

    async def taker_fee_pct(self, symbol: str) -> float:
        cached = self._fee_rates.get(symbol)
        if cached and now_s() - cached[0] < 3600:
            return cached[1]
        fee = await self.priv.taker_fee_pct(symbol)
        self._fee_rates[symbol] = (now_s(), fee)
        return fee

    async def _inc(self, symbol: str) -> tuple[float, float, float, float]:
        """Exchange size, funds increments and minimums for this pair."""
        if not hasattr(self, "_incs"):
            self._incs = {}
        if symbol not in self._incs:
            symbols = await self.mds.rest.symbols()
            meta = next((s for s in symbols if s.get("symbol") == symbol), None)
            if not meta:
                raise RuntimeError(f"{symbol}: exchange symbol rules unavailable")
            self._incs[symbol] = (
                float(meta.get("baseIncrement") or 1e-8),
                float(meta.get("quoteIncrement") or 1e-8),
                float(meta.get("baseMinSize") or 0),
                float(meta.get("minFunds") or 0))
        return self._incs[symbol]

    async def buy_market(self, symbol, quote_amount, client_oid=None) -> Fill:
        oid = client_oid or uuid.uuid4().hex
        binc, qinc, bmin, min_funds = await self._inc(symbol)
        quote_amount = floor_to_increment(quote_amount, qinc)
        st = self.mds.states.get(symbol) if self.mds else None
        if not st or st.last_price <= 0:
            raise RuntimeError(f"{symbol}: cannot validate minimum without price")
        # Reserve room for market price movement, base fees and size rounding.
        min_quote = max(min_funds, (bmin + binc) * st.last_price * 1.05)
        if quote_amount < min_quote:
            raise RuntimeError(f"{symbol}: quote {quote_amount} below "
                               f"sellable minimum estimate {min_quote:.8f}")
        res = await self.priv.market_order(symbol, "buy", funds=quote_amount,
                                           client_oid=oid)
        return await self._await_fill(res["orderId"], oid, symbol, "buy",
                                      quote_amount)

    async def sell_market(self, symbol, qty, client_oid=None) -> Fill:
        oid = client_oid or uuid.uuid4().hex
        binc, _, _, _ = await self._inc(symbol)
        floored = floor_to_increment(qty, binc)
        qty = floored if floored > 0 else qty   # never floor a sell to zero
        res = await self.priv.market_order(symbol, "sell", size=qty,
                                           client_oid=oid)
        return await self._await_fill(res["orderId"], oid, symbol, "sell", qty)

    async def _settled_fee(self, order_id: str, order: dict,
                           symbol: str, qty: float, funds: float) -> float:
        """Order closure can precede publication of its fills and fees."""
        quote = self.cfg.market.quote_currency
        base = symbol.split("-")[0]
        avg = funds / qty if qty else 0

        def to_quote(value, currency):
            if currency == quote:
                return value
            if currency == base:
                return value * avg
            return None

        for attempt in range(5):
            raw_fee = float(order.get("fee") or 0)
            if raw_fee > 0:
                fee = to_quote(raw_fee, order.get("feeCurrency") or quote)
                if fee is not None:
                    return fee
            try:
                fills = await self.priv.fills(order_id=order_id)
                if fills and sum(float(f.get("size") or 0) for f in fills) \
                        >= qty * 0.999999:
                    converted = [to_quote(float(f.get("fee") or 0),
                                          f.get("feeCurrency") or quote)
                                 for f in fills]
                    if all(f is not None for f in converted) and \
                            sum(converted) > 0:
                        return sum(converted)
            except Exception as e:
                log.warning("fee fills unavailable for %s: %s", order_id, e)
            if attempt < 4:
                await asyncio.sleep(0.4)
                try:
                    order = await self.priv.get_order(order_id)
                except Exception as e:
                    log.warning("fee order poll failed for %s: %s", order_id, e)
        estimate = funds * self.cfg.execution.taker_fee_pct / 100
        log.warning("fee still unconfirmed for %s %s; using estimated "
                    "%.8f %s until reconciliation", symbol, order_id,
                    estimate, quote)
        return estimate

    async def _await_fill(self, order_id, client_oid, symbol, side,
                          requested) -> Fill:
        """Track the order until confirmed filled; never assume (plan G)."""
        timeout = now_s() + self.cfg.execution.order_timeout_sec
        while now_s() < timeout:
            try:
                o = await self.priv.get_order(order_id)
            except Exception as e:
                log.warning("order status poll failed: %s", e)
                await asyncio.sleep(0.5)
                continue
            if o.get("isActive") is False:
                qty = float(o.get("dealSize") or 0)
                funds = float(o.get("dealFunds") or 0)
                fee = await self._settled_fee(
                    order_id, o, symbol, qty, funds) if qty else 0.0
                avg = funds / qty if qty else 0
                st = self.mds.states.get(symbol)
                ref = st.last_price if st and st.last_price else avg
                slip = abs(avg - ref) / ref * 100 if ref else 0
                status = ("cancelled" if qty <= 0 else
                          "filled" if side == "buy" or qty >= requested * 0.999
                          else "partial")
                return Fill(order_id, client_oid, symbol, side, qty, avg,
                            fee, slip, status=status)
            await asyncio.sleep(0.4)
        # timeout: cancel and report actual partial fill
        try:
            await self.priv.cancel(order_id)
        except Exception as e:
            log.error("cancel failed for %s: %s", order_id, e)
        o = await self.priv.get_order(order_id)
        if o.get("isActive"):
            raise RuntimeError(
                f"{symbol} {side} order {order_id} still active after cancel; "
                "do not assume a final fill")
        qty = float(o.get("dealSize") or 0)
        funds = float(o.get("dealFunds") or 0)
        fee = await self._settled_fee(
            order_id, o, symbol, qty, funds) if qty else 0.0
        return Fill(order_id, client_oid, symbol, side, qty,
                    funds / qty if qty else 0,
                    fee, 0.0, status="partial" if qty else "cancelled")

    async def order_status(self, order_id: str) -> Fill:
        o = await self.priv.get_order(order_id)
        qty = float(o.get("dealSize") or 0)
        funds = float(o.get("dealFunds") or 0)
        fee = (await self._settled_fee(order_id, o, o["symbol"], qty, funds)
               if qty and not o.get("isActive") else 0.0)
        return Fill(order_id, o.get("clientOid", ""), o["symbol"],
                    o["side"], qty, funds / qty if qty else 0, fee, 0.0,
                    status="filled" if not o.get("isActive") else "open")

    async def balances(self) -> dict[str, float]:
        accs = await self.priv.accounts()
        return {a["currency"]: float(a["available"]) for a in accs}

    async def account_totals(self) -> dict[str, dict[str, float]]:
        accs = await self.priv.accounts()
        out = {}
        for a in accs:
            available = float(a.get("available") or 0)
            holds = float(a.get("holds") or 0)
            total = float(a.get("balance") or available + holds)
            out[a["currency"]] = {"available": available, "holds": holds,
                                  "balance": total}
        return out

    async def base_balance(self, symbol: str) -> float:
        accs = await self.priv.accounts(symbol.split("-")[0])
        if not accs:
            return 0.0
        a = accs[0]
        return float(a.get("balance") or
                     float(a.get("available") or 0) +
                     float(a.get("holds") or 0))

    async def recent_fills(self, symbol: str) -> list[dict]:
        return await self.priv.fills(symbol=symbol)
