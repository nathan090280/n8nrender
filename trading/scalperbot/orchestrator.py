"""Bot orchestrator: wires sections A-J into the run loop.

Loops:
    scan_loop      - discover + rank universe (A)
    decision_loop  - signal eval, entries, position management, switching
                     (C/D/E), tick-driven via short interval
    refresh_loop   - candle + book refresh for tracked symbols (B)
    reconcile_loop - position state vs exchange, equity snapshots (D/G/H)

Safety (F): every decision passes RiskManager.can_trade; live mode is
blocked until backtest + paper qualification is recorded (plan J).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import Counter, deque
from pathlib import Path
from types import SimpleNamespace

import aiohttp

from .analyst import AIAnalyst
from .config import Config
from .dashboard import Dashboard
from .exchange import BaseExchange, LiveExchange, PaperExchange
from .kucoin_private import KucoinPrivateREST
from .kucoin_public import KucoinPublicREST, KucoinWebSocket
from .market_data import MarketDataService
from .notifier import Notifier
from .new_bot import NewStrategy, summarize
from .claude_bot import ClaudeStrategy, summarize as claude_summarize
from .swing_bot import SwingStrategy, summarize as swing_summarize, \
    split_bars as split_bars_s

CLAUDE_BOTS = ("claude", "claude15")
SWING_BOTS = ("swing",)


def _bars(rows) -> list[ind.Candle]:
    return [ind.Candle(ts=int(r[0]) * 1000, open=float(r[1]),
                       close=float(r[2]), high=float(r[3]),
                       low=float(r[4]), volume=float(r[5])) for r in rows]
from .performance import compute
from .positions import PositionManager
from .risk import RiskManager
from .scanner import Scanner, Candidate
from . import indicators as ind
from .market_data import SymbolState
from .signals import SignalEngine, signal_path
from .storage import Storage
from .switcher import Switcher
from .utils import now_ms

log = logging.getLogger("bot")


class Bot:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.status = "starting"
        self.explain_log: deque[str] = deque(maxlen=60)
        self.storage = Storage(cfg.db_path)
        self.risk = RiskManager(cfg)
        self.session: aiohttp.ClientSession | None = None
        self.rest: KucoinPublicREST | None = None
        self.priv: KucoinPrivateREST | None = None
        self.ws: KucoinWebSocket | None = None
        self.mds: MarketDataService | None = None
        self.scanner: Scanner | None = None
        self.engine = SignalEngine(cfg)
        self.switcher = Switcher(cfg)
        self.exchange: BaseExchange | None = None
        self.pm: PositionManager | None = None
        self.notifier = Notifier(cfg.notify_webhook)
        self.analyst = AIAnalyst(cfg)
        self.ai_analysis = "AI analyst: pending"
        self.dashboard = Dashboard(cfg, self)
        self._stop = asyncio.Event()
        self.fees_today = 0.0
        self.real_total = 0.0
        self.real_total_complete = False  # true when valued from exchange rows
        self._quote_px_cache = (0.0, {})   # all-ticker quote valuation cache
        self.margin_total = 0.0           # margin account equity (display)
        self._kp2 = None                  # lazily built margin-key client
        self._margin_ts = 0.0
        self.bot_id = os.environ.get("BOT_NAME", "main")
        self.dashboard_only = (
            os.environ.get("TRADING_DASHBOARD_ONLY") == "true")
        self.rhythm_cands: list[dict] = []
        self.knife_cands: list[dict] = []
        self.knife_watch: set[str] = set()
        self.new_watch: set[str] = set()
        self.new_strategy = NewStrategy(cfg)
        self.new_candidates: list[dict] = []
        self.new_scan_info: dict = {}
        self.new_macro_ts: dict[str, float] = {}
        self.new_market_macro: list[ind.Candle] = []
        self._mkt_shock = False          # BTC panic -> relaxed rhythm bulls
        self._mkt_shock_ts = 0.0
        self.new_market_ts = 0.0
        self.new_fee_rates: dict[str, tuple[float, float]] = {}
        self.young_ban: set[str] = set()     # listings <min_listing_age_days
        self.claude = ClaudeStrategy(cfg)
        self.claude_watch: set[str] = set()
        self.claude_candidates: list[dict] = []
        self.claude_info: dict = {}
        self.claude_htf: dict[str, tuple[float, list[ind.Candle]]] = {}
        self.claude_btc: list[ind.Candle] = []
        self.claude_btc_ts = 0.0
        self.claude_breadth: float | None = None
        self.claude_fees: dict[str, tuple[float, float]] = {}
        self.swing = SwingStrategy(cfg)
        self.swing_watch: set[str] = set()
        self.swing_candidates: list[dict] = []
        self.swing_info: dict = {}
        self.swing_htf: dict[str, tuple[float, list[ind.Candle]]] = {}
        self.swing_btc: list[ind.Candle] = []
        self.swing_btc_ts = 0.0
        self.swing_breadth: float | None = None
        self.swing_fees: dict[str, tuple[float, float]] = {}
        # standalone-bot armour for the swing path
        self._swing_day = {"net": 0.0, "n": 0, "closes_10m": 0,
                           "wins": 0, "losses": 0}
        self._swing_day_ts = 0.0
        self._swing_panic_until = 0.0
        self.swing_day_loss_cap = float(os.environ.get(
            "SWING_DAY_LOSS_CAP", -1.0))
        self.swing_max_trades = 12
        self._cfg_mtime = 0.0
        self.btc_1h_pct: float | None = None   # momentum gate for long paths
        self.btc_1h_ts = 0.0
        self._cd: dict = {}             # symbol -> re-entry blocked until ts
        self.knife_cd: dict = {}        # symbol -> knife re-entry blocked until
        self._age_cache: dict = {}      # symbol -> age-check result + expiry
        self._errors: deque = deque(maxlen=8)
        class _Err(logging.Handler):
            def emit(_, rec):
                self._errors.appendleft(
                    f"{time.strftime('%H:%M')} {rec.getMessage()[:110]}")
        logging.getLogger("scalperbot").addHandler(_Err())
        self.rhythm_scanning = False
        self.rhythm_scan_info: dict = {}
        self.rhythm_watch: dict[str, float] = {}   # sym -> watch start ts
        self.rhythm_flow_watch: set[str] = set()
        # sym -> last scan ts it qualified for live match ticks; keeps
        # subscriptions alive across rank churn so ticks accumulate
        self._flow_watch_since: dict[str, float] = {}
        self._macro_cache: dict[str, tuple[float, list[ind.Candle]]] = {}
        self.day = time.strftime("%Y-%m-%d", time.gmtime())

    # -------------------------------------------------------------- explain
    def say(self, msg: str):
        line = f"{time.strftime('%H:%M:%S')} {msg}"
        log.info(msg)
        self.explain_log.appendleft(line)

    async def _ensure_macro(self, st: SymbolState):
        if self.cfg.market.candle_interval != "1min":
            return
        cached = self._macro_cache.get(st.symbol)
        if cached and time.time() - cached[0] < 600:
            st.macro_candles = cached[1]
            return
        try:
            rows = await self.rest.candles(st.symbol, "15min")
            bars = [ind.Candle(ts=int(r[0]) * 1000, open=float(r[1]),
                               close=float(r[2]), high=float(r[3]),
                               low=float(r[4]), volume=float(r[5]))
                    for r in rows]
            st.macro_candles = bars
            self._macro_cache[st.symbol] = (time.time(), bars)
        except Exception as e:
            st.macro_candles = []  # no history -> fail closed, not blind
            log.warning("12h candles unavailable for %s: %s", st.symbol, e)

    # -------------------------------------------------- account valuation
    async def _quote_prices(self) -> dict[str, float]:
        """Base currency -> quote-currency prices, cached briefly."""
        quote = self.cfg.market.quote_currency
        ts, cached = self._quote_px_cache
        if time.time() - ts < 60:
            return cached
        prices = {quote: 1.0}
        try:
            tickers = await self.rest.all_tickers()
            for t in tickers:
                sym = t.get("symbol", "")
                if not sym.endswith("-" + quote):
                    continue
                px = float(t.get("last") or t.get("buy") or
                           t.get("sell") or 0)
                if px > 0:
                    prices[sym.split("-", 1)[0]] = px
        except Exception as e:
            log.warning("quote price refresh failed: %s", e)
        for sym, st in (self.mds.states.items() if self.mds else []):
            try:
                base, q = sym.split("-", 1)
                if q == quote and st.last_price > 0:
                    prices[base] = st.last_price
            except Exception:
                continue
        self._quote_px_cache = (time.time(), prices)
        return prices

    async def _spot_total(self, fallback: float) -> tuple[float, bool]:
        """Total spot account value, including held + unmanaged balances."""
        quote = self.cfg.market.quote_currency
        try:
            totals = await self.exchange.account_totals()
            if totals is None:
                raise RuntimeError("account totals unavailable")
            prices = await self._quote_prices()
            total, complete = 0.0, True
            for cur, row in totals.items():
                amt = (row.get("balance") if isinstance(row, dict)
                       else float(row or 0))
                if amt <= 0:
                    continue
                if cur == quote:
                    total += amt
                    continue
                px = prices.get(cur, 0.0)
                if px > 0:
                    total += amt * px
                    continue
                pos = (self.pm.open.get(f"{cur}-{quote}")
                       if self.pm else None)
                if pos:
                    total += min(amt, pos.qty) * pos.entry_price
                else:
                    complete = False
            return total, complete
        except Exception as e:
            log.warning("spot valuation fallback: %s", e)
            return fallback, False

    def _estimate_exit_price(self, symbol: str, entry_price: float,
                             high: float = 0.0) -> float:
        st = self.mds.states.get(symbol) if self.mds else None
        return (st.last_price if st and st.last_price > 0 else
                high or entry_price)

    async def _fee_to_quote(self, fee: float, currency: str, base: str,
                            avg: float, prices: dict) -> float | None:
        quote = self.cfg.market.quote_currency
        if fee <= 0:
            return 0.0
        if currency == quote:
            return fee
        if currency == base:
            return fee * avg
        px = prices.get(currency, 0.0)
        return fee * px if px > 0 else None

    async def _sale_fill(self, symbol: str, entry_ts: float, qty: float,
                         est_px: float) -> tuple[float, float, float, str]:
        """Best available avg exit price/fee for an externally missing sale."""
        need, funds, fees, exit_ts, source = qty, 0.0, 0.0, 0.0, "estimate"
        orders = self.storage.orders_since(symbol, "sell", entry_ts - 1)
        for o in reversed(orders):
            take = min(need, float(o["filled_qty"] or 0))
            if take <= 0:
                continue
            avg = float(o["avg_price"] or 0)
            funds += take * avg
            fees += float(o["fee"] or 0) * take / float(o["filled_qty"])
            exit_ts = max(exit_ts, float(o["ts"] or 0))
            need -= take
            source = "orders"
            if need <= 1e-10:
                break
        if need > 1e-10:
            try:
                fills = await self.exchange.recent_fills(symbol)
            except Exception:
                fills = []
            prices = await self._quote_prices()
            base = symbol.split("-", 1)[0]
            rows = sorted(
                (f for f in fills if f.get("side") == "sell" and
                 float(f.get("size") or 0) > 0 and
                 float(f.get("createdAt") or 0) / 1000 >= entry_ts - 1),
                key=lambda f: float(f.get("createdAt") or 0), reverse=True)
            for f in rows:
                take = min(need, float(f.get("size") or 0))
                if take <= 0:
                    continue
                size = float(f.get("size") or take)
                avg = float(f.get("funds") or 0) / size if size else \
                    float(f.get("price") or est_px)
                funds += take * avg
                fq = await self._fee_to_quote(
                    float(f.get("fee") or 0), f.get("feeCurrency") or "",
                    base, avg, prices)
                fees += (fq if fq is not None else
                         take * avg * self.cfg.execution.taker_fee_pct / 100)
                exit_ts = max(exit_ts,
                              float(f.get("createdAt") or 0) / 1000)
                need -= take
                source = "exchange-fills"
                if need <= 1e-10:
                    break
        if need > 1e-10:
            funds += need * est_px
            fees += need * est_px * self.cfg.execution.taker_fee_pct / 100
        avg = funds / qty if qty else est_px
        return avg, fees, exit_ts or time.time(), source

    async def _external_position_close(self, pos, remaining_qty: float,
                                       subtract_logged: bool = False):
        """Record a close the exchange shows but the ledger missed."""
        remaining_qty = max(0.0, remaining_qty)
        sold_qty = max(0.0, pos.qty - remaining_qty)
        if subtract_logged:
            logged = sum(
                float(t["qty"] or 0)
                for t in self.storage.trades(
                    mode=self.cfg.execution.mode, since=pos.entry_ts - 1)
                if t["symbol"] == pos.symbol)
            sold_qty = max(0.0, sold_qty - logged)
        remaining_row_qty = (remaining_qty
                             if remaining_qty * pos.entry_price >= 0.5 else 0.0)
        entry_fee = (pos.fees_paid * sold_qty / pos.qty
                     if pos.qty > 0 else 0.0)
        remaining_fee = (pos.fees_paid - entry_fee
                         if remaining_row_qty > 0 else 0.0)
        if sold_qty <= 1e-10:
            self.storage.settle_position(
                self.bot_id, pos.symbol, None, remaining_row_qty,
                remaining_fee)
            return remaining_row_qty, remaining_fee
        est_px = self._estimate_exit_price(
            pos.symbol, pos.entry_price, getattr(pos, "highest_px", 0.0))
        avg, exit_fee, exit_ts, source = await self._sale_fill(
            pos.symbol, pos.entry_ts, sold_qty, est_px)
        meta = dict(getattr(pos, "meta", {}) or {})
        meta.setdefault("bot", self.bot_id)
        meta["recovered"] = source
        gross = sold_qty * (avg - pos.entry_price)
        fees = entry_fee + exit_fee
        trade = {"symbol": pos.symbol, "side": "buy",
                 "entry_ts": pos.entry_ts, "exit_ts": exit_ts,
                 "qty": sold_qty, "entry_price": pos.entry_price,
                 "exit_price": avg, "gross_pnl": gross,
                 "fees": fees, "net_pnl": gross - fees,
                 "exit_reason": "recovered_external", "mode": self.exchange.mode,
                 "meta": meta}
        self.storage.settle_position(
            self.bot_id, pos.symbol, trade, remaining_row_qty, remaining_fee)
        pos.fees_paid = remaining_fee
        self.risk.on_trade_close(trade["net_pnl"])
        self.fees_today += exit_fee
        self.say(f"RECOVERED {pos.symbol}: qty={sold_qty:.6f} @{avg:.6f} "
                 f"net={trade['net_pnl']:+.4f} ({source})")
        return remaining_row_qty, remaining_fee

    async def _recover_position_row(self, row: dict, held: float):
        pos = SimpleNamespace(
            symbol=row["symbol"], qty=float(row["qty"] or 0),
            entry_price=float(row["entry_price"] or 0),
            entry_ts=float(row["entry_ts"] or time.time()),
            fees_paid=float(row.get("entry_fee") or 0),
            highest_px=float(row.get("trail_high") or row["entry_price"] or 0),
            meta=json.loads(row.get("meta") or "{}"))
        return await self._external_position_close(
            pos, held, subtract_logged=True)

    # -------------------------------------------------------------- startup
    async def start(self):
        cfg = self.cfg
        if cfg.execution.mode == "live" and not self._qualified():
            raise RuntimeError(
                "Live trading is gated (plan J): run `python main.py backtest` "
                "and a paper session first; see state/qualification.json")
        if cfg.execution.mode == "live" and not cfg.has_credentials:
            raise RuntimeError("Live mode needs KUCOIN_API_KEY/SECRET/"
                               "PASSPHRASE env vars")

        self.session = aiohttp.ClientSession()
        self.notifier.session = self.session
        self.analyst.session = self.session
        self.rest = KucoinPublicREST(cfg.market.base_url, self.session)
        self.ws = KucoinWebSocket(self.rest, lambda *a: None,
                                  on_state=self._ws_state)
        self.mds = MarketDataService(self.rest, self.ws, cfg)
        self.scanner = Scanner(cfg, self.mds)
        if cfg.execution.mode == "live":
            self.priv = KucoinPrivateREST(
                cfg.market.base_url, cfg.api_key, cfg.api_secret,
                cfg.api_passphrase, self.session)
            self.exchange = LiveExchange(cfg, self.priv, self.mds)
        else:
            self.exchange = PaperExchange(cfg, self.mds)
        if self.bot_id in ("new",) + CLAUDE_BOTS and \
                cfg.execution.mode == "paper" and cfg.has_credentials:
            self.priv = KucoinPrivateREST(
                cfg.market.base_url, cfg.api_key, cfg.api_secret,
                cfg.api_passphrase, self.session)
        self.pm = PositionManager(cfg, self.exchange, self.storage,
                                  bot_id=self.bot_id)
        self.pm.external_close = self._external_position_close
        # live mode: seed risk state from the REAL account, not config capital
        if cfg.execution.mode == "live":
            bals = await self.exchange.balances()
            free = bals.get(cfg.market.quote_currency, 0.0)
            self.real_total, self.real_total_complete = await self._spot_total(
                free + self.storage.open_value())
            real = self.real_total * cfg.risk.allocation_pct / 100
            log.info("live balance (allocated): %.2f %s, free %.2f", real,
                     cfg.market.quote_currency, free)
            r = self.risk
            r.account_total = self.real_total
            r.start_equity = r.equity = \
                r.day_start_equity = r.peak_equity = real
            r.cash = free             # sizing sees the whole free pot
        await self.scanner.refresh_universe()
        await self.dashboard.start()
        self.storage.event("info", "startup", f"mode={cfg.execution.mode}")
        self.say(f"started in {cfg.execution.mode} mode")

    def _qualified(self) -> bool:
        p = Path(self.cfg.qualification_file)
        if not p.exists():
            return False
        try:
            q = json.loads(p.read_text())
            return bool(q.get("backtest_done") and q.get("paper_done"))
        except Exception:
            return False

    def _ws_state(self, state: str):
        if state == "down" and not self._stop.is_set():
            self.say("websocket down - reconnecting (no new entries meanwhile)")

    def emergency_stop(self, reason: str):
        """Plan F: halt new orders; positions keep their exit logic active."""
        self.risk.halt(reason)
        self.storage.event("critical", "halt", reason)
        asyncio.ensure_future(
            self.notifier.critical("halt", f"emergency stop: {reason}"))

    # ---------------------------------------------------------------- loops
    async def run(self):
        self.status = "scanning"
        ws_task = asyncio.create_task(self.ws.run())
        # restore positions persisted before the last restart
        rows = self.storage.load_positions(self.bot_id)
        if self.cfg.execution.mode == "live":
            try:
                totals = await self.exchange.account_totals()
                balances = {cur: row.get("balance", row.get("available", 0))
                            for cur, row in totals.items()}
                keep = []
                for row in rows:
                    held = balances.get(row["symbol"].split("-")[0], 0)
                    if held >= row["qty"] * 0.95:
                        keep.append(row)
                    else:
                        remaining, fee = await self._recover_position_row(
                            row, held)
                        if remaining > 0:
                            row["qty"], row["entry_fee"] = remaining, fee
                            keep.append(row)
                        else:
                            self.storage.release_symbol(
                                row["symbol"], self.bot_id)
                rows = keep
            except Exception as e:
                log.warning("balance check failed at restore: %s; "
                            "preserving DB positions until exchange recovers", e)
        self.pm.restore(rows)
        if self.cfg.execution.mode == "paper":
            self.exchange.restore_holdings(self.pm.open.values())
        # adopt orphaned exchange bags our own orders bought (deploy-proof)
        if self.cfg.execution.mode == "live":
            try:
                bals = await self.exchange.balances()
                for cur, amt in (bals or {}).items():
                    if cur == self.cfg.market.quote_currency or amt <= 0:
                        continue
                    sym = f"{cur}-{self.cfg.market.quote_currency}"
                    if sym in self.pm.open:
                        continue
                    buy = self.storage.latest_buy(sym, self.bot_id)
                    if not buy:
                        continue          # foreign dust, not ours
                    # the bag must actually match our recorded fill —
                    # another bot's position must never be adopted under
                    # our stale buy price
                    filled = float(buy["filled_qty"])
                    if filled <= 0 or abs(amt - filled) / filled > 0.15:
                        log.info("orphan %s qty %.6f doesn't match our last "
                                 "buy %.6f — leaving unclaimed",
                                 sym, amt, filled)
                        continue
                    if not self.storage.claim_symbol(sym, self.bot_id):
                        continue          # the other bot already has it
                    pos = self.pm.adopt(sym, amt,
                                        buy["avg_price"], buy.get("ts"))
                    if pos:
                        self.say(f"ADOPTED orphan {sym} qty={pos.qty:.6f} "
                                 f"@ {pos.entry_price:.6f}")
                    else:
                        self.storage.release_symbol(sym, self.bot_id)
            except Exception as e:
                log.warning("orphan adoption: %s", e)
        # seed daily counters from the order log so restarts don't zero them
        try:
            ts0 = time.time() - (time.time() % 86400)
            cnt, fees = self.storage.day_order_stats(self.bot_id, ts0)
            self.risk.trades_today = cnt
            self.fees_today = fees
            self.risk.day_realized = self.storage.day_realized(
                self.bot_id, ts0, self.cfg.execution.mode)
        except Exception as e:
            log.warning("counter seed: %s", e)
        # subscribe live ticks for every managed position (restored/adopted)
        if self.pm.open:
            try:
                self._subscribe_active()
            except Exception as e:
                log.warning("subscribe open: %s", e)
        if self.bot_id in CLAUDE_BOTS:
            self._seed_claude_streaks()
        if self.bot_id in SWING_BOTS:
            self._seed_swing_streaks()
        jobs = ((self.decision_loop, self.refresh_loop,
                 self.reconcile_loop, self.new_bot_loop)
                if self.bot_id == "new" else
                (self.decision_loop, self.refresh_loop,
                 self.reconcile_loop, self.claude_loop)
                if self.bot_id in CLAUDE_BOTS else
                (self.decision_loop, self.refresh_loop,
                 self.reconcile_loop, self.swing_loop)
                if self.bot_id in SWING_BOTS else
                (self.scan_loop, self.decision_loop,
                 self.refresh_loop, self.reconcile_loop,
                 self.rhythm_loop, self.rhythm_watch_loop))
        loops = [asyncio.create_task(t()) for t in jobs]
        # AI analysis is on-demand only (dashboard button) - no auto-spam
        try:
            await self._stop.wait()
        finally:
            self.status = "stopping"
            await self._graceful_exit()
            for t in loops:
                t.cancel()
            await self.ws.stop()
            ws_task.cancel()
            await self.session.close()
            self.storage.close()
            self.status = "stopped"

    def stop(self):
        self._stop.set()

    async def _graceful_exit(self):
        self.say("shutting down - positions left with exchange-side state; "
                 "restart re-loads open positions from DB")
        self.storage.event("info", "shutdown", "graceful")

    def _subscribe_active(self):
        syms = (set(self.pm.open) | set(self.rhythm_watch)
                | self.rhythm_flow_watch | self.knife_watch | self.new_watch
                | self.claude_watch | self.swing_watch
                | {c.symbol for c in self.scanner.candidates}
                | {c["symbol"] for c in self.knife_cands})
        self.mds.subscribe_symbols(sorted(syms))

    # Claude ------------------------------------------------------------
    def _seed_claude_streaks(self):
        """Rebuild per-coin loss streaks/cooldowns so restarts keep them."""
        try:
            for t in self.storage.trades(mode=self.cfg.execution.mode):
                meta = json.loads(t["meta"] or "{}")
                if meta.get("bot") == self.bot_id:
                    until = self.claude.record(t["symbol"], t["net_pnl"],
                                               t["exit_ts"])
                    if until > time.time():
                        self._cd[t["symbol"]] = until
                    else:
                        self._cd.pop(t["symbol"], None)
        except Exception as e:
            log.warning("claude streak seed: %s", e)

    async def claude_loop(self):
        """Claude's own signal loop; money movement stays in Bot/PM."""
        p = self.claude.p
        last_universe = 0.0
        while not self._stop.is_set():
            try:
                if not self.cfg.strategy.claude_enabled:
                    if self.claude_watch:
                        self.claude_watch.clear()
                        self._subscribe_active()
                    self.claude_candidates = []
                    self.claude_info = {"status": "OFF"}
                    await asyncio.sleep(5)
                    continue
                if time.time() - self.claude_btc_ts > 60:
                    self.claude_btc = _bars(await self.rest.candles(
                        "BTC-USDT", self.cfg.market.candle_interval))
                    self.claude_btc_ts = time.time()
                if time.time() - last_universe > 90:
                    await self._refresh_cash()
                    tickers = await self.rest.all_tickers()
                    self.claude_breadth = self.claude.breadth(
                        tickers, self.cfg.market.quote_currency, p["min_vol"])
                    fee_ban = {s for s, (ts, fee) in self.claude_fees.items()
                               if time.time() - ts < 3600 and
                               fee > self.cfg.strategy.max_taker_fee_pct}
                    self.claude_watch = set(self.claude.universe(
                        tickers, self.scanner.symbol_meta,
                        exclude=fee_ban | self.young_ban))
                    self._subscribe_active()
                    last_universe = time.time()
                ok, why, rinfo = self.claude.regime(
                    self.claude_btc, now_ms(), self.claude_breadth)
                rows, blocked = [], []
                for sym in sorted(self.claude_watch):
                    try:
                        row = await self._claude_symbol(sym, ok, why)
                    except Exception as e:
                        row = {"symbol": sym, "price": 0, "score": 0,
                               "blocked": f"data unavailable: {str(e)[:50]}"}
                    rows.append(row)
                    if row["blocked"] != "entered":
                        blocked.append(row["blocked"])
                self.claude_candidates = sorted(
                    rows, key=lambda r: (r["blocked"] != "entered",
                                         -(r.get("score") or 0),
                                         r["symbol"]))[:12]
                self.claude_info = {
                    "status": "ON", "regime_ok": ok, "regime": why or "tailwind",
                    **rinfo, "watched": len(self.claude_watch),
                    "blocked": claude_summarize(blocked),
                    "today": self._claude_today(),
                    "ts": time.strftime("%H:%M:%S", time.gmtime())}
                self.status = ("trading" if self.pm.any_open()
                               else "halted" if self.risk.halted
                               else "scanning")
            except Exception as e:
                log.exception("claude cycle failed")
                self._errors.appendleft(f"Claude: {str(e)[:110]}")
                self.claude_info = {"status": "error", "regime": str(e)[:80]}
            await asyncio.sleep(p["eval_sec"])

    def _claude_today(self) -> dict:
        ts0 = time.time() - (time.time() % 86400)
        w = l = 0
        net = 0.0
        for t in self.storage.trades(mode=self.cfg.execution.mode, since=ts0):
            if f'"bot": "{self.bot_id}"' in (t["meta"] or ""):
                net += t["net_pnl"]
                w += t["net_pnl"] > 0
                l += t["net_pnl"] <= 0
        return {"wins": w, "losses": l, "net": round(net, 4)}

    async def _claude_symbol(self, sym: str, regime_ok: bool,
                             regime_why: str) -> dict:
        p = self.claude.p
        st = self.mds.states.get(sym)
        if st is None or not st.candles:
            await self.mds.load_history(sym)
            st = self.mds.states[sym]
        cached = self.claude_htf.get(sym)
        if not cached or time.time() - cached[0] > p["htf_ttl"]:
            cached = (time.time(), _bars(await self.rest.candles(sym, p["htf"])))
            self.claude_htf[sym] = cached
        fc = self.claude_fees.get(sym)
        if fc and time.time() - fc[0] < 3600:
            fee = fc[1]
        else:
            fee = (await self.priv.taker_fee_pct(sym)
                   if self.priv and self.cfg.execution.mode == "paper"
                   else await self.exchange.taker_fee_pct(sym))
            self.claude_fees[sym] = (time.time(), fee)
            if self.cfg.execution.mode == "paper":    # paper fills pay real fees
                self.exchange.pair_fees = {
                    k: v for k, (_, v) in self.claude_fees.items()}
        lts = await self.scanner.listed_ts(sym)
        base = {"symbol": sym, "price": st.last_price, "score": 0, "fee": fee}
        if (lts is not None and time.time() - lts <
                self.cfg.market.min_listing_age_days * 86400):
            self.young_ban.add(sym)
            return {**base, "blocked": "listed <7d"}
        if fee > self.cfg.strategy.max_taker_fee_pct:
            return {**base, "blocked": f"fee cap {fee:.2f}%"}

        def sizer(stop_pct: float) -> float:
            return max(1.0, self.risk.position_size(
                stop_pct + 0.3, self.risk.cash - 0.25))
        if st.is_stale(self.cfg.market.stale_data_ms):
            sig, why, row = None, "stale quote", {}
        else:
            sig, why, row = self.claude.evaluate(
                st, fee, sizer, now_ms(), cached[1])
        row = {**base, **row}
        if sym in self.pm.open:
            why = "holding"
        elif sym in self.storage.claimed_symbols(self.bot_id):
            why = "held by other bot"
        elif self._cd.get(sym, 0) > time.time():
            why = f"cooldown {int((self._cd[sym] - time.time()) / 60) + 1}m"
        elif sig and not regime_ok:
            why = f"setup ok, paused: {regime_why}"
        elif sig:
            meta = self.scanner.meta(sym)
            min_quote = max(float(meta.get("minFunds") or 0),
                            (float(meta.get("baseMinSize") or 0)
                             + float(meta.get("baseIncrement") or 0))
                            * st.last_price)
            stop_dist = (sig.price - sig.stop_price) / sig.price * 100
            planned = self.risk.position_size(
                stop_dist + sig.estimated_cost_pct, self.risk.cash - 0.25)
            if planned < max(2.0, 2.5 * min_quote):
                why = "size too small to resell safely"
            else:
                why = await self._enter(sig, "claude") or "entered"
        row["blocked"] = why
        return row

    # Swing -------------------------------------------------------------
    def _seed_swing_streaks(self):
        try:
            for t in self.storage.trades(mode=self.cfg.execution.mode):
                meta = json.loads(t["meta"] or "{}")
                if meta.get("bot") == self.bot_id:
                    until = self.swing.record(t["symbol"], t["net_pnl"],
                                              t["exit_ts"])
                    if until > time.time():
                        self._cd[t["symbol"]] = until
                    else:
                        self._cd.pop(t["symbol"], None)
        except Exception as e:
            log.warning("swing streak seed: %s", e)

    def _reload_swing_cfg(self):
        """Hot-adjust: re-read swing_params from the mounted config so the
        ladder/scores can be tuned without a restart (spec: ladder must be
        adjustable without restarting)."""
        try:
            path = os.environ.get("CONFIG_PATH", "config.yaml")
            mt = os.path.getmtime(path)
            if mt <= self._cfg_mtime:
                return
            self._cfg_mtime = mt
            import yaml as _y
            raw = _y.safe_load(open(path).read()) or {}
            params = (raw.get("strategy") or {}).get("swing_params") or {}
            if params:
                self.cfg.strategy.swing_params = params
                self.swing.p.update(params)
        except Exception as e:
            log.warning("swing cfg reload: %s", e)

    def _swing_today(self) -> dict:
        ts0 = time.time() - (time.time() % 86400)
        w = l = recent = 0
        net = 0.0
        for t in self.storage.trades(mode=self.cfg.execution.mode, since=ts0):
            if f'"bot": "{self.bot_id}"' in (t["meta"] or ""):
                net += t["net_pnl"]
                w += t["net_pnl"] > 0
                l += t["net_pnl"] <= 0
                recent += (t["net_pnl"] < 0 and
                           t["exit_ts"] > time.time() - 600)
        return {"wins": w, "losses": l, "net": round(net, 4),
                "n": w + l, "closes_10m": recent}

    async def swing_loop(self):
        """Swing Structure signal loop; orders/locks/stops stay in Bot/PM.
        Also manages the structural-reversal exit on its own positions."""
        p = self.swing.p
        last_universe = 0.0
        while not self._stop.is_set():
            try:
                if not self.cfg.strategy.swing_enabled:
                    if self.swing_watch:
                        self.swing_watch.clear()
                        self._subscribe_active()
                    self.swing_candidates = []
                    self.swing_info = {"status": "OFF"}
                    # OFF means no new entries, never abandoned positions:
                    # stops/ladder run in decision_loop; structural exit too
                    await self._swing_manage_open()
                    await asyncio.sleep(10)
                    continue
                self._reload_swing_cfg()
                if time.time() - self._swing_day_ts > 60:
                    self._swing_day = self._swing_today()
                    self._swing_day_ts = time.time()
                if self._swing_day["closes_10m"] >= 3 \
                        and self._swing_panic_until <= time.time():
                    self._swing_panic_until = time.time() + 3600
                    print("SWING PANIC: >=3 losing closes/10m, entries frozen 1h",
                          flush=True)
                if time.time() - self.swing_btc_ts > 120:
                    self.swing_btc = _bars(await self.rest.candles(
                        "BTC-USDT", self.cfg.market.candle_interval))
                    self.swing_btc_ts = time.time()
                if time.time() - last_universe > 300:
                    await self._refresh_cash()
                    tickers = await self.rest.all_tickers()
                    self.swing_breadth = self.swing.breadth(
                        tickers, self.cfg.market.quote_currency, p["min_vol"])
                    fee_ban = {s for s, (ts, fee) in self.swing_fees.items()
                               if time.time() - ts < 3600 and
                               fee > self.cfg.strategy.max_taker_fee_pct}
                    self.swing_watch = set(self.swing.universe(
                        tickers, self.scanner.symbol_meta,
                        exclude=fee_ban | self.young_ban))
                    self._subscribe_active()
                    last_universe = time.time()
                ok, why, rinfo = self.swing.regime(
                    self.swing_btc, now_ms(), self.swing_breadth)
                rows, blocked = [], []
                for sym in sorted(self.swing_watch):
                    try:
                        row = await self._swing_symbol(sym, ok, why)
                    except Exception as e:
                        row = {"symbol": sym, "price": 0, "score": 0,
                               "blocked": f"data unavailable: {str(e)[:50]}"}
                    rows.append(row)
                    if row["blocked"] != "entered":
                        blocked.append(row["blocked"])
                self.swing_candidates = sorted(
                    rows, key=lambda r: (r["blocked"] != "entered",
                                         -(r.get("score") or 0),
                                         r["symbol"]))[:12]
                await self._swing_manage_open()
                self.swing_info = {
                    "status": "ON", "regime_ok": ok, "regime": why or "clear",
                    **rinfo, "watched": len(self.swing_watch),
                    "blocked": swing_summarize(blocked),
                    "today": self._swing_today(),
                    "params": {"score_min": self.swing.p["entry_score_min"],
                               "ladder": self.swing.p["ladder"],
                               "min_decline": self.swing.p["min_decline_pct"]},
                    "ts": time.strftime("%H:%M:%S", time.gmtime())}
                self.status = ("trading" if self.pm.any_open()
                               else "halted" if self.risk.halted
                               else "scanning")
            except Exception as e:
                log.exception("swing cycle failed")
                self._errors.appendleft(f"Swing: {str(e)[:110]}")
                self.swing_info = {"status": "error", "regime": str(e)[:80]}
            await asyncio.sleep(p["eval_sec"])

    async def _swing_manage_open(self):
        """Structural exit check on OUR open positions - runs whether or
        not new entries are enabled (OFF never abandons a position)."""
        p = self.swing.p
        for sym, pos in list(self.pm.open.items()):
            st = self.mds.states.get(sym)
            if not st or not st.candles:
                continue
            done, _ = split_bars_s(
                list(st.candles), now_ms(), p["interval_ms"])
            reason = self.swing.structure_broken(pos, done, now_ms())
            if reason and st.last_price and \
                    time.time() >= pos.next_exit_attempt_ts:
                self.say(f"STRUCT-EXIT {sym}: recovery structure "
                         "broke (lower high + higher-low break)")
                await self.close_position(sym, reason, st.last_price)

    async def _swing_symbol(self, sym: str, regime_ok: bool,
                            regime_why: str) -> dict:
        p = self.swing.p
        st = self.mds.states.get(sym)
        if st is None or not st.candles:
            await self.mds.load_history(sym)
            st = self.mds.states[sym]
        cached = self.swing_htf.get(sym)
        if not cached or time.time() - cached[0] > 900:
            cached = (time.time(), _bars(await self.rest.candles(sym, p["htf"])))
            self.swing_htf[sym] = cached
        fc = self.swing_fees.get(sym)
        if fc and time.time() - fc[0] < 3600:
            fee = fc[1]
        else:
            fee = (await self.priv.taker_fee_pct(sym)
                   if self.priv and self.cfg.execution.mode == "paper"
                   else await self.exchange.taker_fee_pct(sym))
            self.swing_fees[sym] = (time.time(), fee)
            if self.cfg.execution.mode == "paper":
                self.exchange.pair_fees = {
                    k: v for k, (_, v) in self.swing_fees.items()}
        lts = await self.scanner.listed_ts(sym)
        base = {"symbol": sym, "price": st.last_price, "score": 0, "fee": fee}
        if (lts is not None and time.time() - lts <
                self.cfg.market.min_listing_age_days * 86400):
            self.young_ban.add(sym)
            return {**base, "blocked": "listed <7d"}
        if fee > self.cfg.strategy.max_taker_fee_pct:
            return {**base, "blocked": f"fee cap {fee:.2f}%"}

        def sizer(stop_pct: float) -> float:
            return max(1.0, self.risk.position_size(
                stop_pct + 0.3, self.risk.cash - 0.25))
        if st.is_stale(self.cfg.market.stale_data_ms):
            sig, why, row = None, "stale quote", {}
        else:
            sig, why, row = self.swing.evaluate(
                st, fee, sizer, now_ms(), cached[1])
        row = {**base, **row}
        if sym in self.pm.open:
            why = "holding"
        elif sym in self.storage.claimed_symbols(self.bot_id):
            why = "held by other bot"
        elif self._cd.get(sym, 0) > time.time():
            why = f"cooldown {int((self._cd[sym] - time.time()) / 3600) + 1}h"
        elif self.swing.cool.get(sym, 0) > time.time():
            why = f"repeat-offender {int((self.swing.cool[sym] - time.time()) / 3600) + 1}h"
        elif sig and not regime_ok:
            why = f"setup ok, paused: {regime_why}"
        elif self._swing_panic_until > time.time():
            why = f"panic fuse {int((self._swing_panic_until - time.time()) / 3600)}h"
        elif self._swing_day["net"] <= self.swing_day_loss_cap:
            why = "daily loss cap"
        elif self._swing_day["n"] >= self.swing_max_trades:
            why = "max trades/day"
        elif sig:
            meta = self.scanner.meta(sym)
            min_quote = max(float(meta.get("minFunds") or 0),
                            (float(meta.get("baseMinSize") or 0)
                             + float(meta.get("baseIncrement") or 0))
                            * st.last_price)
            stop_dist = (sig.price - sig.stop_price) / sig.price * 100
            planned = self.risk.position_size(
                stop_dist + sig.estimated_cost_pct, self.risk.cash - 0.25)
            if planned < max(2.0, 2.5 * min_quote):
                why = "size too small to resell safely"
            else:
                why = await self._enter(sig, "swing") or "entered"
        row["blocked"] = why
        return row

    async def new_bot_loop(self):
        """Independent signal loop; shared exchange, locks and stops stay in Bot."""
        last_universe = 0.0
        while not self._stop.is_set():
            try:
                if not self.cfg.strategy.new_enabled:
                    if self.new_watch:
                        self.new_watch.clear()
                        self._subscribe_active()
                    self.new_candidates = []
                    self.new_scan_info = {"status": "OFF"}
                    await asyncio.sleep(5)
                    continue
                if time.time() - self.new_market_ts > 300:
                    market_rows = await self.rest.candles(
                        "BTC-USDT", "15min",
                        start=int(time.time()) - 14 * 3600)
                    self.new_market_macro = [
                        ind.Candle(ts=int(r[0]) * 1000,
                                   open=float(r[1]), close=float(r[2]),
                                   high=float(r[3]), low=float(r[4]),
                                   volume=float(r[5]))
                        for r in market_rows]
                    self.new_market_ts = time.time()
                if time.time() - last_universe > 90:
                    tickers = await self.rest.all_tickers()
                    fee_ban = {
                        s for s, (ts, fee) in self.new_fee_rates.items()
                        if time.time() - ts < 3600
                        and fee > self.cfg.strategy.max_taker_fee_pct}
                    watch = self.new_strategy.universe(
                        tickers, self.scanner.symbol_meta, self.cfg,
                        exclude=fee_ban | self.young_ban)
                    self.new_watch = set(watch)
                    self._subscribe_active()
                    last_universe = time.time()
                rows, blocked = [], []
                for sym in sorted(self.new_watch):
                    try:
                        row = await self._new_symbol(sym)
                    except Exception as e:
                        log.warning("Chatty %s skipped: %s", sym, e)
                        row = {"symbol": sym, "price": 0, "score": 0,
                               "blocked": f"data/fee unavailable: {str(e)[:50]}",
                               "fee": 0}
                    rows.append(row)
                    if row["blocked"] != "entered":
                        blocked.append(row["blocked"])
                self.new_candidates = sorted(
                    rows, key=lambda r: (r["blocked"] != "entered",
                                         -r["score"], r["symbol"]))[:12]
                self.new_scan_info = {
                    "status": "ON", "watched": len(self.new_watch),
                    "btc_regime_pct": self.new_strategy.market_change(
                        self.new_market_macro, now_ms(),
                        self.cfg.strategy.new_btc_lookback_h),
                    "blocked": summarize(blocked),
                    "ts": time.strftime("%H:%M:%S", time.gmtime())}
                self.status = ("trading" if self.pm.any_open()
                               else "halted" if self.risk.halted
                               else "scanning")
            except Exception as e:
                log.exception("new bot cycle failed")
                self._errors.appendleft(f"Chatty: {str(e)[:110]}")
                self.new_scan_info = {"status": "error", "reason": str(e)}
            await asyncio.sleep(5)

    async def _new_symbol(self, sym: str) -> dict:
        st = self.mds.states[sym]
        if not st.candles:
            await self.mds.load_history(sym)
        if time.time() - self.new_macro_ts.get(sym, 0) > 600:
            rows = await self.rest.candles(
                sym, "15min", start=int(time.time()) - 13 * 3600)
            st.macro_candles = [
                ind.Candle(ts=int(r[0]) * 1000,
                           open=float(r[1]), close=float(r[2]),
                           high=float(r[3]), low=float(r[4]),
                           volume=float(r[5]))
                for r in rows]
            self.new_macro_ts[sym] = time.time()
        cached = self.new_fee_rates.get(sym)
        if cached and time.time() - cached[0] < 3600:
            fee = cached[1]
        elif self.priv and self.cfg.execution.mode == "paper":
            fee = await self.priv.taker_fee_pct(sym)
            self.new_fee_rates[sym] = (time.time(), fee)
        else:
            fee = await self.exchange.taker_fee_pct(sym)
            # feed the universe fee_ban - without this the cache stays
            # empty in live mode and fee-capped pairs keep their slots
            self.new_fee_rates[sym] = (time.time(), fee)
        self.exchange.pair_fees = {
            k: v for k, (_, v) in self.new_fee_rates.items()}
        lts = await self.scanner.listed_ts(sym)
        if (lts is not None and time.time() - lts <
                self.cfg.market.min_listing_age_days * 86400):
            self.young_ban.add(sym)
            return {"symbol": sym, "price": st.last_price or 0,
                    "score": 0, "blocked": "listed <7d", "fee": fee}
        probe = max(1.0, self.risk.position_size(
            self.cfg.strategy.stop_loss_pct, self.risk.cash))
        sig, why = (self.new_strategy.evaluate(
            st, fee, probe, now_ms(), self.new_market_macro)
            if not st.is_stale(self.cfg.market.stale_data_ms)
            else (None, "stale quote"))
        if sig is None:
            rsig, rwhy = self.new_strategy.runner_evaluate(
                st, fee, probe, now_ms(), self.new_market_macro)
            if rsig:
                sig, why = rsig, rwhy
        if sym in self.pm.open:
            why = "already held"
        elif sym in self.storage.claimed_symbols(self.bot_id):
            why = "held by other bot"
        elif self._cd.get(sym, 0) > time.time():
            why = "loss cooldown"
        elif sig:
            why = await self._enter(sig, "new-bot") or "entered"
        return {"symbol": sym, "price": st.last_price,
                "score": sig.score if sig else 0, "blocked": why, "fee": fee}

    # A ----------------------------------------------------------------
    async def scan_loop(self):
        while not self._stop.is_set():
            cands = await self.scanner.scan()
            if cands:
                for c in cands:
                    st = self.mds.states.get(c.symbol)
                    if st:
                        await self._ensure_macro(st)
                self._subscribe_active()
            self.status = ("trading" if self.pm.any_open()
                           else "scanning" if not self.risk.halted else "halted")
            await asyncio.sleep(self.cfg.market.scan_interval_sec)

    # B ----------------------------------------------------------------
    async def refresh_loop(self):
        while not self._stop.is_set():
            syms = ({c.symbol for c in self.scanner.candidates}
                    | set(self.pm.open) | set(self.rhythm_watch)
                    | self.new_watch | self.claude_watch | self.swing_watch)
            for s in syms:
                await self.mds.refresh_candle(s)
                await self.mds.refresh_book(s)
            await asyncio.sleep(10)

    # C+D+E --------------------------------------------------------------
    async def decision_loop(self):
        while not self._stop.is_set():
            try:
                await self._tick()
            except Exception as e:
                log.exception("decision tick failed")
                self.storage.event("error", "decision", str(e))
            await asyncio.sleep(1.0)

    async def _tick(self):
        now = now_ms()
        # roll daily counters
        today = time.strftime("%Y-%m-%d", time.gmtime())
        if today != self.day:
            self.day, self.fees_today = today, 0.0

        # BTC 1h momentum for the tailwind entry gate (1 REST call / 5 min)
        if self.bot_id in ("main", "15m", "new") and \
                time.time() - self.btc_1h_ts > 300:
            try:
                rows = await self.rest.candles("BTC-USDT", "15min")
                done = [float(r[2]) for r in rows[:-1]]
                if len(done) >= 5:
                    self.btc_1h_pct = (done[-1] / done[-5] - 1) * 100
                self.btc_1h_ts = time.time()
            except Exception:
                pass

        # --- manage open positions (D): every tick, not candle close ---
        for sym, pos in list(self.pm.open.items()):
            st = self.mds.states.get(sym)
            px = st.last_price if st and st.last_price else 0
            if not px:
                continue
            self.risk.mark_unrealised(pos.qty * (px - pos.entry_price))
            pos.momentum_hold = self.new_strategy.symbol_uptrend(st, px)
            reason = pos.update(px, time.time())
            self.storage.save_position(self.bot_id, pos)
            if reason and time.time() >= pos.next_exit_attempt_ts:
                await self.close_position(sym, reason, px)

        # --- entries / switching (C+E) ---
        verdict = self.risk.can_trade(self.mds.data_health())
        if not verdict.allowed:
            return

        cands = self.scanner.candidates
        signals = {}
        size_probe = self.cfg.risk.starting_capital * 0.1
        other_bots = self.storage.claimed_symbols(self.bot_id)
        for c in cands:
            if c.symbol in self.pm.open or c.symbol in other_bots \
                    or self._cd.get(c.symbol, 0) > time.time():
                continue                      # held / locked / cooling off
            st = self.mds.states.get(c.symbol)
            if not st or st.is_stale(self.cfg.market.stale_data_ms):
                continue
            if self.cfg.market.candle_interval == "1min":
                cached = self._macro_cache.get(c.symbol)
                if not cached or time.time() - cached[0] >= 600:
                    continue  # scanner refreshes macro data off the exit loop
                st.macro_candles = cached[1]
            gated_ok = self.cfg.strategy.gated_enabled
            sig = ((self.engine.evaluate(c, st, now, size_probe)
                    if gated_ok else None)
                   or self.engine.evaluate_rhythm(
                       c, st, now, size_probe,
                       market_shock=self._mkt_shock))
            if sig and not sig.is_stale(
                    self.cfg.strategy.signal_max_age_ms, now):
                signals[c.symbol] = sig

        cur_sym = next(iter(self.pm.open), None)
        at_cap = len(self.pm.open) >= self.cfg.risk.max_open_positions
        decision = self.switcher.evaluate(
            cur_sym if at_cap else None,
            self.pm.open.get(cur_sym) if at_cap and cur_sym else None,
            cands, lambda s: signals.get(s))

        if False and decision["action"] == "exit_for_switch":
            st = self.mds.states.get(cur_sym)
            px = st.last_price if st else 0
            trade = await self.pm.exit(cur_sym, "switch", px)
            self.storage.release_symbol(cur_sym, self.bot_id)
            if trade:
                self.risk.on_trade_close(trade["net_pnl"])
                self.switcher.switched()
                self.say(f"SWITCH-EXIT {cur_sym}: {decision['reason']}")
            return                                  # reassess next tick
        if decision["action"] == "enter":
            sig = signals.get(decision["target"])
            if not sig:
                return
            if self.dashboard_only:
                return
            stop_dist = max(self.cfg.strategy.stop_loss_pct,
                            (sig.price - sig.stop_price) / sig.price * 100)
            # shared pool: check REAL free cash so two bots split naturally
            try:
                bals = await self.exchange.balances()
                avail = bals.get(self.cfg.market.quote_currency,
                                 self.risk.cash)
            except Exception:
                avail = self.risk.cash
            size = self.risk.position_size(stop_dist, avail - 0.25)
            if size < 1.0:                          # below KuCoin min notional
                return
            thr = self.cfg.strategy.rhythm_min_btc_1h_pct
            if self.btc_1h_pct is not None and self.btc_1h_pct < thr:
                return                  # tailwind gate: no longs into a weak tape
            if not self.storage.claim_symbol(sig.symbol, self.bot_id):
                return                        # another bot beat us to it
            try:
                pos = await self.pm.enter(sig, size)
            except Exception:
                self.storage.release_symbol(sig.symbol, self.bot_id)
                raise
            if not pos:
                self.storage.release_symbol(sig.symbol, self.bot_id)
                return
            if pos:
                self.risk.on_fill_buy(size)
                self.fees_today += pos.fees_paid
                self.say(f"ENTER {sig.symbol} size={size:.2f} "
                         f"px={pos.entry_price:.5f} "
                         f"| {'; '.join(sig.reasons)}")
                self.storage.event("info", "entry", decision["reason"])

    async def close_position(self, sym: str, reason: str, px: float):
        pos = self.pm.open.get(sym)
        if pos is None:
            return None
        entry_fee_per_unit = pos.fees_paid / pos.qty if pos.qty else 0.0
        trade = await self.pm.exit(sym, reason, px)
        if not trade:
            return None
        left = self.pm.open.get(sym)
        if left is not None:
            # unsellable remainder (below exchange minimum) is dust, not a
            # position: write it off so it can't lurk or block the symbol
            meta = self.scanner.meta(sym) if self.scanner else {}
            min_qty = float(meta.get("baseMinSize") or 0)
            min_funds = float(meta.get("minFunds") or 0)
            if left.qty < min_qty or left.qty * px < max(min_funds, 0.5):
                del self.pm.open[sym]
                self.storage.delete_position(self.bot_id, sym)
                self.say(f"DUST {sym} qty={left.qty} below sell minimum; "
                         "written off")
        if sym not in self.pm.open:
            self.storage.release_symbol(sym, self.bot_id)
        self.risk.on_fill_sell(trade["exit_price"] * trade["qty"])
        self.risk.on_trade_close(trade["net_pnl"])
        self.fees_today += trade["fees"] - entry_fee_per_unit * trade["qty"]
        if self.bot_id in CLAUDE_BOTS:
            until = self.claude.record(sym, trade["net_pnl"], time.time())
            if until:
                self._cd[sym] = until
        elif self.bot_id in SWING_BOTS:
            until = self.swing.record(sym, trade["net_pnl"], time.time())
            if until:
                self._cd[sym] = until
        elif trade["net_pnl"] < 0:
            self._cd[sym] = time.time() + self.cfg.strategy.loss_cooldown_sec
        self.say(f"EXIT {sym} [{reason}] net={trade['net_pnl']:+.4f} "
                 f"(why in: {'; '.join(pos.meta.get('signal', []))})")
        return trade

    def pending_switch(self):
        return self.switcher.pending_switch_to

    # rhythm scanner - hunts ALL eligible pairs for peak/trough ranges ----
    async def rhythm_loop(self):
        await asyncio.sleep(20)
        while not self._stop.is_set():
            try:
                await self._rhythm_scan()
            except Exception as e:
                log.warning("rhythm scan: %s", e)
            await asyncio.sleep(90)

    async def _rhythm_scan(self):
        s = self.cfg.strategy
        if not (s.rhythm_enabled or s.knife_enabled):
            return
        self.rhythm_scanning = True
        try:
            await self._rhythm_scan_inner()
        finally:
            self.rhythm_scanning = False

    async def _refresh_cash(self):
        """Pull the real free balance so sizing sees money other bots freed."""
        try:
            bals = await self.exchange.balances()
            self.risk.sync_cash(bals.get(self.cfg.market.quote_currency,
                                         self.risk.cash))
        except Exception as e:
            log.warning("cash refresh: %s", e)

    async def _refresh_market_shock(self):
        """Panic detector: BTC 1h below the shock threshold -> rhythm's
        bull confirmation relaxes (panic tape produces real troughs)."""
        th = self.cfg.strategy.rhythm_shock_btc_1h_pct
        if th is None:
            return
        if time.time() - self._mkt_shock_ts < 300:
            return
        try:
            rows = await self.rest.candles(
                "BTC-USDT", "15min", start=int(time.time()) - 14 * 3600)
            bars = [ind.Candle(ts=int(r[0]) * 1000, open=float(r[1]),
                               close=float(r[2]), high=float(r[3]),
                               low=float(r[4]), volume=float(r[5]))
                    for r in rows]
            chg = self.new_strategy.market_change(bars, now_ms(), 1.0)
            self._mkt_shock = chg is not None and chg <= th
            self._mkt_shock_ts = time.time()
        except Exception as e:
            log.warning("market shock refresh: %s", e)

    async def _rhythm_scan_inner(self):
        s = self.cfg.strategy
        cfg = self.cfg
        await self._refresh_cash()
        await self._refresh_market_shock()
        try:
            tickers = await self.rest.all_tickers()
        except Exception as e:
            log.warning("rhythm ticker fetch: %s", e)
            return
        quote = cfg.market.quote_currency
        wl, bl = set(cfg.market.watchlist), set(cfg.market.blacklist)
        metas = []
        for t in tickers:
            sym = t.get("symbol", "")
            if not sym.endswith("-" + quote) or sym in bl:
                continue
            if wl and sym not in wl:
                continue
            qv = float(t.get("volValue") or 0)
            if qv < cfg.market.min_24h_quote_volume:
                continue
            chg = abs(float(t.get("changeRate") or 0)) * 100
            if chg > cfg.market.max_price_change_pct_1m * 10:
                continue
            metas.append((sym, qv))
        metas.sort(key=lambda x: -x[1])
        found, knife_found, watched = [], [], {}
        rejected, gates = Counter(), Counter()
        knife_shaped_syms = {}
        for sym, qv in metas:
            await asyncio.sleep(0.15)         # ~6 req/s, keep clear of limits
            try:
                rows = await self.rest.candles(
                    sym, self.cfg.market.candle_interval)
            except Exception:
                continue
            if len(rows) < 62:
                continue
            now = now_ms()  # not the sweep's start: a 1m signal expires in 5s
            st = SymbolState(sym)
            for r in rows:
                st.candles.append(ind.Candle(
                    ts=int(r[0]) * 1000, open=float(r[1]), close=float(r[2]),
                    high=float(r[3]), low=float(r[4]), volume=float(r[5])))
            cs = list(st.candles)
            px = cs[-1].close
            st.last_price = px
            live = self.mds.states.get(sym)     # merge live trade flow so
            if live and live.trades:            # stab gates can see buy_ratio
                st.trades = list(live.trades)
            lb = s.knife_lookback               # knife-shaped? subscribe for
            knife_shaped = len(cs) >= lb and (  # live buy-flow data next scan
                (max(x.high for x in cs[-lb:]) /
                 min(x.low for x in cs[-lb:]) - 1) * 100 >= s.knife_drop_pct)
            if knife_shaped and s.knife_enabled:
                knife_shaped_syms[sym] = (
                    max(x.high for x in cs[-lb:]) /
                    min(x.low for x in cs[-lb:]) - 1)
            try:
                ksig = self.engine.evaluate_knife(st, now)
                if ksig:
                    km = ksig.knife
                    knife_found.append(
                        {"symbol": sym,
                         "drop": round(km["drop_pct"], 1),
                         "rec": f"{km['bounced']}/{km['knives']}",
                         "price": px})
                    if sym not in self.pm.open \
                            and self._cd.get(sym, 0) < time.time() \
                            and self.knife_cd.get(sym, 0) < time.time() \
                            and await self._knife_old_enough(sym, s):
                        self.knife_cd[sym] = \
                            time.time() + s.knife_cooldown_sec
                        await self._enter(ksig, "knife-scan")
            except Exception as e:
                log.debug("knife eval %s: %s", sym, e)
            if not s.rhythm_enabled:
                continue
            setup, why = self.engine.rhythm_geometry(cs, px, now)
            if setup is None:
                rejected[why] += 1
                continue
            hi, lo, zone = setup["hi"], setup["lo"], setup["zone"]
            bulls = self.engine.bull_flags(cs, now)
            bull_ready = self.engine.rhythm_bulls_ok(bulls)
            near_floor = px <= lo * 1.10
            br = ind.taker_buy_ratio(
                list(st.trades), now - s.reversal_lookback_sec * 1000)
            buyers = None if br is None else br >= 0.5
            in_zone = zone <= s.rhythm_zone_pct and px >= lo * 0.995
            watchable = zone <= s.rhythm_zone_pct * 1.4 and px >= lo * 0.995
            recent_ticks = [t for t in st.trades
                            if t[0] >= now - s.reversal_lookback_sec * 1000]
            subscribed = any(
                topic.startswith("/market/match:") and
                sym in topic.split(":", 1)[1].split(",")
                for topic in self.ws.topics)
            flow = ("not in live watch set" if not subscribed and not watchable
                    else "subscribing" if not subscribed else
                    "waiting for match ticks" if not st.trades else
                    "match ticks too old" if not recent_ticks else
                    "no buyer volume" if br is None else
                    f"{br:.0%} buyers / {len(recent_ticks)} ticks")
            ready = sum((in_zone, near_floor, bull_ready, buyers is True))
            row = {"symbol": sym, "range_atr": setup["range_atr"],
                   "zone": zone, "price": px, "in_zone": in_zone,
                   "near_floor": near_floor, "watchable": watchable,
                   "bulls": bulls, "flow": flow,
                   "buyers": buyers, "ready": ready,
                   "blocked": "outside trough" if not in_zone
                   else "latest strong green + live green" if not bull_ready
                   else f"buyer flow: {flow}" if buyers is not True
                   else "checking other gates"}
            found.append(row)
            if not in_zone:
                gates["outside trough"] += 1
            if not bull_ready:
                gates["bull sequence"] += 1
            if buyers is None:
                gates["no recent buyer flow"] += 1
            elif not buyers:
                gates["buyers <50%"] += 1
            if watchable:
                watched[sym] = cs
            # in the trough? try an entry right now
            if in_zone and bull_ready and buyers is True:
                try:
                    await self._ensure_macro(st)
                    ob = await self.rest.orderbook(sym)
                    st.bids = [[float(p), float(z)]
                               for p, z in ob.get("bids", [])]
                    st.asks = [[float(p), float(z)]
                               for p, z in ob.get("asks", [])]
                    cand = Candidate(sym, 0, 0, 0, 0, qv, 0, px, True)
                    blockers = []
                    fee = await self.exchange.taker_fee_pct(sym)
                    quote_size = self._rhythm_quote_size(px, setup)
                    if quote_size < 1:
                        row["blocked"] = "insufficient risk-safe cash"
                        gates[row["blocked"]] += 1
                        continue
                    sig = self.engine.evaluate_rhythm(
                        cand, st, now_ms(), quote_size,
                        blockers, fee_pct=fee,
                        market_shock=self._mkt_shock)
                    row["blocked"] = blockers[0] if blockers else "entry ready"
                    row["entry_ready"] = bool(sig)
                    if blockers:
                        gates[blockers[0]] += 1
                    if sig and sym in self.pm.open:
                        row["blocked"] = "already held"
                        row["entry_ready"] = False
                    elif sig and self._cd.get(sym, 0) >= time.time():
                        row["blocked"] = "loss cooldown"
                        row["entry_ready"] = False
                    elif sig and len(self.pm.open) >= cfg.risk.max_open_positions:
                        row["blocked"] = "position cap"
                        row["entry_ready"] = False
                    elif sig and sym in self.storage.claimed_symbols(self.bot_id):
                        row["blocked"] = "held by other bot"
                        row["entry_ready"] = False
                    elif sig:
                        blocked = await self._enter(sig, "rhythm-scan")
                        row["blocked"] = blocked or "entered"
                        if blocked:
                            row["entry_ready"] = False
                            gates[blocked] += 1
                except Exception as e:
                    log.debug("rhythm eval %s: %s", sym, e)
                    row["blocked"] = f"entry unavailable: {str(e)[:60]}"
                    row["entry_ready"] = False
                    gates["entry unavailable"] += 1
        ranked = sorted(found, key=self._rhythm_rank)
        self.rhythm_cands = ranked[:8]
        # Subscribe to more potential turns without polling extra books/candles.
        # Keep prior qualifiers subscribed for a while so a coin that falls out
        # of the top list and returns still has tick history.
        self._update_flow_watch(
            self._select_flow_watch(ranked, cfg.market.candle_interval),
            cfg.market.candle_interval)
        self.knife_cands = sorted(knife_found, key=lambda x: -x["drop"])[:8]
        self.knife_watch = set(sorted(knife_shaped_syms,
                                     key=knife_shaped_syms.get,
                                     reverse=True)[:8])
        self.rhythm_watch = {
            r["symbol"]: time.time() for r in ranked[:8]
            if r["symbol"] in watched}
        for sym in self.rhythm_watch:
            live = self.mds.states.setdefault(sym, SymbolState(sym))
            if len(live.candles) < 62:
                live.candles = deque(watched[sym],
                                     maxlen=self.cfg.market.history_limit)
                live.last_price = watched[sym][-1].close
                live.last_update_ms = now_ms()
        self._subscribe_active()
        self.rhythm_scan_info = {"pairs": len(metas),
                                 "found": len(found),
                                 "watching": len(self.rhythm_watch),
                                 "flow_watch": len(self.rhythm_flow_watch),
                                 "gates": gates.most_common(4),
                                 "filtered": rejected.most_common(4),
                                 "ts": time.strftime("%H:%M:%S")}

    @staticmethod
    def _rhythm_rank(row: dict) -> tuple:
        return (not row.get("entry_ready", False),
                not row.get("watchable", False),
                -int(SignalEngine.rhythm_bulls_ok(row["bulls"])),
                -sum(row["bulls"][-2:]),
                row.get("buyers") is not True,
                -row["ready"], abs(row["zone"]))

    @staticmethod
    def _select_flow_watch(ranked: list[dict], interval: str) -> set[str]:
        limit = 24 if interval == "1min" else 8
        return set([r["symbol"] for r in ranked if r["watchable"]][:limit])

    def _update_flow_watch(self, fresh: set, interval: str) -> set:
        now_t = time.time()
        for sym in fresh:
            self._flow_watch_since[sym] = now_t
        ttl = 600 if interval == "1min" else 1800
        cap = 48 if interval == "1min" else 24
        self._flow_watch_since = {
            s: t for s, t in sorted(
                self._flow_watch_since.items(), key=lambda x: x[1])[-cap:]
            if now_t - t < ttl}
        self.rhythm_flow_watch = set(self._flow_watch_since)
        return self.rhythm_flow_watch

    def _rhythm_quote_size(self, price: float, setup: dict) -> float:
        s = self.cfg.strategy
        stop = setup["lo"] * (1 - s.stop_loss_pct / 400)
        stop_pct = max(s.stop_loss_pct, (price - stop) / price * 100)
        return max(0.0, self.risk.position_size(
            stop_pct, max(0.0, self.risk.cash - 0.25)))

    async def rhythm_watch_loop(self):
        """Fast re-check of in-zone rhythm coins on live ticks - buys the
        bottom of the trough, not a 90-second-old snapshot."""
        await asyncio.sleep(30)
        while not self._stop.is_set():
            try:
                await self._rhythm_watch_tick()
            except Exception as e:
                log.warning("rhythm watch: %s", e)
            await asyncio.sleep(3)

    async def _rhythm_watch_tick(self):
        if not self.cfg.strategy.rhythm_enabled:
            return                                  # rhythm off - skip tick
        await self._refresh_market_shock()
        s = self.cfg.strategy
        now = now_ms()
        for sym in list(self.rhythm_watch):
            if sym in self.pm.open:
                self.rhythm_watch.pop(sym, None)
                continue
            if time.time() - self.rhythm_watch[sym] > 1800:
                self.rhythm_watch.pop(sym, None)
                continue
            st = self.mds.states.get(sym)
            if not st or len(st.candles) < 62:
                continue
            if st.is_stale(self.cfg.market.stale_data_ms):
                continue
            cs = list(st.candles)
            px = st.last_price or cs[-1].close
            setup, _ = self.engine.rhythm_geometry(cs, px, now_ms())
            if setup is None:
                continue
            zone, lo = setup["zone"], setup["lo"]
            if zone > s.rhythm_zone_pct * 1.4 or px < lo * 0.995:
                self.rhythm_watch.pop(sym, None)   # left the trough
                continue
            if zone <= s.rhythm_zone_pct and px >= lo * 0.995 \
                    and self._cd.get(sym, 0) < time.time():
                await self._ensure_macro(st)
                cand = Candidate(sym, 0, 0, 0, 0, 0, 0, px, True)
                fee = await self.exchange.taker_fee_pct(sym)
                quote_size = self._rhythm_quote_size(px, setup)
                if quote_size < 1:
                    continue
                sig = self.engine.evaluate_rhythm(
                    cand, st, now_ms(), quote_size,
                    fee_pct=fee, market_shock=self._mkt_shock)
                if sig:
                    await self._enter(sig, "rhythm-watch")

    async def _knife_old_enough(self, sym: str, s) -> bool:
        """Knife only on coins listed > min_age_days (cached 24h)."""
        hit = self._age_cache.get(sym)
        if hit and hit[1] > time.time():
            return hit[0]
        ok = True
        try:
            end = int(time.time()) - int(s.knife_min_age_days * 86400)
            start = end - 2 * 86400
            rows = await self.rest.candles(sym, "1day", start, end)
            ok = bool(rows)
            if not ok:
                log.info("knife skip %s: listing < %dd old", sym,
                         s.knife_min_age_days)
        except Exception:
            pass                       # API blip -> don't block on age
        self._age_cache[sym] = (ok, time.time() + 86400)
        return ok

    async def _enter(self, sig, src="signal"):
        if self.dashboard_only:
            return "dashboard-only"
        if sig.is_stale(self.cfg.strategy.signal_max_age_ms, now_ms()):
            return "stale signal"
        if src.startswith("rhythm") and self.btc_1h_pct is not None and \
                self.btc_1h_pct < self.cfg.strategy.rhythm_min_btc_1h_pct:
            return f"BTC 1h weak {self.btc_1h_pct:+.2f}%"
        verdict = self.risk.can_trade(self.mds.data_health())
        if not verdict.allowed:
            return verdict.reason
        if len(self.pm.open) >= self.cfg.risk.max_open_positions:
            return "position cap"
        stop_dist = max(self.cfg.strategy.stop_loss_pct,
                        (sig.price - sig.stop_price) / sig.price * 100)
        try:
            bals = await self.exchange.balances()
            avail = bals.get(self.cfg.market.quote_currency, self.risk.cash)
        except Exception:
            avail = self.risk.cash
        size = self.risk.position_size(
            stop_dist + sig.estimated_cost_pct, avail - 0.25)
        if src == "knife-scan":
            # knife scratches must stay microscopic: cap planned loss at a
            # % of equity so it scales with the pot (~14c on an $18 pot)
            cap = avail * self.cfg.strategy.knife_max_risk_pct / 100
            size = min(size, cap * 100 / max(stop_dist, 0.01))
        if size < 1.0:
            return "insufficient risk-safe cash"
        if not self.storage.claim_symbol(sig.symbol, self.bot_id):
            return "held by other bot"
        try:
            self.mds.subscribe_symbols(sorted(
                set(self.pm.open) | set(self.rhythm_watch)
                | self.rhythm_flow_watch | self.knife_watch | self.new_watch
                | {c.symbol for c in self.scanner.candidates}
                | {sig.symbol}))  # keep exit ticks and watch flow subscribed
        except Exception:
            pass
        try:
            pos = await self.pm.enter(sig, size)
        except Exception:
            self.storage.release_symbol(sig.symbol, self.bot_id)
            raise
        if not pos:
            self.storage.release_symbol(sig.symbol, self.bot_id)
            return "buy unfilled"
        self.risk.on_fill_buy(size)
        self.fees_today += pos.fees_paid
        self.say(f"ENTER {sig.symbol} size={size:.2f} "
                 f"px={pos.entry_price:.5f} "
                 f"| {'; '.join(sig.reasons)}")
        self.storage.event("info", "entry", src)

    # AI analyst (advisory only) -----------------------------------------
    async def ai_loop(self):
        while not self._stop.is_set():
            try:
                self.ai_analysis = await self.analyst.analyze(self.snapshot())
            except Exception as e:
                log.warning("ai loop: %s", e)
            await asyncio.sleep(60)

    # D/G reconciliation ------------------------------------------------
    async def reconcile_loop(self):
        while not self._stop.is_set():
            await asyncio.sleep(self.cfg.execution.reconcile_interval_sec)
            try:
                bals = await self.exchange.balances()
                free = bals.get(self.cfg.market.quote_currency,
                                self.real_total)
                self.real_total, self.real_total_complete = \
                    await self._spot_total(free + self.storage.open_value())
                # keep the account-value legs honest after restarts that
                # happened while cash was locked in open positions
                self.risk.account_total = self.real_total
                self.risk.equity = (self.real_total
                                    * self.cfg.risk.allocation_pct / 100)
                # margin account equity for display only - never sizes trades
                if (os.environ.get("KUCOIN_API_KEY2")
                        and time.time() - self._margin_ts > 60):
                    self._margin_ts = time.time()
                    if self._kp2 is None:
                        from .kucoin_private import KucoinPrivateREST
                        self._kp2 = KucoinPrivateREST(
                            self.cfg.market.base_url,
                            os.environ["KUCOIN_API_KEY2"],
                            os.environ["KUCOIN_API_SECRET2"],
                            os.environ["KUCOIN_API_PASSPHRASE2"],
                            self.session)
                    self.margin_total = await self._kp2.margin_overview()
            except Exception:
                pass
            try:
                bad = await self.pm.reconcile()
                for sym, expect, got in bad:
                    self.say(f"reconcile {sym}: expected {expect} got {got}")
                stale = [r for r in self.storage.load_positions(self.bot_id)
                         if r["symbol"] not in self.pm.open]
                if stale:
                    totals = await self.exchange.account_totals()
                    balances = {
                        cur: row.get("balance", row.get("available", 0))
                        for cur, row in totals.items()}
                    restored = False
                    for row in stale:
                        held = balances.get(
                            row["symbol"].split("-")[0], 0)
                        if held >= row["qty"] * 0.95:
                            self.pm.restore([row])
                            restored = True
                            continue
                        remaining, fee = await self._recover_position_row(
                            row, held)
                        if remaining > 0:
                            row["qty"], row["entry_fee"] = remaining, fee
                            self.pm.restore([row])
                            restored = True
                        else:
                            self.storage.release_symbol(
                                row["symbol"], self.bot_id)
                    if restored:
                        self._subscribe_active()
                bals = await self.exchange.balances()
                self.risk.sync_cash(bals.get(
                    self.cfg.market.quote_currency, self.risk.cash))
                self.storage.log_equity(self.risk.equity, self.risk.cash,
                                        self.cfg.execution.mode)
            except Exception as e:
                log.warning("reconcile failed: %s", e)

    # I ------------------------------------------------------------------
    def snapshot(self) -> dict:
        positions, upnl = [], 0.0
        for sym, pos in self.pm.open.items() if self.pm else []:
            st = self.mds.states.get(sym) if self.mds else None
            last = st.last_price if st else pos.entry_price
            if pos.qty * last < 0.5:           # dust crumb - hide from view
                continue
            u = pos.qty * (last - pos.entry_price)
            upnl += u
            path = signal_path(pos.meta.get("signal"))
            positions.append({
                "symbol": sym, "qty": pos.qty, "entry": pos.entry_price,
                "last": last, "upnl_pct": (last/pos.entry_price-1)*100,
                "stop": pos.stop_price, "take": pos.take_price,
                "path": path,
                "held_s": time.time() - pos.entry_ts})
        r = self.cfg.risk
        return {
            "mode": self.cfg.execution.mode, "status": self.status,
            "bot_id": self.bot_id,
            "allocation_pct": self.cfg.risk.allocation_pct,
            "real_total": self.real_total,
            "spot_total_complete": self.real_total_complete,
            "margin_equity": self.margin_total,
            "unrealized_included": False,
            "rhythm": self.rhythm_cands,
            "new_candidates": self.new_candidates,
            "new_scan_info": self.new_scan_info,
            "claude_candidates": self.claude_candidates,
            "claude_info": self.claude_info,
            "swing_candidates": self.swing_candidates,
            "swing_info": self.swing_info,
            "knives": self.knife_cands,
            "paths": {"gated": self.cfg.strategy.gated_enabled,
                      "rhythm": self.cfg.strategy.rhythm_enabled,
                      "knife": self.cfg.strategy.knife_enabled,
                      "new": self.cfg.strategy.new_enabled,
                      "claude": self.cfg.strategy.claude_enabled,
                      "swing": self.cfg.strategy.swing_enabled},
            "errors": list(self._errors)[:6],
            "cooldowns": {s: int(t - time.time())
                          for s, t in self._cd.items()
                          if t > time.time()},
            "rhythm_scanning": self.rhythm_scanning,
            "rhythm_scan_info": self.rhythm_scan_info,
            "halted": self.risk.halted, "halt_reason": self.risk.halt_reason,
            "equity": self.risk.equity, "cash": self.risk.cash,
            "unrealized": upnl, "day_realized": self.risk.day_realized,
            "fees_today": self.fees_today,
            "trades_today": self.risk.trades_today,
            "consec_losses": self.risk.consec_losses,
            "positions": positions,
            "candidates": [c.__dict__ for c in
                           (self.scanner.candidates if self.scanner else [])],
            "scan_stats": ({k: v for k, v in self.scanner.scan_stats.items()
                            if not k.startswith("_")}
                           if self.scanner else {}),
            "risk_limits": {
                "max_position_pct": r.max_position_pct,
                "max_risk_per_trade_pct": r.max_risk_per_trade_pct,
                "max_risk_pct": r.max_risk_pct,
                "max_daily_loss_pct": self.risk.daily_loss_pct,
                "max_drawdown_pct": self.risk.drawdown_pct,
                "max_consecutive_losses": r.max_consecutive_losses,
                "max_trades_per_day": r.max_trades_per_day,
                "max_open_positions": r.max_open_positions,
                "cooldown_min": r.cooldown_min},
            "explain": "\n".join(self.explain_log),
            "ai_analysis": self.ai_analysis,
        }

    def report(self) -> dict:
        trades = [dict(r) for r in self.storage.trades(
            mode=self.cfg.execution.mode)]
        return compute(trades, self.cfg.risk.starting_capital)
