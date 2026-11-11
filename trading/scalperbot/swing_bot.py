"""Swing Structure Trading Bot: market-structure reversal capture.

Independent signal engine (1h primary, 4h confirmation). It does not share
entry logic with the scalpers: it detects a meaningful decline, scores the
evidence that selling pressure is weakening, tracks ATR-adjusted ZigZag
pivots (confirmed vs provisional - never look-ahead), then enters on a
structure shift: price breaking the most recent minor lower high, or a
confirmed higher low followed by bullish continuation.

Stops are structural: below the swing low minus an ATR buffer. The exit is
a configurable runged ladder expressed as [gain%, locked-profit%] pairs;
`ladder()` converts that to the [threshold, giveback] trail-steps format
the shared position manager consumes, so the spec's lock levels land
exactly at arming and then keep ratcheting with the peak (never backwards).
Positions additionally exit on a structural reversal: a confirmed lower
high followed by a break of the last confirmed higher low.
"""
from __future__ import annotations

import math
from collections import Counter

from .indicators import Candle
from .signals import EntrySignal

STABLES = {"USDC", "DAI", "TUSD", "FDUSD", "USDE", "PYUSD", "USD1", "USDD",
           "BUSD", "EURC", "USDP", "USD"}

DEFAULTS = {
    "tag": "swing",
    "interval_ms": 3_600_000,            # 1h primary
    "htf_ms": 14_400_000,                # 4h confirmation
    "htf": "4hour",
    "eval_sec": 60,
    "bars_needed": 140,
    "htf_needed": 60,
    "atr_n": 14,
    "ema": (20, 50),
    "rsi_n": 14,
    # --- stage 1: meaningful decline
    "min_decline_pct": 6.0,
    "min_decline_atr": 3.0,
    "collapse_body_atr": 1.8,            # bars this big still falling = collapse
    "collapse_bars": 3,
    # --- pivots (ATR-adjusted ZigZag)
    "zz_atr": 1.2,
    "zz_pct": 1.5,
    "minor_zz_atr": 0.5,                 # minor swings: break-of-LH triggers
    "minor_zz_pct": 0.7,
    # --- entry
    "entry_score_min": 6,
    "max_chase_atr": 1.5,                # max distance above the break level
    "stop_buf_atr": 0.3,
    "min_stop_pct": 0.8,
    "max_stop_pct": 12.0,
    "min_room_pct": 4.0,                 # room to last confirmed swing high
    "confirm_ms": 0,
    # --- live execution checks
    "max_spread_pct": 0.15,
    "max_cost_stop_ratio": 0.25,         # costs must be < 25% of the stop
    # --- structural reversal exit
    "struct_buf_pct": 0.25,              # close below HL by this = break
    # --- universe / market
    "universe_n": 30,
    "min_vol": 400_000,
    "chg_lo": -18.0,
    "chg_hi": 35.0,
    "min_breadth": 0.20,
    "btc_bars": 24,                      # 24h of 1h
    "btc_min": -6.0,
    "btc_flush_bars": 3,                 # 3h
    "btc_flush": -1.2,
    "btc_low_bars": 6,
    "cd_base": 600,                      # per-coin cooldown after a loss
    "cd_cap": 172_800,
    # runged ladder: [gain %, locked profit %] - spec defaults
    "ladder": [[1, 0.0], [2, 0.75], [3, 1.75], [4, 2.75], [5, 3.75],
               [6, 4.75], [7, 5.75], [8, 6.75], [9, 7.75], [10, 8.75]],
}


# ------------------------------------------------------------------ maths
def _ema(vals: list[float], n: int) -> list[float] | None:
    if len(vals) < n:
        return None
    k = 2 / (n + 1)
    e = sum(vals[:n]) / n
    out = [e]
    for v in vals[n:]:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def _atr_series(bars: list[Candle], n: int) -> list[float | None]:
    out: list[float | None] = [None] * len(bars)
    if len(bars) < n + 1:
        return out
    tr = [max(b.high - b.low, abs(b.high - a.close), abs(b.low - a.close))
          for a, b in zip(bars, bars[1:])]
    v = sum(tr[:n]) / n
    out[n] = v
    for i in range(n + 1, len(bars)):
        v = (v * (n - 1) + tr[i - 1]) / n
        out[i] = v
    return out


def _rsi(closes: list[float], n: int) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if len(closes) < n + 1:
        return out
    gains = [max(closes[i] - closes[i - 1], 0) for i in range(1, len(closes))]
    losses = [max(closes[i - 1] - closes[i], 0) for i in range(1, len(closes))]
    ag = sum(gains[:n]) / n
    al = sum(losses[:n]) / n
    out[n] = 100 - 100 / (1 + ag / al) if al else 100.0
    for i in range(n + 1, len(closes)):
        ag = (ag * (n - 1) + gains[i - 1]) / n
        al = (al * (n - 1) + losses[i - 1]) / n
        out[i] = 100 - 100 / (1 + ag / al) if al else 100.0
    return out


def _macd_hist(closes: list[float]) -> list[float | None]:
    f, s = _ema(closes, 12), _ema(closes, 26)
    if f is None or s is None:
        return [None] * len(closes)
    line = [(a - b) for a, b in zip(f, s)]   # s is the shorter series
    sig = _ema(line, 9)
    if sig is None:
        return [None] * len(closes)
    off = len(closes) - len(sig)
    out: list[float | None] = [None] * off
    # sig[i] aligns to line index (len(line)-len(sig))+i = 8+i
    lag = len(line) - len(sig)
    out += [line[lag + i] - sig[i] for i in range(len(sig))]
    return out


def zigzag(bars: list[Candle], atrs: list[float | None],
           zz_atr: float, zz_pct: float) -> tuple[list, dict]:
    """Confirmed (idx, price, 'H'|'L') pivots + provisional extreme.

    A pivot is only confirmed after price retraces the threshold, so this
    is causal - no look-ahead. The provisional extreme is the developing
    swing point the market has not yet confirmed.
    """
    pivs: list[tuple[int, float, str]] = []
    if not bars:
        return pivs, {"dir": 0, "ext_i": 0, "ext_p": 0.0}

    def rev(i: int, px: float) -> float:
        a = atrs[i] if i < len(atrs) and atrs[i] else 0.0
        return max(zz_pct / 100 * px, zz_atr * a)

    # find initial direction
    lo_i, hi_i = 0, 0
    d = 0
    for i in range(1, len(bars)):
        if bars[i].low < bars[lo_i].low:
            lo_i = i
        if bars[i].high > bars[hi_i].high:
            hi_i = i
        if bars[i].close > bars[lo_i].low + rev(i, bars[lo_i].low):
            pivs.append((lo_i, bars[lo_i].low, "L"))
            d, ext_i = 1, hi_i
            break
        if bars[i].close < bars[hi_i].high - rev(i, bars[hi_i].high):
            pivs.append((hi_i, bars[hi_i].high, "H"))
            d, ext_i = -1, lo_i
            break
    else:
        return pivs, {"dir": 0, "ext_i": lo_i, "ext_p": bars[lo_i].low}
    start = i
    for i in range(start + 1, len(bars)):
        if d == 1:                                   # tracking the high
            if bars[i].high > bars[ext_i].high:
                ext_i = i
            if bars[i].close < bars[ext_i].high - rev(i, bars[ext_i].high):
                pivs.append((ext_i, bars[ext_i].high, "H"))
                d, ext_i = -1, i
        else:                                        # tracking the low
            if bars[i].low < bars[ext_i].low:
                ext_i = i
            if bars[i].close > bars[ext_i].low + rev(i, bars[ext_i].low):
                pivs.append((ext_i, bars[ext_i].low, "L"))
                d, ext_i = 1, i
    return pivs, {"dir": d, "ext_i": ext_i,
                  "ext_p": bars[ext_i].high if d == 1 else bars[ext_i].low}


def ladder(lock_table: list[list[float]]) -> list[list[float]]:
    """[gain%, locked%] -> [threshold%, giveback%] trail-steps.

    At arming (peak = threshold) the giveback stop lands exactly on the
    locked level; afterwards it keeps following the peak up, which only
    ever improves on the spec's fixed lock."""
    out = []
    for gain, lock in lock_table:
        off = (1 - (1 + lock / 100) / (1 + gain / 100)) * 100
        out.append([float(gain), round(max(off, 0.05), 3)])
    return out


def split_bars(candles, now_ms: int, interval_ms: int):
    cs = list(candles)
    done = [c for c in cs if c.ts + interval_ms <= now_ms]
    forming = (cs[-1] if cs and cs[-1].ts <= now_ms < cs[-1].ts + interval_ms
               else None)
    return done, forming


def _fill_cost(levels: list, quote: float) -> float | None:
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


# --------------------------------------------------------------- strategy
class SwingStrategy:
    def __init__(self, cfg):
        self.cfg = cfg
        self.p = dict(DEFAULTS)
        self.p.update(getattr(cfg.strategy, "swing_params", None) or {})
        self.streak: dict[str, int] = {}
        self.cool: dict[str, float] = {}
        # per-symbol stage bookkeeping for the dashboard/decision log
        self.bottoms: dict[str, dict] = {}

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
        """Block only while BTC is actively dumping - not a slow-trend test."""
        p = self.p
        done, _ = split_bars(btc_bars or [], now_ms, p["interval_ms"])
        low_n = p["btc_low_bars"]
        need = max(p["btc_bars"], 50) + low_n + 1
        if len(done) < need or now_ms - done[-1].ts > \
                3 * p["interval_ms"] + 60_000:
            return False, "BTC data missing", {}
        closes = [c.close for c in done]
        chg = (closes[-1] / closes[-1 - p["btc_bars"]] - 1) * 100
        flush = (closes[-1] / closes[-1 - p["btc_flush_bars"]] - 1) * 100
        recent_low = min(c.low for c in done[-low_n:])
        prior_low = min(c.low for c in done[-(low_n + p["btc_bars"]):-low_n])
        info = {"btc_chg": round(chg, 2), "btc_label": "24h",
                "breadth": None if breadth is None else round(breadth * 100)}
        if flush <= p["btc_flush"]:
            return False, f"BTC flushing {flush:.2f}%", info
        if recent_low < prior_low:
            return False, "BTC still making new lows", info
        if chg < p["btc_min"]:
            return False, f"BTC 24h {chg:+.2f}%", info
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
        # swing bottoms live in the beaten-down-but-liquid crowd: rank by
        # volume with a bonus for coins down on the day
        ranked = sorted(rows, key=lambda r: -(math.log10(r[1])
                                              + max(-r[2], 0) / 4))
        return [r[0] for r in ranked[:p["universe_n"]]]

    # -------------------------------------------------- stage 1: decline
    def _decline(self, done, closes, atr, pivs):
        """Return (points, evidence, why_reject). Meaningful decline is a
        precondition; structure/EMA/momentum features add points."""
        p = self.p
        highs = [x for x in pivs if x[2] == "H"]
        if not highs:
            return 0, [], "no confirmed swing high"
        sh_i, sh_p = highs[-1][0], highs[-1][1]
        lo = min(c.low for c in done[sh_i:])
        decl = (sh_p - lo) / sh_p * 100
        if decl < p["min_decline_pct"] or (sh_p - lo) < p["min_decline_atr"] * atr:
            return 0, [], f"decline {decl:.1f}% too small"
        # accelerating collapse: last N bars all big-bodied down with new lows
        win = done[-p["collapse_bars"]:]
        if len(win) >= p["collapse_bars"]:
            big_down = sum(1 for c in win
                           if c.close < c.open
                           and (c.open - c.close) > p["collapse_body_atr"] * atr)
            if big_down >= p["collapse_bars"] and \
                    done[-1].low < min(c.low for c in done[-8:-1]):
                return 0, [], "still collapsing"
        pts, ev = 0, []
        lows = [x for x in pivs if x[2] == "L"]
        if len(highs) >= 2 and highs[-1][1] < highs[-2][1]:
            pts += 1; ev.append("LH")
        if len(lows) >= 2 and lows[-1][1] < lows[-2][1]:
            pts += 1; ev.append("LL")
        e20, e50 = _ema(closes, self.p["ema"][0]), _ema(closes, self.p["ema"][1])
        if e20 and e50 and closes[-1] < e20[-1]:
            pts += 1; ev.append("below EMA20")
        roc = closes[-1] / closes[-6] - 1 if len(closes) > 6 else 0
        if roc < 0:
            pts += 1; ev.append("falling")
        sell_vol = sum(c.volume for c in done[-10:] if c.close < c.open)
        buy_vol = sum(c.volume for c in done[-10:] if c.close >= c.open)
        if sell_vol > buy_vol:
            pts += 1; ev.append("sell vol dominant")
        return pts, ev, ""

    # ------------------------------------------- stage 2: weakening sell
    def _weakening(self, done, closes, atr, pivs):
        """Score 0-7: is the decline losing momentum?"""
        p = self.p
        pts, ev = 0, []
        lows = [x for x in pivs if x[2] == "L"]
        # successive down legs getting shorter
        highs = [x for x in pivs if x[2] == "H"]
        if len(highs) >= 2 and len(lows) >= 2:
            leg1 = highs[-2][1] - lows[-2][1]
            leg2 = highs[-1][1] - (lows[-1][1] if lows[-1][0] > highs[-1][0]
                                   else min(c.low for c in done[highs[-1][0]:]))
            if leg1 > 0 and leg2 < leg1:
                pts += 1; ev.append("shorter down leg")
        # shrinking candle bodies
        body = lambda c: abs(c.close - c.open)
        prev = [body(c) for c in done[-6:-3]]
        last = [body(c) for c in done[-3:]]
        if prev and sum(last) < sum(prev) * 0.9:
            pts += 1; ev.append("smaller bodies")
        # failing to make meaningful new lows
        if len(done) >= 8 and done[-1].low > min(
                c.low for c in done[-8:-3]) - 0.2 * atr:
            pts += 1; ev.append("no new low")
        # rejection wicks on the last bars
        wicks = sum(1 for c in done[-3:]
                    if (min(c.open, c.close) - c.low) >= body(c))
        if wicks >= 2:
            pts += 1; ev.append("rejection wicks")
        # RSI recovering
        r = _rsi(closes, p["rsi_n"])
        if (r[-1] and r[-2] and r[-3] and r[-1] > r[-2] > r[-3]
                and min(x for x in r[-6:] if x) < 40):
            pts += 1; ev.append("RSI turning up")
        # MACD histogram improving
        h = _macd_hist(closes)
        tail = [x for x in h[-4:] if x is not None]
        if len(tail) >= 3 and tail[-1] > tail[-2] and tail[-2] <= tail[-3] \
                and tail[-1] < 0:
            pts += 1; ev.append("MACD hist up")
        # volume: green bars outpacing red recently
        gv = sum(c.volume for c in done[-4:] if c.close >= c.open)
        rv = sum(c.volume for c in done[-4:] if c.close < c.open)
        if gv > rv and gv > 0:
            pts += 1; ev.append("buy vol rising")
        return pts, ev

    # ----------------------------------------- stage 3+4: bottom + entry
    def evaluate(self, st, fee: float, quote, now_ms: int,
                 htf_bars) -> tuple[EntrySignal | None, str, dict]:
        p = self.p
        price = st.last_price
        row = {"symbol": st.symbol, "price": price, "score": 0.0,
               "decline": None, "weak": None, "level": None}
        done, forming = split_bars(st.candles, now_ms, p["interval_ms"])
        if len(done) < p["bars_needed"]:
            return None, "warming candles", row
        done = done[-p["bars_needed"]:]
        if now_ms - done[-1].ts > 3 * p["interval_ms"]:
            return None, "stale candles", row
        atrs = _atr_series(done, p["atr_n"])
        atr = atrs[-1]
        if not atr or atr <= 0 or price <= 0:
            return None, "warming candles", row
        closes = [c.close for c in done]
        pivs, prov = zigzag(done, atrs, p["zz_atr"], p["zz_pct"])
        mpivs, mprov = zigzag(done, atrs, p["minor_zz_atr"], p["minor_zz_pct"])

        # ---- stage 1
        d_pts, d_ev, d_why = self._decline(done, closes, atr, pivs)
        row["decline"] = d_pts
        if d_why:
            return None, d_why, row
        # ---- stage 2
        w_pts, w_ev = self._weakening(done, closes, atr, pivs)
        row["weak"] = w_pts
        if w_pts < 3:
            return None, f"sellers not tired ({w_pts}/3)", row
        # ---- stage 3: bottom candidate
        b_pts, b_ev = 0, []
        prov_low = prov["ext_p"] if prov["dir"] == -1 else \
            min(c.low for c in done[-4:])
        low_i = prov["ext_i"] if prov["dir"] == -1 else \
            len(done) - 1 - min(range(4),
                                key=lambda k: done[-1 - k].low)
        lo_c = done[low_i]
        if (min(lo_c.open, lo_c.close) - lo_c.low) >= abs(lo_c.close - lo_c.open):
            b_pts += 1; b_ev.append("wick reject")
        bulls = [c for c in done[low_i:] if c.close > c.open
                 and (c.close - c.open) >= 0.5 * atr]
        if bulls:
            b_pts += 1; b_ev.append("bull reversal bar")
        lows = [x for x in pivs if x[2] == "L"]
        if lows and prov_low > lows[-1][1] - 0.5 * atr:
            b_pts += 1; b_ev.append("higher/double bottom")
        if prov_low > min(c.low for c in done[-12:-4]):
            b_pts += 1; b_ev.append("low holding")
        self.bottoms[st.symbol] = {"low": prov_low, "i": low_i, "pts": b_pts}
        if b_pts < 2:
            return None, f"no bottom shape ({b_pts}/2)", row
        # ---- stage 4: structure shift = break of last minor lower high
        mhighs = [x for x in mpivs if x[2] == "H" and x[0] > low_i - 20]
        # minor highs inside the decline leg that sit above the low
        cands = [x for x in mhighs if x[0] > low_i]
        minor = [x for x in mhighs if x[0] <= low_i]
        level = (min(x[1] for x in cands) if cands
                 else (minor[-1][1] if minor
                       else max(c.high for c in done[low_i:])))
        row["level"] = round(level, 6)
        higher_low_ok = lows and prov_low > lows[-1][1]
        break_ok = price > level
        cont_ok = higher_low_ok and forming is not None and \
            price > done[-1].high
        if not (break_ok or cont_ok):
            return None, f"below break level {level:.6g}", row
        if (price - level) > p["max_chase_atr"] * atr:
            return None, "chasing - break already ran", row
        # ---- 4h confirmation: must not still be in freefall
        htf_done, _ = split_bars(htf_bars or [], now_ms, p["htf_ms"])
        if len(htf_done) < p["htf_needed"]:
            return None, "warming 4h", row
        hc = [c.close for c in htf_done]
        he = _ema(hc, 20)
        h_atrs = _atr_series(htf_done, 14)
        h_atr = h_atrs[-1] or 0
        if he and h_atr and hc[-1] < he[-1] - 3.0 * h_atr:
            return None, "4h in freefall", row
        h_low_n = 4
        if min(c.low for c in htf_done[-h_low_n:]) < \
                min(c.low for c in htf_done[-(h_low_n + 8):-h_low_n]):
            return None, "4h still making new lows", row
        # ---- stop below the whole bottom structure + buffer, sanity-bounded
        stop = min(prov_low, min(c.low for c in done[-8:])) \
            - p["stop_buf_atr"] * atr
        stop_pct = (price - stop) / price * 100
        if stop_pct > p["max_stop_pct"]:
            return None, f"stop too wide {stop_pct:.1f}%", row
        if stop_pct < p["min_stop_pct"]:
            return None, f"stop too tight {stop_pct:.1f}%", row
        # room to the last confirmed swing high must pay for the risk
        sh = [x for x in pivs if x[2] == "H"]
        room = ((sh[-1][1] - price) / price * 100) if sh else 99
        if room < p["min_room_pct"]:
            return None, f"only {room:.1f}% room to swing high", row
        score = d_pts + w_pts + b_pts + (1 if break_ok else 0) \
            + (1 if cont_ok else 0)
        row["score"] = round(score, 1)
        if score < p["entry_score_min"]:
            return None, f"score {score} < {p['entry_score_min']}", row
        # ---- live execution checks (spread + book fill cost)
        if not st.bids or not st.asks:
            return None, "no book", row
        bb, ba = st.bids[0][0], st.asks[0][0]
        mid = (bb + ba) / 2
        spread = (ba - bb) / mid * 100 if mid else 99
        if spread > p["max_spread_pct"]:
            return None, f"spread {spread:.2f}%", row
        q = quote(stop_pct) if callable(quote) else quote
        bs = _fill_cost(st.asks, q)
        costs = 2 * fee + spread + (bs or 0.2)
        if costs > p["max_cost_stop_ratio"] * stop_pct:
            return None, f"costs {costs:.2f}% vs stop {stop_pct:.1f}%", row
        steps = ladder(self.p["ladder"])
        reasons = ["swing:structure",
                   f"decline:{'+'.join(d_ev)}",
                   f"weakening:{w_pts}/7 {'+'.join(w_ev[:3])}",
                   f"bottom:{b_pts} low={prov_low:.6g} brk={level:.6g}",
                   f"score={score} stop={stop_pct:.1f}% room={room:.0f}%"]
        sig = EntrySignal(
            symbol=st.symbol, ts_ms=now_ms, price=price,
            atr_pct=atr / price * 100, pullback_pct=0.0,
            expected_profit_pct=min(room, 12) - costs,
            stop_price=stop, take_price=price * 1.12,
            reasons=reasons, score=score,
            estimated_cost_pct=costs, trail_steps=steps)
        return sig, "", row

    # -------------------------------------- structural reversal exit
    def structure_broken(self, pos, done: list[Candle],
                         now_ms: int) -> str | None:
        """Exit reason when the recovery structure fails: a confirmed lower
        high after entry, then price closes back below the last confirmed
        higher low. Never fires without both conditions."""
        p = self.p
        done = [c for c in done
                if c.ts >= pos.entry_ts * 1000 - 30 * p["interval_ms"]]
        if len(done) < 30:
            return None
        atrs = _atr_series(done, p["atr_n"])
        pivs, _ = zigzag(done, atrs, p["zz_atr"], p["zz_pct"])
        after = [x for x in pivs if x[1] and x[0] >= 0
                 and done[x[0]].ts > pos.entry_ts * 1000]
        highs = [x for x in after if x[2] == "H"]
        lows = [x for x in after if x[2] == "L"]
        if len(highs) < 2 or not lows:
            return None
        lh = highs[-1][1] < highs[-2][1]          # lower high formed
        if not lh:
            return None
        last_hl = lows[-1][1]
        if done[-1].close < last_hl * (1 - p["struct_buf_pct"] / 100):
            return "structural_reversal"
        return None

    # ----------------------------------------------------- repeat offenders
    def record(self, sym: str, net: float, ts: float) -> float:
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
        for key in ("warming", "decline", "still collapsing", "sellers",
                    "no bottom", "below break", "chasing", "4h", "stop",
                    "only", "score", "no book", "spread", "costs", "BTC",
                    "breadth", "stale", "cooldown", "holding",
                    "held by", "size too"):
            if b.startswith(key):
                return key
        return b
    return Counter(bucket(b) for b in blockers).most_common(8)


# ----------------------------------------------------------------- replay
def replay(bars: list[Candle], cfg, htf_bars: list[Candle] | None = None,
           fee: float = 0.1, slip: float = 0.05) -> list[dict]:
    """Candle-only replay, strictly causal: each bar is evaluated on data
    up to and including its own close; entries fill at the break level
    (limit) or next open; exits check intrabar lows for stops. Live-only
    checks (book, spread, breadth) are approximated by fee+slip."""
    from bisect import bisect_left
    s = SwingStrategy(cfg)
    p = s.p
    iv, hiv = p["interval_ms"], p["htf_ms"]
    if htf_bars is None:
        agg: dict[int, Candle] = {}
        for c in bars:
            k = c.ts // hiv * hiv
            b = agg.get(k)
            if b is None:
                agg[k] = Candle(k, c.open, c.high, c.low, c.close, c.volume)
            else:
                b.high, b.low = max(b.high, c.high), min(b.low, c.low)
                b.close, b.volume = c.close, b.volume + c.volume
        htf_bars = list(agg.values())
    htf_ts = [h.ts for h in htf_bars]
    steps = ladder(p["ladder"])
    max_hold_bars = 120                    # 5 days of 1h
    trades, i = [], p["bars_needed"] + 1
    while i < len(bars) - 1:
        done = bars[max(0, i - p["bars_needed"]):i + 1]
        bar = bars[i]
        atrs = _atr_series(done, p["atr_n"])
        atr = atrs[-1]
        if not atr:
            i += 1
            continue
        # run the same staged logic on completed bars only
        k = bisect_left(htf_ts, bar.ts + 1)
        h_done = htf_bars[max(0, k - p["htf_needed"]):k]
        closes = [c.close for c in done]
        pivs, prov = zigzag(done, atrs, p["zz_atr"], p["zz_pct"])
        mpivs, _ = zigzag(done, atrs, p["minor_zz_atr"], p["minor_zz_pct"])
        d_pts, _, d_why = s._decline(done, closes, atr, pivs)
        info = None
        if not d_why:
            w_pts, _ = s._weakening(done, closes, atr, pivs)
            if w_pts >= 3:
                prov_low = prov["ext_p"] if prov["dir"] == -1 else \
                    min(c.low for c in done[-4:])
                low_i = prov["ext_i"] if prov["dir"] == -1 else \
                    len(done) - 1 - min(range(4),
                                        key=lambda k: done[-1 - k].low)
                lo_c = done[low_i]
                b_pts = 0
                if (min(lo_c.open, lo_c.close) - lo_c.low) >= \
                        abs(lo_c.close - lo_c.open):
                    b_pts += 1
                if any(c.close > c.open and (c.close - c.open) >= 0.5 * atr
                       for c in done[low_i:]):
                    b_pts += 1
                lows = [x for x in pivs if x[2] == "L"]
                if lows and prov_low > lows[-1][1] - 0.5 * atr:
                    b_pts += 1
                if prov_low > min(c.low for c in done[-12:-4]):
                    b_pts += 1
                if b_pts >= 2:
                    mhighs = [x for x in mpivs if x[2] == "H"
                              and x[0] > low_i - 20]
                    cands = [x for x in mhighs if x[0] > low_i]
                    minor = [x for x in mhighs if x[0] <= low_i]
                    level = (min(x[1] for x in cands) if cands
                             else (minor[-1][1] if minor
                                   else max(c.high for c in done[low_i:])))
                    higher_low_ok = lows and prov_low > lows[-1][1]
                    break_ok = bar.close > level
                    cont_ok = higher_low_ok and bar.close > done[-2].high
                    if (break_ok or cont_ok) and \
                            bar.close - level <= p["max_chase_atr"] * atr:
                        ok_htf = len(h_done) >= 12
                        if ok_htf:
                            hc = [c.close for c in h_done]
                            he = _ema(hc, 20)
                            h_a = _atr_series(h_done, 14)[-1] or 0
                            if he and h_a and hc[-1] < he[-1] - 3.0 * h_a:
                                ok_htf = False
                            if min(c.low for c in h_done[-4:]) < \
                                    min(c.low for c in h_done[-12:-4]):
                                ok_htf = False
                        stop = min(prov_low, min(c.low for c in done[-8:])) \
                            - p["stop_buf_atr"] * atr
                        stop_pct = (bar.close - stop) / bar.close * 100
                        score = d_pts + w_pts + b_pts + break_ok + cont_ok
                        sh = [x for x in pivs if x[2] == "H"]
                        room = ((sh[-1][1] - bar.close) / bar.close * 100) \
                            if sh else 99
                        if ok_htf and p["min_stop_pct"] <= stop_pct \
                                <= p["max_stop_pct"] and \
                                room >= p["min_room_pct"] and \
                                score >= p["entry_score_min"]:
                            info = {"stop": stop, "stop_pct": stop_pct,
                                    "level": level, "score": score}
        if not info:
            i += 1
            continue
        entry = max(info["level"], bar.close) * (1 + slip / 100)
        stop, peak, xp, why = info["stop"], entry, None, ""
        hl = None
        for j in range(i + 1, min(i + 1 + max_hold_bars, len(bars))):
            b = bars[j]
            if b.low <= stop:
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
            # structural exit on completed bar: LH confirmed + break of HL
            j_start = max(0, j - 139)
            j_done = bars[j_start:j + 1]
            j_atrs = _atr_series(j_done, p["atr_n"])
            jp, _ = zigzag(j_done, j_atrs, p["zz_atr"], p["zz_pct"])
            jh = [x for x in jp if x[2] == "H" and x[0] > i - j_start]
            jl = [x for x in jp if x[2] == "L" and x[0] > i - j_start]
            if len(jh) >= 2 and jl and jh[-1][1] < jh[-2][1] and \
                    b.close < jl[-1][1] * (1 - p["struct_buf_pct"] / 100):
                xp, why = b.close, "structural"
                break
        if xp is None:
            jj = min(i + max_hold_bars, len(bars) - 1)
            xp, why = bars[jj].close, "max_hold"
        net = (xp * (1 - slip / 100) / entry - 1) * 100 - 2 * fee
        trades.append({"ts": bar.ts, "net_pct": net, "why": why,
                       "score": info["score"],
                       "stop_pct": info["stop_pct"],
                       "entry": entry, "exit": xp,
                       "mfe": (peak / entry - 1) * 100})
        i = j + 1
    return trades
