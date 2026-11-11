"""Claude: evidence-chosen spot scalper (1m and 15m).

Three entry engines live here - trend breakout, trend pullback-reclaim and
capitulation reversion ("revert"). They were replayed on real KuCoin candles
(7d x 40 pairs on 1m, 45d x 40 pairs on 15m) with 0.1%/side fees: both
trend engines lost in both halves of the sample, reversion was the only one
near or above break-even, so `entry_mode` defaults to "revert". Revert buys
a flush stretched >= 3 ATR below value on heavy volume only once price
turns (takes out the prior bar's high), live buyers are in control, BTC is
not flushing and market breadth is not collapsing; it waits a few seconds
for the turn to hold before committing.

Risk is defined by structure/ATR (tight), sized by the caller so a stop
costs a fixed slice of equity (scales with the pot), and the exit ladder is
denominated in R (the stop distance): breakeven-after-fees at +1R, lock +1R
at +2R, then a widening trail so moons are ridden, not capped.

Self-contained maths on purpose: no signal code shared with other bots.
"""
from __future__ import annotations

import math
from collections import Counter

from .indicators import Candle
from .signals import EntrySignal

STABLES = {"USDC", "DAI", "TUSD", "FDUSD", "USDE", "PYUSD", "USD1", "USDD",
           "BUSD", "EURC", "USDP"}

PROFILES = {
    "1min": {
        "tag": "1m", "interval_ms": 60_000, "eval_sec": 4, "bars_needed": 80,
        "entry_mode": "revert", "pb_bars": 6, "pb_lookback": 14,
        "pb_touch_atr": 0.3, "pb_break_atr": 0.3, "pb_min_depth_atr": 1.2,
        "pb_max_chase_atr": 1.8, "pb_vol_mult": 1.0, "pb_stop_buf_atr": 0.15,
        "mr_bars": 3, "mr_stretch_atr": 3.5, "mr_vol_mult": 2.0,
        "mr_max_chase_atr": 1.2, "mr_stop_buf_atr": 0.2, "mr_min_room_r": 1.5,
        "mr_htf_floor_atr": 3.0,
        "ema": (9, 21, 55), "slope_bars": 10, "atr_n": 14,
        "breakout_n": 20, "vol_n": 30, "vol_mult": 1.6,
        "max_past_level_atr": 1.0, "max_ext_atr": 2.2, "max_bar_atr": 2.5,
        "run_bars": 60, "max_run_atr": 9.0,
        "min_stop": 0.45, "max_stop": 1.1, "atr_stop": 1.5, "struct_bars": 3,
        "flow_ms": 60_000, "flow_recent_ms": 15_000, "min_trades": 8,
        "min_buy": 0.58, "min_recent_buy": 0.5,
        "max_slip": 0.08, "min_depth_ratio": 0.6, "max_cost_r": 0.6,
        "confirm_ms": 8_000, "htf": "15min", "htf_ms": 900_000,
        "htf_ema": 20, "htf_ttl": 600,
        "btc_bars": 60, "btc_label": "1h", "btc_min": -1.5, "btc_low_bars": 10,
        "btc_flush_bars": 5, "btc_flush": -0.4, "btc_ema": 50,
        "min_breadth": 0.30, "universe_n": 24, "min_vol": 1_000_000,
        "chg_lo": -4.0, "chg_hi": 30.0,
        "cd_base": 900, "cd_cap": 14_400,
    },
    "15min": {
        "tag": "15m", "interval_ms": 900_000, "eval_sec": 15, "bars_needed": 80,
        "entry_mode": "revert", "pb_bars": 5, "pb_lookback": 10,
        "pb_touch_atr": 0.3, "pb_break_atr": 0.3, "pb_min_depth_atr": 1.2,
        "pb_max_chase_atr": 1.8, "pb_vol_mult": 1.0, "pb_stop_buf_atr": 0.15,
        "mr_bars": 3, "mr_stretch_atr": 3.0, "mr_vol_mult": 1.5,
        "mr_max_chase_atr": 1.2, "mr_stop_buf_atr": 0.2, "mr_min_room_r": 2.0,
        "mr_htf_floor_atr": 3.0,
        "ema": (9, 21, 55), "slope_bars": 8, "atr_n": 14,
        "breakout_n": 12, "vol_n": 24, "vol_mult": 1.4,
        "max_past_level_atr": 1.0, "max_ext_atr": 2.5, "max_bar_atr": 2.5,
        "run_bars": 48, "max_run_atr": 10.0,
        "min_stop": 0.9, "max_stop": 2.4, "atr_stop": 1.3, "struct_bars": 2,
        "flow_ms": 180_000, "flow_recent_ms": 45_000, "min_trades": 10,
        "min_buy": 0.56, "min_recent_buy": 0.5,
        "max_slip": 0.10, "min_depth_ratio": 0.6, "max_cost_r": 0.45,
        "confirm_ms": 30_000, "htf": "1hour", "htf_ms": 3_600_000,
        "htf_ema": 20, "htf_ttl": 1800,
        "btc_bars": 16, "btc_label": "4h", "btc_min": -3.0, "btc_low_bars": 4,
        "btc_flush_bars": 2, "btc_flush": -0.8, "btc_ema": 50,
        "min_breadth": 0.30, "universe_n": 20, "min_vol": 500_000,
        "chg_lo": -5.0, "chg_hi": 40.0,
        "cd_base": 3600, "cd_cap": 43_200,
    },
}


# ------------------------------------------------------------------ maths
def _ema(vals: list[float], n: int) -> list[float] | None:
    """EMA series aligned to vals[n-1:], SMA-seeded."""
    if len(vals) < n:
        return None
    k = 2 / (n + 1)
    e = sum(vals[:n]) / n
    out = [e]
    for v in vals[n:]:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def _atr(bars: list[Candle], n: int) -> float | None:
    if len(bars) < n + 1:
        return None
    tr = [max(b.high - b.low, abs(b.high - a.close), abs(b.low - a.close))
          for a, b in zip(bars, bars[1:])]
    v = sum(tr[:n]) / n
    for t in tr[n:]:
        v = (v * (n - 1) + t) / n
    return v


def _median(xs: list[float]) -> float:
    s = sorted(xs)
    if not s:
        return 0.0
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def _fill_cost(levels: list, quote: float) -> float | None:
    """% away from best price to fill `quote` USDT by walking the book."""
    if not levels or quote <= 0 or not levels[0][0]:
        return None
    best, left, base = levels[0][0], quote, 0.0
    for px, sz in levels:
        take = min(left, px * sz)
        base += take / px
        left -= take
        if left <= 1e-9:
            break
    if left > 1e-9 or base <= 0:
        return None
    return abs(quote / base / best - 1) * 100


def split_bars(candles, now_ms: int, interval_ms: int):
    """(completed bars, forming bar or None) by timestamp, not list slot."""
    cs = list(candles)
    done = [c for c in cs if c.ts + interval_ms <= now_ms]
    forming = (cs[-1] if cs and cs[-1].ts <= now_ms < cs[-1].ts + interval_ms
               else None)
    return done, forming


def r_ladder(r: float, costs: float, be_r: float = 1.0) -> list[list[float]]:
    """Trail ladder in % of entry, built from R (stop %) and round-trip
    costs. Each rung: [gain% that arms it, give-back% from the peak]."""
    th1 = max(be_r * r, costs + 0.25)
    rungs = [[th1, th1 - costs],          # +1R: stop to breakeven after fees
             [2 * r, r],                  # +2R: lock about +1R
             [3.5 * r, 1.4 * r],          # +3.5R: lock about +2R
             [6 * r, 2 * r]]              # +6R: moon trail, 2R below peak
    out: list[list[float]] = []
    for th, off in rungs:
        if out and th <= out[-1][0]:
            th = out[-1][0] + 0.05
        out.append([round(th, 3), round(max(off, 0.05), 3)])
    return out


# --------------------------------------------------------------- strategy
class ClaudeStrategy:
    def __init__(self, cfg):
        self.cfg = cfg
        self.p = dict(PROFILES.get(cfg.market.candle_interval,
                                   PROFILES["1min"]))
        self.p.update(getattr(cfg.strategy, "claude_params", None) or {})
        self._armed: dict[str, tuple[int, int]] = {}  # sym -> (first, last)
        self.streak: dict[str, int] = {}
        self.cool: dict[str, float] = {}

    # ---------------------------------------------------------- market
    @staticmethod
    def breadth(tickers: list[dict], quote: str, min_vol: float) -> float | None:
        up = n = 0
        for t in tickers:
            sym = t.get("symbol", "")
            if not sym.endswith("-" + quote) or sym.split("-")[0] in STABLES:
                continue
            if float(t.get("volValue") or 0) < min_vol:
                continue
            n += 1
            up += float(t.get("changeRate") or 0) > 0
        return up / n if n else None

    def regime(self, btc_bars, now_ms: int, breadth: float | None):
        p = self.p
        done, _ = split_bars(btc_bars or [], now_ms, p["interval_ms"])
        low_n = p["btc_low_bars"]
        need = max(p["btc_bars"], p["btc_ema"]) + low_n + 1
        if len(done) < need or now_ms - done[-1].ts > 3 * p["interval_ms"] + 60_000:
            return False, "BTC data missing", {}
        closes = [c.close for c in done]
        chg = (closes[-1] / closes[-1 - p["btc_bars"]] - 1) * 100
        flush = (closes[-1] / closes[-1 - p["btc_flush_bars"]] - 1) * 100
        ema = _ema(closes, p["btc_ema"])[-1]
        recent_low = min(c.low for c in done[-low_n:])
        prior_low = min(c.low for c in done[-(low_n + p["btc_bars"]):-low_n])
        info = {"btc_chg": round(chg, 2), "btc_label": p["btc_label"],
                "btc_vs_ema": round((closes[-1] / ema - 1) * 100, 2),
                "breadth": None if breadth is None else round(breadth * 100)}
        # "is a dump happening NOW?" - not a slow-trend test
        if flush <= p["btc_flush"]:
            return False, f"BTC flushing {flush:.2f}%", info
        if recent_low < prior_low:
            return False, "BTC still making new lows", info
        if chg < p["btc_min"]:
            return False, f"BTC {p['btc_label']} {chg:+.2f}%", info
        if breadth is None or breadth < p["min_breadth"]:
            return False, f"breadth {info['breadth']}% green", info
        return True, "", info

    def universe(self, tickers, meta, exclude=frozenset()) -> list[str]:
        p, m = self.p, self.cfg.market
        rows = []
        for t in tickers:
            sym = t.get("symbol", "")
            if (not sym.endswith("-" + m.quote_currency) or sym in exclude
                    or sym in m.blacklist or sym.split("-")[0] in STABLES):
                continue
            if m.watchlist and sym not in m.watchlist:
                continue
            if not meta.get(sym, {}).get("enableTrading"):
                continue
            vol = float(t.get("volValue") or 0)
            chg = float(t.get("changeRate") or 0) * 100
            if (vol < p["min_vol"] or not p["chg_lo"] < chg < p["chg_hi"]
                    or float(t.get("last") or 0) <= 0):
                continue
            rows.append((sym, vol, chg))
        heavy = [r[0] for r in sorted(rows, key=lambda r: -r[1])[:6]]
        active = [r[0] for r in sorted(
            rows, key=lambda r: -(math.log10(r[1]) + max(r[2], 0) / 4))]
        return list(dict.fromkeys(heavy + active))[:p["universe_n"]]

    # ---------------------------------------------------------- setup
    def setup(self, done: list[Candle], forming: Candle | None, price: float,
              htf_done: list[Candle], now_ms: int,
              btc_done: list[Candle] | None = None):
        """Candle-only qualification. Returns (info, "") or (None, why)."""
        p = self.p
        if len(done) < p["bars_needed"] or price <= 0:
            return None, "warming candles"
        done = done[-240:]                 # same window the live bot keeps
        closes = [c.close for c in done]
        fast, mid, slow = (_ema(closes, n) for n in p["ema"])
        mode = p.get("entry_mode", "pullback")
        trend = mode != "revert"
        if trend and not mid[-1] > slow[-1]:
            return None, "trend not stacked"
        if trend and slow[-1] <= slow[-1 - p["slope_bars"]]:
            return None, "slow trend flat"
        need_htf = max(p["htf_ema"], p.get("htf_slow", 0)) + 2
        if len(htf_done) < need_htf:
            return None, "warming HTF"
        hc = [c.close for c in htf_done]
        he = _ema(hc, p["htf_ema"])
        if trend and (hc[-1] < he[-1] or price < he[-1] or he[-1] < he[-2]):
            return None, f"{p['htf']} trend down"
        if not trend and p.get("mr_htf_floor_atr") is not None:
            h_atr = _atr(htf_done[-30:], 14) or 0
            if hc[-1] < he[-1] - p["mr_htf_floor_atr"] * h_atr:
                return None, f"{p['htf']} in freefall"
        if trend and p.get("htf_slow") and \
                he[-1] <= _ema(hc, p["htf_slow"])[-1]:
            return None, f"{p['htf']} trend not stacked"
        rs_n = p.get("rs_bars", 0)
        if rs_n:
            if not btc_done or len(btc_done) <= rs_n or len(closes) <= rs_n:
                return None, "warming relative strength"
            rs = ((price / closes[-1 - rs_n]) -
                  (btc_done[-1].close / btc_done[-1 - rs_n].close)) * 100
            if rs < p.get("rs_min", 0.0):
                return None, f"lagging BTC {rs:+.2f}%"
        atr = _atr(done[-(p["atr_n"] * 3 + 1):], p["atr_n"])
        if not atr:
            return None, "warming candles"
        if forming is not None and \
                (max(forming.high, price) - forming.low) / atr > p["max_bar_atr"]:
            return None, "spike candle"
        base = _median([c.volume for c in done[-p["vol_n"] - 1:-1]])
        if base <= 0:
            return None, "no volume"
        vol_now = done[-1].volume
        if forming is not None:
            frac = max(0.2, min(1.0, (now_ms - forming.ts) / p["interval_ms"]))
            vol_now = max(vol_now, forming.volume / frac)
        ctx = {"atr": atr, "fast": fast[-1], "mid": mid[-1], "slow": slow[-1],
               "vr": vol_now / base, "vol_base": base}
        info, why = None, ""
        if mode == "revert":
            info, why = self._revert(done, price, ctx)
        if mode in ("pullback", "both"):
            info, why = self._pullback(done, price, ctx)
        if info is None and mode in ("breakout", "both"):
            pb_why = why
            info, why = self._breakout(done, price, ctx)
            if pb_why and why.startswith(("no new", "momentum not")):
                why = pb_why            # report the setup that got further
        if info is None:
            return None, why
        stop_pct = (price - info["stop"]) / price * 100
        if stop_pct < p["min_stop"]:
            stop_pct = p["min_stop"]
            info["stop"] = price * (1 - stop_pct / 100)
        if stop_pct > p["max_stop"]:
            return None, f"stop too wide {stop_pct:.2f}%"
        info.update(stop_pct=stop_pct, atr_pct=atr / price * 100,
                    vr=ctx["vr"], ext=(price - ctx["mid"]) / atr)
        return info, ""

    def _breakout(self, done, price, ctx):
        """Fresh N-bar high on expanding volume, not chased."""
        p, atr = self.p, ctx["atr"]
        if ctx["fast"] <= ctx["mid"]:
            return None, "momentum not stacked"
        level = max(c.high for c in done[-p["breakout_n"]:])
        if price <= level * 1.0002:
            return None, f"no new {p['breakout_n']}-bar high"
        if (price - level) / atr > p["max_past_level_atr"]:
            return None, "too far past breakout"
        if (price - ctx["mid"]) / atr > p["max_ext_atr"]:
            return None, "overextended vs EMA"
        if (price - min(c.low for c in done[-p["run_bars"]:])) / atr \
                > p["max_run_atr"]:
            return None, "late in the run"
        if ctx["vr"] < p["vol_mult"]:
            return None, f"volume {ctx['vr']:.1f}x < {p['vol_mult']}x"
        if done[-1].close < ctx["fast"]:
            return None, "last bar closed weak"
        struct = min(c.low for c in done[-p["struct_bars"]:])
        return {"kind": "breakout", "level": level,
                "stop": max(struct, price - p["atr_stop"] * atr)}, ""

    def _revert(self, done, price, ctx):
        """Stretched flush below value on heavy volume, now turning: price
        takes out the prior bar's high. Stop just under the flush low; the
        mean (EMA21) is the natural magnet, so room to it must be >= ~2R."""
        p, atr = self.p, ctx["atr"]
        win = done[-p["mr_bars"]:]
        dip = min(c.low for c in win)
        if (ctx["mid"] - dip) / atr < p["mr_stretch_atr"]:
            return None, "not stretched below value"
        if max(c.volume for c in win) < p["mr_vol_mult"] * ctx["vol_base"]:
            return None, "no capitulation volume"
        level = done[-1].high
        if price <= level * 1.0002:
            return None, "awaiting turn"
        if (price - dip) / atr > p["mr_max_chase_atr"]:
            return None, "turn already ran"
        stop = dip - p["mr_stop_buf_atr"] * atr
        if (ctx["mid"] - price) < p["mr_min_room_r"] * (price - stop):
            return None, "too little room to the mean"
        return {"kind": "revert", "level": level, "stop": stop,
                "target": ctx["mid"]}, ""

    def _pullback(self, done, price, ctx):
        """Uptrend dipped back to value (EMA21 zone, above EMA55) and is now
        reclaiming: price takes out the prior bar's high. Stop goes just
        under the dip, so the risk is small and defined by structure."""
        p, atr = self.p, ctx["atr"]
        win = done[-p["pb_bars"]:]
        dip = min(c.low for c in win)
        swing_hi = max(c.high for c in done[-(p["pb_bars"] + p["pb_lookback"]):])
        if dip > ctx["mid"] + p["pb_touch_atr"] * atr:
            return None, "no pullback to value"
        if dip < ctx["slow"] - p["pb_break_atr"] * atr:
            return None, "pullback broke the trend"
        if (swing_hi - dip) / atr < p["pb_min_depth_atr"]:
            return None, "pullback too shallow"
        level = done[-1].high
        if price <= level * 1.0002 or price <= ctx["fast"]:
            return None, "awaiting reclaim"
        if (price - dip) / atr > p["pb_max_chase_atr"]:
            return None, "reclaim already ran"
        if ctx["vr"] < p["pb_vol_mult"]:
            return None, f"volume {ctx['vr']:.1f}x < {p['pb_vol_mult']}x"
        return {"kind": "pullback", "level": level,
                "stop": dip - p["pb_stop_buf_atr"] * atr}, ""

    # ---------------------------------------------------------- live
    def live(self, st, info: dict, fee: float, quote: float, now_ms: int):
        """Order-flow and book checks only possible on live data."""
        p = self.p
        win = [t for t in st.trades
               if now_ms - p["flow_ms"] <= t[0] <= now_ms + 1000]
        if len(win) < p["min_trades"]:
            return None, "await live trades"

        def share(ts):
            tot = sum(t[2] for t in ts)
            return sum(t[2] for t in ts if t[3] == "buy") / tot if tot else 0.0
        buy = share(win)
        recent = share([t for t in win if t[0] >= now_ms - p["flow_recent_ms"]])
        if buy < p["min_buy"]:
            return None, f"buyers {buy:.0%}"
        if recent < p["min_recent_buy"]:
            return None, "buyers fading"
        if not st.bids or not st.asks:
            return None, "no book"
        bb, ba = st.bids[0][0], st.asks[0][0]
        mid = (bb + ba) / 2
        spread = (ba - bb) / mid * 100 if mid else 99
        if spread > self.cfg.market.max_spread_pct:
            return None, f"spread {spread:.2f}%"
        bd = sum(px * sz for px, sz in st.bids if px >= mid * 0.99)
        ad = sum(px * sz for px, sz in st.asks if px <= mid * 1.01)
        if ad and bd / ad < p["min_depth_ratio"]:
            return None, "sell wall"
        bs, ss = _fill_cost(st.asks, quote), _fill_cost(st.bids, quote)
        if bs is None or ss is None or bs + ss > p["max_slip"]:
            return None, "thin book"
        costs = 2 * fee + spread + bs + ss
        if costs > p["max_cost_r"] * info["stop_pct"]:
            return None, f"costs {costs:.2f}% vs stop {info['stop_pct']:.2f}%"
        return {"buy": buy, "costs": costs}, ""

    def evaluate(self, st, fee: float, quote: float, now_ms: int,
                 htf_bars) -> tuple[EntrySignal | None, str, dict]:
        p = self.p
        price = st.last_price
        row = {"symbol": st.symbol, "price": price, "score": 0.0,
               "stop_pct": None, "vr": None}
        done, forming = split_bars(st.candles, now_ms, p["interval_ms"])
        if not done or now_ms - done[-1].ts > 3 * p["interval_ms"]:
            self._armed.pop(st.symbol, None)
            return None, "stale candles", row
        htf_done, _ = split_bars(htf_bars or [], now_ms, p["htf_ms"])
        info, why = self.setup(done, forming, price, htf_done, now_ms)
        if info:
            q = quote(info["stop_pct"]) if callable(quote) else quote
            row.update(stop_pct=round(info["stop_pct"], 2),
                       vr=round(info["vr"], 1), quote=round(q, 2))
            flow, why = self.live(st, info, fee, q, now_ms)
        if not info or not flow:
            self._armed.pop(st.symbol, None)
            return None, why, row
        score = (min(info["vr"], 4) + 3 * (flow["buy"] - 0.5)
                 + (p["max_ext_atr"] - info["ext"]) / p["max_ext_atr"])
        row["score"] = round(score, 2)
        first, last = self._armed.get(st.symbol, (now_ms, now_ms))
        if now_ms - last > 3 * p["eval_sec"] * 1000:
            first = now_ms                      # gap in evaluation -> restart
        self._armed[st.symbol] = (first, now_ms)
        if now_ms - first < p["confirm_ms"]:
            return None, f"holding breakout {(now_ms - first) / 1000:.0f}s", row
        self._armed.pop(st.symbol, None)
        r, costs = info["stop_pct"], flow["costs"]
        sig = EntrySignal(
            symbol=st.symbol, ts_ms=now_ms, price=price,
            atr_pct=info["atr_pct"], pullback_pct=0.0,
            expected_profit_pct=2 * r - costs,
            stop_price=info["stop"], take_price=price * (1 + 3.5 * r / 100),
            reasons=[f"claude:{p['tag']}:{info['kind']}",
                     f"trigger {info['level']:.6g} "
                     f"vol {info['vr']:.1f}x buyers {flow['buy']:.0%}",
                     f"R={r:.2f}% costs={costs:.2f}%"],
            score=score, estimated_cost_pct=costs,
            trail_steps=r_ladder(r, costs, p.get("be_r", 1.0)))
        return sig, "", row

    # ----------------------------------------------------- repeat offenders
    def record(self, sym: str, net: float, ts: float) -> float:
        """Win resets; each consecutive loss doubles that coin's cooldown."""
        if net > 0:
            self.streak[sym] = 0
            self.cool.pop(sym, None)
            return 0.0
        n = self.streak.get(sym, 0) + 1
        self.streak[sym] = n
        until = ts + min(self.p["cd_cap"], self.p["cd_base"] * 2 ** (n - 1))
        self.cool[sym] = until
        return until


def summarize(blockers: list[str]) -> list[tuple[str, int]]:
    def bucket(b: str) -> str:
        for key in ("buyers", "volume", "stop too wide", "costs", "BTC",
                    "breadth", "holding breakout", "cooldown"):
            if b.startswith(key):
                return key
        return b
    return Counter(bucket(b) for b in blockers).most_common(7)


# ----------------------------------------------------------------- replay
def replay(bars: list[Candle], cfg, htf_bars: list[Candle] | None = None,
           fee: float = 0.1, slip: float = 0.03,
           btc_bars: list[Candle] | None = None) -> list[dict]:
    """Candle-only replay of the trend/entry/volume/stop/ladder logic plus
    the BTC gate when BTC bars are given. Live flow, book and breadth gates
    are NOT replayable from candles."""
    from bisect import bisect_left
    s = ClaudeStrategy(cfg)
    p = s.p
    btc_ts = [c.ts for c in btc_bars] if btc_bars else []
    iv = p["interval_ms"]
    if htf_bars is None:
        agg: dict[int, Candle] = {}
        for c in bars:
            k = c.ts // p["htf_ms"] * p["htf_ms"]
            b = agg.get(k)
            if b is None:
                agg[k] = Candle(k, c.open, c.high, c.low, c.close, c.volume)
            else:
                b.high, b.low = max(b.high, c.high), min(b.low, c.low)
                b.close, b.volume = c.close, b.volume + c.volume
        htf_bars = list(agg.values())
    htf_ts = [h.ts for h in htf_bars]
    st = cfg.strategy
    t_exit = max(1, st.time_exit_sec * 1000 // iv)
    t_max = max(t_exit, st.max_hold_sec * 1000 // iv)
    gate = st.time_exit_gain_pct if st.time_exit_gain_pct is not None else 0.0
    trades, i = [], p["bars_needed"] + 1
    while i < len(bars) - 1:
        done, bar = bars[max(0, i - 240):i], bars[i]
        mode = p.get("entry_mode", "pullback")
        triggers = []
        if mode in ("pullback", "both", "revert"):
            triggers.append(done[-1].high * 1.0004)
        if mode in ("breakout", "both"):
            triggers.append(max(c.high for c in done[-p["breakout_n"]:]) * 1.0004)
        info, trigger = None, 0.0
        htf_done = None
        for trigger in sorted(set(triggers)):
            if not bar.open < trigger <= bar.high:
                continue
            if htf_done is None:
                k = bisect_left(htf_ts, bar.ts - p["htf_ms"] + 1)
                htf_done = htf_bars[max(0, k - 80):k]
                kb = bisect_left(btc_ts, bar.ts) if btc_bars else 0
                btc_done = btc_bars[max(0, kb - 300):kb] if btc_bars else None
            info, _ = s.setup(done, None, trigger, htf_done, bar.ts, btc_done)
            if info:
                break
        if info and btc_bars:
            k = bisect_left(btc_ts, bar.ts)
            ok, _, _ = s.regime(btc_bars[max(0, k - 120):k], bar.ts, 1.0)
            info = info if ok else None
        if not info:
            i += 1
            continue
        entry = trigger * (1 + slip / 100)
        costs = 2 * fee + 2 * slip
        steps = r_ladder(info["stop_pct"], costs, p.get("be_r", 1.0))
        stop = entry * (1 - info["stop_pct"] / 100)
        peak, xp, why, j = entry, None, "", i
        for j in range(i, min(i + t_max + 1, len(bars))):
            b = bars[j]
            if j > i and b.low <= stop:
                xp, why = min(b.open, stop), "stop"
                break
            peak = max(peak, b.high)
            g = (peak / entry - 1) * 100
            off = None
            for th, o in steps:
                if g >= th:
                    off = o
            if off is not None:
                stop = max(stop, peak * (1 - off / 100))
            gain = (b.close / entry - 1) * 100
            if j - i >= t_exit and off is None and gain < gate:
                xp, why = b.close, "time"
                break
            if j - i >= t_max:
                xp, why = b.close, "max_hold"
                break
        if xp is None:
            xp, why = bars[j].close, "end"
        net = (xp * (1 - slip / 100) / entry - 1) * 100 - 2 * fee
        trades.append({"ts": bar.ts, "net_pct": net, "why": why,
                       "r": info["stop_pct"], "kind": info["kind"],
                       "mfe_r": (peak / entry - 1) * 100 / info["stop_pct"]})
        i = j + 1
    return trades
