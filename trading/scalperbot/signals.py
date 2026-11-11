"""Entry strategy (plan C): volatility spike -> uptrend -> pullback ->
selling pressure easing -> reversal confirmation -> expected-profit gate.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from . import indicators as ind
from .market_data import SymbolState


def signal_path(reasons) -> str:
    """Classify the actual entry path; never disguise unknown paths as gated."""
    if not reasons:
        return "unknown"
    if isinstance(reasons, str):
        reasons = [reasons]
    first = str(reasons[0]).lower()
    if first.startswith("knife"):
        return "knife"
    if first.startswith("new_bot"):
        return "new"
    if first.startswith("claude"):
        return "claude"
    if first.startswith("swing"):
        return "swing"
    if any("rhythm" in str(r).lower() for r in reasons):
        return "rhythm"
    if first.startswith("adopted-orphan"):
        return "adopted-orphan"
    if first.startswith("rescue:"):
        return "manual"
    if first.startswith(("vol_path=", "gated")):
        return "gated"
    return "unknown"


@dataclass
class EntrySignal:
    symbol: str
    ts_ms: int
    price: float
    atr_pct: float
    pullback_pct: float
    expected_profit_pct: float          # after fees/spread/slippage
    stop_price: float
    take_price: float
    reasons: list[str] = field(default_factory=list)
    score: float = 0.0
    estimated_cost_pct: float = 0.0
    trail_steps: list | None = None     # per-signal ladder (Claude R-ladder)

    def is_stale(self, max_age_ms: int, now: int) -> bool:
        return now - self.ts_ms > max_age_ms


class SignalEngine:
    def __init__(self, cfg):
        self.cfg = cfg

    def bull_flags(self, candles, now_ms_: int) -> list[bool]:
        interval_ms = (60_000 if self.cfg.market.candle_interval == "1min"
                       else 900_000)
        return ind.bull_progress(candles, now_ms_, interval_ms,
                                 self.cfg.strategy.min_bull_pct)

    @staticmethod
    def rhythm_bulls_ok(flags: list[bool]) -> bool:
        """The latest completed strong green and the forming green are required."""
        return len(flags) == 3 and flags[1] and flags[2]

    def rhythm_geometry(self, candles, price: float,
                        now_ms_: int | None = None) -> tuple[dict | None, str]:
        """Use active, completed-bar swings rather than an old range."""
        s = self.cfg.strategy
        candles = list(candles)
        is_15m = self.cfg.market.candle_interval == "15min"
        interval = 900_000 if is_15m else 60_000
        forming = bool(candles and now_ms_ is not None and
                       candles[-1].ts == now_ms_ // interval * interval)
        completed = candles[:-1] if forming else candles
        if len(completed) < max(60, self.cfg.market.min_history_candles):
            return None, "history"
        atr_v = ind.atr(completed, s.atr_period)
        if not atr_v or price <= 0:
            return None, "ATR"
        width = 3 if is_15m else 2
        pivots = completed[-(s.rhythm_window_bars_15m if is_15m else 60):]
        peaks, troughs = ind.swing_points(pivots, width)
        if len(peaks) < s.rhythm_min_pivots or \
                len(troughs) < s.rhythm_min_pivots:
            return None, "no recent confirmed swings"
        trough_i, lo = troughs[-1]
        age = len(pivots) - 1 - trough_i + int(forming)
        if age > (6 if is_15m else 8):
            return None, "old trough"
        if peaks[-1][0] > trough_i:
            return None, "await next trough"
        peak_age = len(pivots) - 1 - peaks[-1][0] + int(forming)
        if peak_age > (12 if is_15m else 15):
            return None, "old peak"
        prior_peaks = [(i, high) for i, high in peaks
                       if 0 < trough_i - i <= (12 if is_15m else 24)]
        if len(prior_peaks) < 2:
            return None, "need two recent peaks"
        hi = max(high for _, high in prior_peaks)
        repeat_hi = min(high for _, high in prior_peaks[-2:])
        if hi <= lo:
            return None, "invalid range"
        if (lo < troughs[-2][1] - atr_v and
                price < troughs[-2][1]):
            return None, "previous trough broken"
        range_atr = ((hi - lo) / lo * price / atr_v) if lo > 0 else 0
        if range_atr < s.rhythm_min_range_atr:
            return None, "range too small"
        # A succession of materially lower peaks AND troughs is a slide,
        # even if the newest three candles briefly turn green.
        if (peaks[-1][1] < peaks[-2][1] - 0.5 * atr_v and
                troughs[-1][1] < troughs[-2][1] - 0.5 * atr_v):
            return None, "lower peaks and troughs"
        zone = (price - lo) / (hi - lo)
        return {"hi": hi, "repeat_hi": repeat_hi, "lo": lo,
                "atr": atr_v, "range_atr": range_atr,
                "zone": zone, "trough_age": age}, ""

    def rhythm_payoff_limits(self) -> tuple[float, float, float]:
        s = self.cfg.strategy
        is_15m = self.cfg.market.candle_interval == "15min"
        return (
            s.rhythm_max_stop_pct if s.rhythm_max_stop_pct is not None
            else (2.0 if is_15m else 1.5),
            s.rhythm_min_path_pct if s.rhythm_min_path_pct is not None
            else (3.0 if is_15m else 2.0),
            s.rhythm_min_reward_risk if s.rhythm_min_reward_risk is not None
            else (1.25 if is_15m else 1.1),
        )

    @staticmethod
    def _blocked(blockers: list[str] | None, reason: str):
        if blockers is not None:
            blockers.append(reason)
        return None

    def dumping(self, st: SymbolState, price: float) -> bool:
        """A 12h sustained decline, rather than a normal range pullback."""
        s = self.cfg.strategy
        bars = (st.macro_candles if self.cfg.market.candle_interval == "1min"
                else list(st.candles))
        w = bars[-s.dying_lookback_bars:]
        if len(w) < s.dying_lookback_bars or \
                w[-1].ts - w[0].ts < (s.dying_lookback_bars - 2) * 900_000:
            return True  # no 12h data: do not trade unverified setups
        peak = max(c.high for c in w)
        early_high = max(c.high for c in w[:-16])
        recent_high = max(c.high for c in w[-16:])
        return (peak > 0
                and price <= peak * (1 - s.dying_dump_pct / 100)
                and recent_high < early_high * 0.97)

    def evaluate(self, cand, st: SymbolState, now_ms_: int,
                 order_size_quote: float) -> EntrySignal | None:
        """Returns an EntrySignal or None. `cand` is a scanner Candidate."""
        s, cfg = self.cfg.strategy, self.cfg
        candles = list(st.candles)
        if len(candles) < cfg.market.min_history_candles:
            return None
        closes = [c.close for c in candles]
        price = st.last_price or closes[-1]
        if price <= 0:
            return None

        # 1. volatility - TWO paths: a fresh spike OR a permanently wild coin
        atr_v = ind.atr(candles, s.atr_period)
        if not atr_v or atr_v <= 0:
            return None
        atr_pct_v = atr_v / price * 100
        rel_vol = ind.relative_volatility(closes, 10, 60) or 0
        vol_path = ("spike" if rel_vol >= s.vol_spike_factor
                    else "atr" if atr_pct_v >= s.atr_min_pct else None)
        if vol_path is None:
            return None

        # 2. valid upward trend --------------------------------------------
        ef, es = ind.ema(closes, s.ema_fast), ind.ema(closes, s.ema_slow)
        if ef is None or es is None or ef <= es:
            return None

        # 3-4. pullback from recent local high, deep enough ---------------
        hi = ind.local_high(candles, 30)
        if hi is None or price >= hi * 0.999:
            return None                       # still at highs, wait for dip
        pb_pct = (hi - price) / hi * 100
        pb_atr = pb_pct / atr_pct_v if atr_pct_v else 0
        if pb_atr < s.pullback_min_atr:
            return None                       # not deep enough yet
        if pb_atr > s.pullback_max_atr or pb_pct > s.pullback_max_pct:
            return None                       # continuing decline, not a dip

        # avoid entries after an extended run ------------------------------
        run = ind.runup_pct(candles, 30)
        if run is not None and run > s.extended_move_pct:
            return None

        # 5-6. selling pressure easing + reversal confirmation --------------
        buy_ratio = ind.taker_buy_ratio(
            list(st.trades), now_ms_ - s.reversal_lookback_sec * 1000)
        last_c = candles[-1]
        prev_c = candles[-2]
        if self.dumping(st, price):
            return None
        candle_rev = all(self.bull_flags(candles, now_ms_))
        tick_rev = buy_ratio is not None and buy_ratio >= s.reversal_min_buy_ratio
        ob = ind.orderbook_metrics(st.bids, st.asks)
        book_rev = ob["imbalance"] is not None and \
            ob["imbalance"] > s.reversal_min_imbalance
        if not (candle_rev and tick_rev):
            return None

        # 7-8. expected profit after fees, spread, slippage ------------------
        spread = ob["spread_pct"] or self.cfg.market.max_spread_pct
        slip = ind.expected_slippage_pct(st.asks, order_size_quote)
        if slip is None:
            slip = s.stop_loss_pct              # thin book -> assume worst
        costs_pct = (self.cfg.execution.taker_fee_pct * 2       # in + out
                     + spread + slip)
        # expected move: ATR-scaled target
        target_pct = min(s.take_profit_pct, atr_pct_v * 0.8)
        expected = target_pct - costs_pct
        if expected < s.expected_profit_min_pct:
            return None

        return EntrySignal(
            symbol=cand.symbol, ts_ms=now_ms_, price=price,
            atr_pct=atr_pct_v, pullback_pct=pb_pct,
            expected_profit_pct=expected,
            stop_price=price * (1 - s.stop_loss_pct / 100),
            take_price=price * (1 + target_pct / 100),
            score=cand.score,
            reasons=[
                f"vol_path={vol_path}(relvol={rel_vol:.2f},atr={atr_pct_v:.2f}%)",
                "ema_up",
                f"pullback={pb_pct:.2f}%/{pb_atr:.1f}ATR",
                f"rev(candle={candle_rev},tick={tick_rev},book={book_rev})",
                f"exp_net={expected:.2f}% > {s.expected_profit_min_pct}%",
            ])

    def evaluate_knife(self, st: SymbolState, now_ms_: int):
        """Path 4: falling knife. Wait for the crash candle to COMPLETE,
        then enter on the next candle turning bullish. Stop = where the
        red candle ended, zero leeway; target = 80% retracement."""
        s = self.cfg.strategy
        c = list(st.candles)
        if not getattr(s, "knife_enabled", False) or len(c) < 40:
            return None
        kc = c[-2]                          # last COMPLETED bar; c[-1] is forming
        drop = (kc.open - kc.close) / kc.open if kc.open else 0
        if drop * 100 < s.knife_drop_pct:   # ONE massive red candle, not a bleed
            return None
        hi, lo = kc.high, kc.low
        cur = st.last_price or c[-1].close
        # next candle must be bullish AND reclaim knife_turn_pct of the
        # crash range (open->low): big crashes demand bigger proof of a turn
        if cur <= c[-1].open or \
                cur < kc.low + (kc.open - kc.low) * s.knife_turn_pct / 100:
            return None
        buy_ratio = ind.taker_buy_ratio(
            list(st.trades),
            now_ms_ - self.cfg.strategy.reversal_lookback_sec * 1000) \
            if st.trades else None
        if (buy_ratio or 0) < 0.5:
            return None
        hist = c[max(0, len(c) - 2 - s.knife_rec_hist):-2]
        knives = bounced = 0
        for i, k in enumerate(hist):
            kd = (k.open - k.close) / k.open if k.open else 0
            if kd * 100 < s.knife_drop_pct:  # same definition: one big red body
                continue
            knives += 1
            for j in range(i + 1, min(i + 31, len(hist))):
                if hist[j].high >= k.low * (1 + kd * s.knife_rec_ratio):
                    bounced += 1
                    break
        if knives < s.knife_rec_min or \
                bounced / knives < s.knife_rec_rate:
            return None
        sig = EntrySignal(
            symbol=st.symbol, ts_ms=now_ms_, price=cur,
            atr_pct=drop * 100, pullback_pct=drop * 100,
            expected_profit_pct=drop * s.knife_target_ratio * 100,
            stop_price=kc.close * (1 - s.knife_stop_buffer_pct / 100),
            take_price=lo + (hi - lo) * s.knife_target_ratio,
            reasons=["knife", f"drop:{drop * 100:.1f}%",
                     f"record:{bounced}/{knives}"])
        sig.knife = {"drop_pct": drop * 100, "knives": knives,
                     "bounced": bounced, "knife_low": lo}
        return sig

    def evaluate_rhythm(self, cand, st: SymbolState, now_ms_: int,
                        order_size_quote: float,
                        blockers: list[str] | None = None,
                        fee_pct: float | None = None,
                        market_shock: bool = False) -> EntrySignal | None:
        """PATH 3 - peak/trough rollercoaster: buy the bottom of the range.

        Requirements (deliberately few): the coin has formed real swings
        (pivot highs AND lows), the range is fat vs its ATR, price is in
        the trough zone but hasn't broken it, and it beats fees."""
        s = self.cfg.strategy
        if not s.rhythm_enabled:
            return self._blocked(blockers, "rhythm off")
        candles = list(st.candles)
        if not candles:
            return self._blocked(blockers, "no candles")
        price = st.last_price or candles[-1].close
        setup, reason = self.rhythm_geometry(candles, price, now_ms_)
        if setup is None:
            return self._blocked(blockers, reason)
        hi, lo, atr_v = setup["hi"], setup["lo"], setup["atr"]
        rng_pct = (hi - lo) / lo * 100
        atr_pct_v = atr_v / price * 100
        max_stop, min_path, min_rr = self.rhythm_payoff_limits()
        stop_price = lo * (1 - s.stop_loss_pct / 400)
        stop_pct = max(s.stop_loss_pct, (price - stop_price) / price * 100)
        if stop_pct > max_stop:
            return self._blocked(
                blockers, f"stop {stop_pct:.1f}% > {max_stop:g}% limit")
        if self.dumping(st, price):
            return self._blocked(blockers, "12h decline")
        zone = lo + (hi - lo) * s.rhythm_zone_pct
        if price > zone or price < lo * 0.995:
            return self._blocked(blockers, "outside trough")
        if price > lo * 1.10:
            return self._blocked(blockers, "too far above floor")
        _bf = self.bull_flags(candles, now_ms_)
        if market_shock:
            bulls = _bf[1] or _bf[2]      # panic tape: any green turn counts
        else:
            bulls = self.rhythm_bulls_ok(_bf)
        if not bulls:
            return self._blocked(blockers, "latest strong green + live green")
        buy_ratio = ind.taker_buy_ratio(
            list(st.trades), now_ms_ - s.reversal_lookback_sec * 1000)
        if buy_ratio is None or buy_ratio < 0.5:
            return self._blocked(blockers, "buyers <50% / no live flow")
        ob = ind.orderbook_metrics(st.bids, st.asks)
        spread = ob["spread_pct"]
        slip = ind.expected_slippage_pct(st.asks, order_size_quote)
        exit_slip = ind.expected_sell_slippage_pct(st.bids, order_size_quote)
        if spread is None or slip is None or exit_slip is None or \
                spread > self.cfg.market.max_spread_pct:
            return self._blocked(blockers, "spread / book depth")
        taker_fee = (self.cfg.execution.taker_fee_pct if fee_pct is None
                     else fee_pct)
        costs_pct = taker_fee * 2 + spread + slip + exit_slip
        steps = s.rhythm_trail_steps or s.trail_steps
        first_rung_net = steps[0][0] - steps[0][1] - costs_pct
        if s.rhythm_trail_steps:
            if (s.rhythm_max_roundtrip_cost_pct is not None and
                    costs_pct > s.rhythm_max_roundtrip_cost_pct):
                return self._blocked(
                    blockers, f"round-trip costs {costs_pct:.2f}% too high")
            payoff_step = steps[1] if len(steps) > 1 else steps[0]
            realistic_net = payoff_step[0] - payoff_step[1] - costs_pct
            realistic_rr = realistic_net / (stop_pct + costs_pct)
            if realistic_rr < s.rhythm_realistic_reward_risk:
                return self._blocked(
                    blockers, f"ladder payoff/risk {realistic_rr:.2f} "
                    f"< {s.rhythm_realistic_reward_risk:g}")
        elif first_rung_net < 0.2:
            return self._blocked(
                blockers, f"first rung net {first_rung_net:.2f}% < 0.2%")
        # The lower of two confirmed peaks is a more plausible repeat than
        # the single highest wick; the ladder itself remains uncapped.
        reachable_pct = (setup["repeat_hi"] * 0.995 - price) / price * 100
        net_path = reachable_pct - costs_pct
        if net_path < max(min_path, s.expected_profit_min_pct):
            return self._blocked(blockers,
                                 f"net path {net_path:.1f}% < {min_path:g}%")
        rr = net_path / (stop_pct + costs_pct)
        if rr < min_rr:
            return self._blocked(blockers,
                                 f"reward/risk {rr:.1f} < {min_rr:g}")
        return EntrySignal(
            symbol=cand.symbol, ts_ms=now_ms_, price=price,
            atr_pct=atr_pct_v,
            pullback_pct=(hi - price) / hi * 100,
            expected_profit_pct=net_path,
            stop_price=stop_price,                 # below the trough
            take_price=hi * 0.995,
            score=cand.score,
            estimated_cost_pct=costs_pct,
            reasons=[f"rhythm range={rng_pct/atr_pct_v:.1f}ATR "
                     f"({lo:.5f}-{hi:.5f})", f"trough_zone<{s.rhythm_zone_pct}",
                     f"stable(buy={buy_ratio})",
                     f"net_path={net_path:.2f}%/risk={stop_pct+costs_pct:.2f}%",
                     f"reward_risk={rr:.2f}",
                     f"first_rung_net={first_rung_net:.2f}% fee={taker_fee:.2f}%",
                     f"ladder_payoff_risk={realistic_rr:.2f}"
                     if s.rhythm_trail_steps else "legacy_ladder"])
