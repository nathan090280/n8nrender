"""Approximate OHLCV replay; needs historical taker trades to test entries.

Without a trade tape the buyer-flow gate correctly produces no entries. Candle
high/low ordering and order-book liquidity cannot be reconstructed from OHLCV.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from . import indicators as ind
from .market_data import SymbolState
from .positions import Position
from .scanner import Candidate
from .signals import SignalEngine


@dataclass
class BTResult:
    symbol: str
    trades: list[dict] = field(default_factory=list)
    equity: float = 0.0


def _synth_book(price: float, spread_pct: float, depth: float = 5_000):
    """Fake level2 book around a mid for expected-slippage estimation."""
    half = price * spread_pct / 200
    bids = [[price - half - i * price * 0.0001, depth / price]
            for i in range(10)]
    asks = [[price + half + i * price * 0.0001, depth / price]
            for i in range(10)]
    return bids, asks


class Backtester:
    def __init__(self, cfg):
        self.cfg = cfg
        self.engine = SignalEngine(cfg)
        self.spread_pct = 0.04           # conservative assumed spread
        self.slip_pct = cfg.execution.slippage_bps / 100
        self.fee_pct = cfg.execution.taker_fee_pct

    # ------------------------------------------------------------------
    def run(self, symbol: str, candles: list[ind.Candle],
            candidate: Candidate | None = None,
            order_quote: float | None = None,
            trade_tape: list[tuple] | None = None,
            macro_candles: list[ind.Candle] | None = None) -> BTResult:
        cfg = self.cfg
        warmup = cfg.market.min_history_candles
        order_quote = order_quote or cfg.risk.starting_capital \
            * cfg.risk.max_position_pct / 100
        st = SymbolState(symbol)
        pos: Position | None = None
        trades: list[dict] = []
        cand = candidate or Candidate(symbol, score=50, rel_vol=2, mom=0,
                                      rel_volume=1, quote_volume_24h=1e7,
                                      spread_pct=self.spread_pct,
                                      price=0, trend_ok=True)
        tape = sorted(trade_tape or [], key=lambda t: t[0])
        tape_idx = macro_idx = 0
        macro = sorted(macro_candles or [], key=lambda c: c.ts)

        for i in range(len(candles)):
            st.candles.append(candles[i])
            px = candles[i].close
            st.last_price = px
            st.last_update_ms = candles[i].ts
            st.bids, st.asks = _synth_book(px, self.spread_pct)
            while tape_idx < len(tape) and tape[tape_idx][0] <= candles[i].ts:
                st.trades.append(tape[tape_idx])
                tape_idx += 1
            while macro_idx < len(macro) and \
                    macro[macro_idx].ts + 900_000 <= candles[i].ts:
                st.macro_candles.append(macro[macro_idx])
                macro_idx += 1

            if pos is not None:
                reason = self._bt_exit_check(pos, candles[i])
                if reason:
                    level = (pos.stop_price if reason in
                             ("stop_loss", "trailing_stop") else
                             pos.take_price if reason == "take_profit" else
                             candles[i].close)
                    fill_px = level * (1 - self.slip_pct / 100)
                    gross = pos.qty * (fill_px - pos.entry_price)
                    fees = pos.fees_paid + pos.qty * fill_px * self.fee_pct / 100
                    trades.append({
                        "symbol": symbol, "side": "buy",
                        "entry_ts": pos.entry_ts, "exit_ts": candles[i].ts/1000,
                        "qty": pos.qty, "entry_price": pos.entry_price,
                        "exit_price": fill_px, "gross_pnl": gross,
                        "fees": fees, "net_pnl": gross - fees,
                        "exit_reason": reason, "mode": "backtest"})
                    pos = None
                continue

            if i < warmup:
                continue
            now = candles[i].ts
            sig = ((self.engine.evaluate(cand, st, now, order_quote)
                    if cfg.strategy.gated_enabled else None)
                   or self.engine.evaluate_rhythm(cand, st, now, order_quote)
                   or self.engine.evaluate_knife(st, now))
            if sig is None or sig.is_stale(cfg.strategy.signal_max_age_ms, now):
                continue
            entry_px = px * (1 + self.slip_pct / 100 + self.spread_pct / 200)
            qty = order_quote / entry_px
            fee = order_quote * self.fee_pct / 100
            s = cfg.strategy
            pos = Position(symbol=symbol, qty=qty, entry_price=entry_px,
                           entry_ts=candles[i].ts / 1000,
                           entry_oid=f"bt-{i}", fees_paid=fee,
                           stop_price=min(sig.stop_price,
                                          entry_px * (1 - s.stop_loss_pct / 100)),
                           take_price=sig.take_price,
                           trail_activate_pct=s.trail_activate_pct,
                           trail_offset_pct=s.trail_offset_pct,
                           time_exit_sec=s.time_exit_sec,
                           max_hold_sec=s.max_hold_sec,
                           highest_px=entry_px,
                           trail_steps=(s.knife_steps if sig.reasons[0] == "knife"
                                        else s.trail_steps),
                           meta={"signal": sig.reasons})
        res = BTResult(symbol, trades)
        return res

    def _bt_exit_check(self, pos: Position, c: ind.Candle) -> str | None:
        """Intra-candle exit: conservative ordering (stop checked first)."""
        now = c.ts / 1000
        if c.low <= pos.stop_price:
            return "stop_loss" if not pos.trailing else "trailing_stop"
        reason = pos.update(c.high, now)
        if reason:
            return reason
        # then close-based checks for time exits
        reason = pos.update(c.close, now)
        if reason and reason != "take_profit":
            return reason
        return None

    # ------------------------------------------------- splits / walkforward
    def out_of_sample(self, symbol: str, candles: list[ind.Candle],
                      train_frac: float = 0.7) -> dict:
        cut = int(len(candles) * train_frac)
        train = self.run(symbol, candles[:cut])
        test = self.run(symbol, candles[cut:])
        return {"train_trades": len(train.trades),
                "test_trades": len(test.trades),
                "train": train.trades, "test": test.trades}

    def walk_forward(self, symbol: str, candles: list[ind.Candle],
                     folds: int = 4) -> list[dict]:
        """Successive out-of-sample windows (anchored walk-forward)."""
        n = len(candles)
        step = n // (folds + 1)
        results = []
        for k in range(folds):
            test_start = step * (k + 1)
            test_end = min(step * (k + 2), n)
            res = self.run(symbol, candles[test_start:test_end])
            results.append({"fold": k,
                            "window": [test_start, test_end],
                            "trades": len(res.trades),
                            "net_pnl": round(sum(t["net_pnl"]
                                                 for t in res.trades), 4)})
        return results
