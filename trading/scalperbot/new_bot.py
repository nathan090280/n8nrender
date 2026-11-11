"""Independent, liquid-market intraday momentum strategy for Chatty.

No swing-pivot, rhythm-zone, or three-candle requirements. The existing
exchange and position managers still own all money movement and stop state.
"""
from __future__ import annotations

from collections import Counter

from .indicators import (
    expected_sell_slippage_pct, expected_slippage_pct, orderbook_metrics)
from .signals import EntrySignal


class NewStrategy:
    def __init__(self, cfg):
        self.cfg = cfg
        self._confirm = {}               # symbol -> (pass_ts_ms, streak)

    @staticmethod
    def market_change(market_bars, now_ms, hours=12.0):
        """BTC % move over `hours` of finished 15m bars; None if unverifiable."""
        n = int(hours * 4)
        finished = [c for c in market_bars
                    if c.ts + 900_000 <= now_ms]
        if (len(finished) < n + 1 or
                finished[-1].ts - finished[-1 - n].ts < n * 900_000 or
                now_ms - finished[-1].ts > 30 * 60_000 or
                finished[-1 - n].close <= 0):
            return None
        return (finished[-1].close / finished[-1 - n].close - 1) * 100

    def symbol_uptrend(self, st, price) -> bool:
        """Confirmed sustained up-move. While true the position's red
        time-exit is suspended so a bull run can develop — the stop and
        ladder still manage it. Recomputed every tick: once the trend
        breaks, the clock rule resumes."""
        s = self.cfg.strategy
        if not getattr(s, "new_momentum_hold", False):
            return False
        cs = list(st.candles)
        completed = cs[:-1] if len(cs) > 1 else []
        if len(completed) < 31 or price <= 0:
            return False
        if (price / completed[-30].close - 1) * 100 < s.new_momo_trend30_pct:
            return False
        if not (completed[-1].close > completed[-15].close >
                completed[-30].close):
            return False                       # 15m blocks must keep rising
        peak = max(c.high for c in completed[-30:])
        return price >= peak * (1 - s.new_momo_off_high_pct / 100)

    def candle_setup(self, completed, forming_open, price, macro):
        """Price-only setup; live entries also need fresh flow and book checks."""
        if len(completed) < 60 or price <= 0:
            return None, "warming candles"
        if (len(macro) < 40 or
                macro[-1].ts - macro[0].ts < 10 * 3_600_000):
            return None, "warming 12h context"
        min_up = self.cfg.strategy.new_min_uptick_pct / 100
        if price < forming_open * (1 + min_up):
            return None, "no live uptick"
        mom5 = (price / completed[-6].close - 1) * 100
        if not 0.20 <= mom5 <= 2.0:
            return None, "5m momentum out of range"
        if price < completed[-12].close:
            return None, "12m trend down"
        trend30 = (price / completed[-30].close - 1) * 100
        if trend30 < self.cfg.strategy.new_min_trend30_pct:
            return None, "30m trend too weak"
        recent10 = completed[-10:]
        range10 = (max(c.high for c in recent10) -
                   min(c.low for c in recent10)) / price * 100
        if range10 < self.cfg.strategy.new_min_range10_pct:
            return None, "10m range too small"
        peak60 = max(c.high for c in completed[-60:])
        if price < peak60 * 0.94:
            return None, "60m dump"
        high12 = max(c.high for c in macro)
        if (price < high12 * 0.90 and
                max(c.high for c in macro[-8:]) <
                max(c.high for c in macro[:-8]) * 0.97):
            return None, "sustained 12h decline"
        recent_high = max(c.high for c in completed[-8:])
        if price > recent_high * 1.005:
            return None, "chasing spike"
        vwap = sum(c.close * c.volume for c in completed[-20:]) / max(
            sum(c.volume for c in completed[-20:]), 1e-12)
        if not vwap * 1.0003 <= price <= vwap * 1.012:
            return None, "outside rising value"
        return mom5, ""

    def evaluate(self, st, fee_pct: float, quote_size: float,
                 now_ms: int, market_bars=None) -> tuple[EntrySignal | None, str]:
        sig, reason = self._screen(st, fee_pct, quote_size, now_ms,
                                 market_bars)
        if sig is None:
            self._confirm.pop(st.symbol, None)
            return None, reason
        need = max(1, int(self.cfg.strategy.new_persist_cycles))
        ts, streak = self._confirm.get(st.symbol, (0, 0))
        streak = streak + 1 if now_ms - ts < 120_000 else 1
        self._confirm[st.symbol] = (now_ms, streak)
        if streak < need:
            return None, f"confirming {streak}/{need}"
        self._confirm.pop(st.symbol, None)
        return sig, ""

    def _screen(self, st, fee_pct: float, quote_size: float,
                now_ms: int, market_bars=None) -> tuple[EntrySignal | None, str]:
        if fee_pct > self.cfg.strategy.max_taker_fee_pct:
            return None, "fee cap"
        s = self.cfg.strategy
        lb = s.new_btc_lookback_h
        btc_change = self.market_change(market_bars or [], now_ms, lb)
        if btc_change is None:
            return None, f"BTC {lb:g}h context missing"
        if btc_change <= s.new_min_btc_regime_pct:
            return None, f"BTC {lb:g}h down {btc_change:.1f}%"
        btc_1h = self.market_change(market_bars or [], now_ms, 1.0)
        if btc_1h is not None and btc_1h < s.new_min_btc_1h_pct:
            return None, f"BTC 1h weak {btc_1h:+.2f}%"
        cs = list(st.candles)
        if len(cs) < 61 or not st.last_price:
            return None, "warming candles"
        # A missing forming candle is not a live momentum signal.
        if not 0 <= now_ms - cs[-1].ts < 60_000:
            return None, "stale candle"
        price = st.last_price
        mom5, reason = self.candle_setup(
            cs[:-1], cs[-1].open, price, st.macro_candles)
        if mom5 is None:
            return None, reason
        ticks = [(ts, sz, side) for ts, _, sz, side in st.trades
                 if now_ms - 45_000 <= ts <= now_ms]
        if len(ticks) < 3:
            return None, "await buyer ticks"
        bought = sum(sz for _, sz, side in ticks if side == "buy")
        total = sum(sz for _, sz, _ in ticks)
        if not total or bought / total < 0.53:
            return None, "buyers <53%"
        book = orderbook_metrics(st.bids, st.asks)
        if (book["spread_pct"] is None or
                book["spread_pct"] > self.cfg.market.max_spread_pct):
            return None, "wide spread / no book"
        buy_slip = expected_slippage_pct(st.asks, quote_size)
        sell_slip = expected_sell_slippage_pct(st.bids, quote_size)
        if buy_slip is None or sell_slip is None:
            return None, "thin book"
        costs = 2 * fee_pct + book["spread_pct"] + buy_slip + sell_slip
        stop_pct = self.cfg.strategy.stop_loss_pct
        first = self.cfg.strategy.trail_steps[0]
        net_lock = first[0] - first[1] - costs
        if net_lock < 0.5 * (stop_pct + costs):
            return None, "ladder payoff after costs"
        return EntrySignal(
            symbol=st.symbol, ts_ms=now_ms, price=price,
            atr_pct=0, pullback_pct=0, expected_profit_pct=net_lock,
            stop_price=price * (1 - stop_pct / 100),
            take_price=price * (1 + first[0] / 100),
            reasons=["new_bot:intraday_momentum",
                     f"5m={mom5:.2f}% buyers={bought/total:.0%}",
                     f"first_lock_net={net_lock:.2f}% costs={costs:.2f}%"],
            score=mom5, estimated_cost_pct=costs), ""

    def runner_evaluate(self, st, fee_pct: float, quote_size: float,
                        now_ms: int,
                        market_bars=None) -> tuple[EntrySignal | None, str]:
        """Buy strength: enter a confirmed bull run mid-move. Same BTC /
        flow / book / cost gates as the normal path — only the price
        signature differs (sustained rising 15m blocks near 60m highs,
        capped so we don't buy the blow-off)."""
        if not getattr(self.cfg.strategy, "new_runner_enabled", False):
            return None, "runner off"
        sig, reason = self._runner_screen(st, fee_pct, quote_size, now_ms,
                                        market_bars)
        if sig is None:
            self._confirm.pop("run:" + st.symbol, None)
            return None, reason
        need = max(1, int(self.cfg.strategy.new_persist_cycles))
        ts, streak = self._confirm.get("run:" + st.symbol, (0, 0))
        streak = streak + 1 if now_ms - ts < 120_000 else 1
        self._confirm["run:" + st.symbol] = (now_ms, streak)
        if streak < need:
            return None, f"runner confirming {streak}/{need}"
        self._confirm.pop("run:" + st.symbol, None)
        return sig, ""

    def _runner_screen(self, st, fee_pct: float, quote_size: float,
                       now_ms: int, market_bars=None):
        if fee_pct > self.cfg.strategy.max_taker_fee_pct:
            return None, "fee cap"
        s = self.cfg.strategy
        btc_1h = self.market_change(market_bars or [], now_ms, 1.0)
        if btc_1h is not None and btc_1h < s.new_min_btc_1h_pct:
            return None, f"BTC 1h weak {btc_1h:+.2f}%"
        cs = list(st.candles)
        if len(cs) < 61 or not st.last_price:
            return None, "warming candles"
        if not 0 <= now_ms - cs[-1].ts < 60_000:
            return None, "stale candle"
        price = st.last_price
        completed = cs[:-1]
        if len(completed) < 45:
            return None, "warming candles"
        trend30 = (price / completed[-30].close - 1) * 100
        if not (s.new_runner_trend30_pct <= trend30
                <= s.new_runner_max_trend30_pct):
            return None, f"trend30 {trend30:.2f}% out of band"
        if not (completed[-1].close > completed[-15].close >
                completed[-30].close):
            return None, "15m blocks not rising"
        peak30 = max(c.high for c in completed[-30:])
        if price < peak30 * (1 - s.new_runner_off_high_pct / 100):
            return None, "off the highs"
        peak60 = max(c.high for c in completed[-60:])
        if price < peak60 * 0.99:
            return None, "not at 60m highs"
        ticks = [(ts, sz, side) for ts, _, sz, side in st.trades
                 if now_ms - 45_000 <= ts <= now_ms]
        if len(ticks) < 3:
            return None, "await buyer ticks"
        bought = sum(sz for _, sz, side in ticks if side == "buy")
        total = sum(sz for _, sz, _ in ticks)
        if not total or bought / total < 0.53:
            return None, "buyers <53%"
        book = orderbook_metrics(st.bids, st.asks)
        if (book["spread_pct"] is None or
                book["spread_pct"] > self.cfg.market.max_spread_pct):
            return None, "wide spread / no book"
        buy_slip = expected_slippage_pct(st.asks, quote_size)
        sell_slip = expected_sell_slippage_pct(st.bids, quote_size)
        if buy_slip is None or sell_slip is None:
            return None, "thin book"
        costs = 2 * fee_pct + book["spread_pct"] + buy_slip + sell_slip
        stop_pct = self.cfg.strategy.stop_loss_pct
        first = self.cfg.strategy.trail_steps[0]
        net_lock = first[0] - first[1] - costs
        if net_lock < 0.5 * (stop_pct + costs):
            return None, "ladder payoff after costs"
        return EntrySignal(
            symbol=st.symbol, ts_ms=now_ms, price=price,
            atr_pct=0, pullback_pct=0, expected_profit_pct=net_lock,
            stop_price=price * (1 - stop_pct / 100),
            take_price=price * (1 + first[0] / 100),
            reasons=["new_bot:runner",
                     f"trend30={trend30:.2f}% buyers={bought/total:.0%}",
                     f"first_lock_net={net_lock:.2f}% costs={costs:.2f}%"],
            score=trend30, estimated_cost_pct=costs), ""

    @staticmethod
    def universe(tickers: list[dict], metadata: dict, cfg,
                 exclude: set | frozenset = frozenset()) -> list[str]:
        eligible = []
        for t in tickers:
            sym = t.get("symbol", "")
            if (not sym.endswith("-USDT") or
                    not metadata.get(sym, {}).get("enableTrading") or
                    sym in cfg.market.blacklist or sym in exclude):
                continue
            if cfg.market.watchlist and sym not in cfg.market.watchlist:
                continue
            vol = float(t.get("volValue") or 0)
            change = float(t.get("changeRate") or 0) * 100
            if vol < cfg.market.min_24h_quote_volume or not -8 < change < 20:
                continue
            eligible.append((sym, vol, change))
        liquid = sorted(eligible, key=lambda t: t[1], reverse=True)[:6]
        movers = sorted(eligible, key=lambda t: abs(t[2]), reverse=True)[:12]
        return list(dict.fromkeys(t[0] for t in liquid + movers))[:18]


def summarize(blockers: list[str]) -> list[tuple[str, int]]:
    return Counter(blockers).most_common(6)
