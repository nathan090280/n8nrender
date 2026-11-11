"""Position management (plan D).

Stops are set at entry, may only move UP (for longs), and exit reasons are
checked on every live tick - not just candle close.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field

from .signals import signal_path

log = logging.getLogger("bot")


@dataclass
class Position:
    symbol: str
    qty: float                       # exchange-confirmed size
    entry_price: float
    entry_ts: float
    entry_oid: str
    fees_paid: float
    stop_price: float                # may only move up, never down
    take_price: float
    trail_activate_pct: float
    trail_offset_pct: float
    time_exit_sec: int
    max_hold_sec: int
    time_exit_gain_pct: float | None = None  # None = trail_activate_pct*0.3
    highest_px: float = 0.0
    trailing: bool = False
    exit_reason: str = ""
    trail_steps: list | None = None     # stepped ladder; None = flat trail
    meta: dict = field(default_factory=dict)
    next_exit_attempt_ts: float = 0.0
    momentum_hold: bool = False         # set per-tick; suspends time_exit

    def _tex_gain_gate(self) -> float:
        return (self.time_exit_gain_pct if self.time_exit_gain_pct is not None
                else self.trail_activate_pct * 0.3)

    def update(self, price: float, now: float) -> str | None:
        """Returns an exit reason or None. Called on every live tick."""
        self.highest_px = max(self.highest_px, price)
        if price <= self.stop_price:
            return "trailing_stop" if self.trailing else "stop_loss"
        steps = self.trail_steps or []
        if steps:
            # moon ladder: no fixed TP - tight lock near entry, wider as it runs
            gain = (price / self.entry_price - 1) * 100
            if not self.trailing and gain >= steps[0][0]:
                self.trailing = True
            if self.trailing:
                off = steps[0][1]
                for th, o in steps:
                    if gain >= th:
                        off = o
                new_stop = self.highest_px * (1 - off / 100)
                if new_stop > self.stop_price:
                    self.stop_price = new_stop
            held = now - self.entry_ts
            if held >= self.max_hold_sec and self.stop_price < self.entry_price:
                return "max_hold"          # still at risk; locked-BE rides free
            if held >= self.time_exit_sec and not self.momentum_hold \
                    and gain < self._tex_gain_gate():
                return "time_exit"
            return None
        if not self.trailing and price >= self.take_price:
            return "take_profit"
        held = now - self.entry_ts
        if self.trailing is False and held >= self.time_exit_sec \
                and not self.momentum_hold \
                and (price / self.entry_price - 1) * 100 < \
                self._tex_gain_gate():
            return "time_exit"        # failed to develop
        if held >= self.max_hold_sec and self.stop_price < self.entry_price:
            return "max_hold"
        # arm trailing once in profit
        gain = (price / self.entry_price - 1) * 100
        if not self.trailing and gain >= self.trail_activate_pct:
            self.trailing = True
            self._trail(price)
        elif self.trailing:
            self._trail(price)
        return None

    def _trail(self, price: float):
        new_stop = self.highest_px * (1 - self.trail_offset_pct / 100)
        # stops can only tighten - never widen to dodge a loss (plan D)
        if new_stop > self.stop_price:
            self.stop_price = new_stop


class PositionManager:
    def __init__(self, cfg, exchange, storage, bot_id: str = "main"):
        self.cfg, self.exchange, self.storage = cfg, exchange, storage
        self.bot_id = bot_id
        self.open: dict[str, Position] = {}       # symbol -> Position
        self._in_flight: set[str] = set()          # duplicate-entry guard
        self._exiting: set[str] = set()
        self.external_close = None                # async recovery callback

    def has_position(self, symbol: str) -> bool:
        return symbol in self.open or symbol in self._in_flight

    def any_open(self) -> bool:
        return bool(self.open)

    async def enter(self, signal, size_quote: float) -> Position | None:
        if signal.symbol in self.open or signal.symbol in self._in_flight:
            return None                            # no duplicates (plan D)
        self._in_flight.add(signal.symbol)
        try:
            if self.exchange.mode == "live":
                fee_pct = await self.exchange.taker_fee_pct(signal.symbol)
                if fee_pct > self.cfg.strategy.max_taker_fee_pct:
                    raise RuntimeError(
                        f"{signal.symbol}: taker fee {fee_pct:.2f}% exceeds "
                        f"{self.cfg.strategy.max_taker_fee_pct:.2f}% per-side cap")
            fill = await self.exchange.buy_market(
                signal.symbol, size_quote,
                client_oid=uuid.uuid4().hex)
            if fill.qty <= 0:
                return None
            self.storage.log_order({
                "symbol": signal.symbol, "side": "buy", "type": "market",
                "requested_qty": size_quote, "filled_qty": fill.qty,
                "avg_price": fill.avg_price, "fee": fill.fee,
                "status": fill.status,
                "client_oid": f"{self.bot_id}:{fill.client_oid}",
                "exchange_id": fill.order_id,
                "slippage_pct": fill.slippage_pct,
                "mode": self.exchange.mode})
            s = self.cfg.strategy
            path = signal_path(signal.reasons)
            steps = (s.knife_steps if path == "knife" else
                     (s.rhythm_trail_steps or s.trail_steps)
                     if path == "rhythm" else s.trail_steps)
            if path in ("claude", "swing") and signal.trail_steps:
                steps = signal.trail_steps
            planned_r = ((signal.price - signal.stop_price) / signal.price
                         if signal.price else 0)
            stop = (fill.avg_price * (1 - s.stop_loss_pct / 100)
                    if path == "new" else
                    fill.avg_price * (1 - planned_r)  # claude: same R off the fill
                    if path == "claude" else
                    signal.stop_price     # knife+swing: structural, no widening
                    if path in ("knife", "swing") else
                    min(signal.stop_price,
                        fill.avg_price * (1 - s.stop_loss_pct / 100)))
            pos = Position(
                symbol=signal.symbol, qty=fill.qty,
                entry_price=fill.avg_price, entry_ts=time.time(),
                entry_oid=fill.client_oid, fees_paid=fill.fee,
                # structural stop, but never tighter than stop_loss_pct
                # below the fill - shallow troughs caused 1-second stops
                stop_price=stop,
                take_price=signal.take_price,
                trail_activate_pct=s.trail_activate_pct,
                trail_offset_pct=s.trail_offset_pct,
                time_exit_sec=s.time_exit_sec, max_hold_sec=s.max_hold_sec,
                time_exit_gain_pct=s.time_exit_gain_pct,
                highest_px=fill.avg_price,
                trail_steps=steps,
                meta={"signal": signal.reasons, "bot": self.bot_id,
                      "expected_pct": signal.expected_profit_pct,
                      "planned_stop_pct": (1 - stop / fill.avg_price) * 100,
                      "first_rung_lock_pct": (steps[0][0] - steps[0][1]
                                              if steps else None)})
            self.open[signal.symbol] = pos
            self.storage.save_position(self.bot_id, pos)
            return pos
        finally:
            self._in_flight.discard(signal.symbol)

    async def exit(self, symbol: str, reason: str, last_price: float):
        pos = self.open.get(symbol)
        if pos is None or symbol in self._exiting:
            return None
        self._exiting.add(symbol)
        try:
            try:
                fill = await self.exchange.sell_market(
                    symbol, pos.qty, client_oid=uuid.uuid4().hex)
            except Exception as e:
                # An exchange rejection is not evidence that the coins are gone.
                # Reconcile against exchange balances independently.
                pos.next_exit_attempt_ts = time.time() + 60
                log.warning("sell failed for %s; keeping position: %s", symbol, e)
                return None
            if fill.qty <= 0 or fill.avg_price <= 0:
                pos.next_exit_attempt_ts = time.time() + 60
                log.warning("no confirmed sell fill for %s; keeping position", symbol)
                return None
            qty = min(fill.qty, pos.qty)
            entry_fee = pos.fees_paid * qty / pos.qty
            self.storage.log_order({
                "symbol": symbol, "side": "sell", "type": "market",
                "requested_qty": pos.qty, "filled_qty": fill.qty,
                "avg_price": fill.avg_price, "fee": fill.fee,
                "status": fill.status, "client_oid": fill.client_oid,
                "exchange_id": fill.order_id,
                "slippage_pct": fill.slippage_pct, "mode": self.exchange.mode})
            gross = qty * (fill.avg_price - pos.entry_price)
            fees = entry_fee + fill.fee
            trade = {"symbol": symbol, "side": "buy",
                     "entry_ts": pos.entry_ts, "exit_ts": time.time(),
                     "qty": qty, "entry_price": pos.entry_price,
                     "exit_price": fill.avg_price, "gross_pnl": gross,
                     "fees": fees, "net_pnl": gross - fees,
                     "exit_reason": reason, "mode": self.exchange.mode,
                     "meta": pos.meta}
            self.storage.log_trade(trade)
            pos.qty -= qty
            pos.fees_paid -= entry_fee
            if pos.qty <= 1e-10:
                del self.open[symbol]
                self.storage.delete_position(self.bot_id, symbol)
            else:
                pos.next_exit_attempt_ts = time.time() + 60
                self.storage.save_position(self.bot_id, pos)
            return trade
        finally:
            self._exiting.discard(symbol)

    # ----------------------------------------------- persistence
    def restore(self, rows: list[dict]):
        """Rebuild open positions after a restart (deploys never lose trades)."""
        import json as _j
        s = self.cfg.strategy
        for r in rows:
            if r["qty"] * r["entry_price"] < 0.5:      # dust crumb - purge it
                self.storage.delete_position(self.bot_id, r["symbol"])
                continue
            if not self.storage.claim_symbol(r["symbol"], self.bot_id):
                # another bot already manages it - drop the stale row
                self.storage.delete_position(self.bot_id, r["symbol"])
                continue
            p = Position(
                symbol=r["symbol"], qty=r["qty"],
                entry_price=r["entry_price"], entry_ts=r["entry_ts"],
                entry_oid="restored", fees_paid=r.get("entry_fee") or 0.0,
                stop_price=r["stop_price"], take_price=r["take_price"],
                trail_activate_pct=s.trail_activate_pct,
                trail_offset_pct=s.trail_offset_pct,
                time_exit_sec=s.time_exit_sec,
                max_hold_sec=s.max_hold_sec,
                time_exit_gain_pct=s.time_exit_gain_pct,
                highest_px=r.get("trail_high") or r["entry_price"],
                trailing=bool(r.get("trailing")),
                trail_steps=(_j.loads(r["trail_steps"])
                             if r.get("trail_steps") is not None else None),
                meta=_j.loads(r.get("meta") or "{}"))
            p.no_exit = bool(r.get("no_exit"))
            self.open[p.symbol] = p
        if rows:
            log.info("restored %d open position(s)", len(rows))

    def adopt(self, symbol: str, qty: float, entry_price: float,
              entry_ts: float | None = None) -> "Position":
        """Take an orphaned exchange holding into management - it gets the
        same stop/target/time exits as a normal entry."""
        s = self.cfg.strategy
        if qty * entry_price < 0.5:      # dust crumb - not a position
            return None
        pos = Position(
            symbol=symbol, qty=qty, entry_price=entry_price,
            entry_ts=entry_ts or time.time(), entry_oid="adopted",
            fees_paid=0.0,
            stop_price=entry_price * (1 - s.stop_loss_pct / 100),
            take_price=entry_price * (1 + s.take_profit_pct / 100),
            trail_activate_pct=s.trail_activate_pct,
            trail_offset_pct=s.trail_offset_pct,
            time_exit_sec=s.time_exit_sec, max_hold_sec=s.max_hold_sec,
            time_exit_gain_pct=s.time_exit_gain_pct,
            highest_px=entry_price,
            meta={"signal": ["adopted-orphan"], "bot": self.bot_id})
        self.open[symbol] = pos
        self.storage.save_position(self.bot_id, pos)
        return pos

    async def reconcile(self):
        """Internal position state vs exchange balances (plan D/G)."""
        mismatches = []
        for sym, pos in list(self.open.items()):
            try:
                bal = await self.exchange.base_balance(sym)
            except Exception:
                continue
            if bal * (pos.entry_price or 1) < 0.5:
                # dust crumb (or zero balance) - drop it, can't be sold anyway
                mismatches.append((sym, pos.qty, 0))
                if self.external_close:
                    await self.external_close(pos, bal)
                self.open.pop(sym, None)
                self.storage.delete_position(self.bot_id, sym)
                self.storage.release_symbol(sym, self.bot_id)
            elif bal < pos.qty * 0.95:
                mismatches.append((sym, pos.qty, bal))
                if self.external_close:
                    await self.external_close(pos, bal)
                pos.qty = bal                     # track confirmed size
        return mismatches
