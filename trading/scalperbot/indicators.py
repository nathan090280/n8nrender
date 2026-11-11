"""Pure-python technical indicators (plan section B).

All functions take oldest->newest lists and return the latest value or a
same-length series. No numpy dependency.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


# ---------------------------------------------------------------- candles

@dataclass
class Candle:
    ts: int          # open time, ms
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def is_bull(self) -> bool:
        return self.close > self.open          # strict - a doji is not a bull

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def range(self) -> float:
        return self.high - self.low


# ---------------------------------------------------------------- averages

def sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return ema_series(values, period)[-1]


def vwap(candles: list[Candle]) -> float | None:
    pv = sum(((c.high + c.low + c.close) / 3) * c.volume for c in candles)
    v = sum(c.volume for c in candles)
    return pv / v if v else None


# ---------------------------------------------------------------- volatility

def atr(candles, period: int = 14) -> float | None:
    candles = list(candles)
    if len(candles) < period + 1:
        return None
    trs = []
    for prev, cur in zip(candles[:-1], candles[1:]):
        trs.append(max(cur.high - cur.low,
                       abs(cur.high - prev.close),
                       abs(cur.low - prev.close)))
    # Wilder smoothing
    atr_val = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr_val = (atr_val * (period - 1) + tr) / period
    return atr_val


def realised_volatility(closes: list[float], period: int = 30) -> float | None:
    """Std-dev of log returns over the last `period` bars (per-bar units)."""
    if len(closes) < period + 1:
        return None
    rets = [math.log(closes[i] / closes[i - 1])
            for i in range(len(closes) - period, len(closes)) if closes[i - 1] > 0]
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var)


def relative_volatility(closes: list[float], short: int = 10,
                        long: int = 60) -> float | None:
    """Recent vol / baseline vol -> >1 means volatility is expanding."""
    vs, vl = realised_volatility(closes, short), realised_volatility(closes, long)
    if vs is None or vl is None or vl == 0:
        return None
    return vs / vl


def relative_volume(candles, short: int = 5, long: int = 60) -> float | None:
    candles = list(candles)
    if len(candles) < long:
        return None
    s = sum(c.volume for c in candles[-short:]) / short
    l = sum(c.volume for c in candles[-long:]) / long
    return s / l if l else None


# ---------------------------------------------------------------- momentum

def rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(len(closes) - period, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    ag, al = sum(gains) / period, sum(losses) / period
    if al == 0:
        return 100.0
    return 100 - 100 / (1 + ag / al)


def momentum(closes: list[float], period: int = 10) -> float | None:
    """Percent change over `period` bars."""
    if len(closes) < period + 1 or closes[-period - 1] == 0:
        return None
    return (closes[-1] / closes[-period - 1] - 1) * 100


# ---------------------------------------------------------------- swings

def local_high(candles, lookback: int = 30,
               since_ago: int = 0) -> float | None:
    """Highest high over `lookback` bars ending `since_ago` bars back."""
    candles = list(candles)
    if len(candles) < lookback + since_ago:
        return None
    seg = candles[len(candles) - lookback - since_ago:
                  len(candles) - since_ago if since_ago else len(candles)]
    return max(c.high for c in seg) if seg else None


def local_low(candles, lookback: int = 30) -> float | None:
    candles = list(candles)
    if len(candles) < lookback:
        return None
    return min(c.low for c in candles[-lookback:])


def pullback_depth(candles, lookback: int = 30) -> float | None:
    """Percent retracement of the last close below the recent swing high."""
    candles = list(candles)
    hi = local_high(candles, lookback)
    if hi is None or hi == 0:
        return None
    return (hi - candles[-1].close) / hi * 100


def runup_pct(candles, lookback: int = 30) -> float | None:
    """Percent distance from recent swing low to recent swing high."""
    candles = list(candles)
    lo, hi = local_low(candles, lookback), local_high(candles, lookback)
    if lo is None or hi is None or lo == 0:
        return None
    return (hi - lo) / lo * 100


def swing_highs_lows(candles, width: int = 3) -> tuple[list, list]:
    """Fractal pivots: (list of high prices, list of low prices)."""
    candles = list(candles)
    highs, lows = [], []
    for i in range(width, len(candles) - width):
        win = candles[i - width:i + width + 1]
        if candles[i].high == max(c.high for c in win):
            highs.append(candles[i].high)
        if candles[i].low == min(c.low for c in win):
            lows.append(candles[i].low)
    return highs, lows


def swing_points(candles, width: int = 3) -> tuple[list, list]:
    """Confirmed pivots as (bar index, price), oldest first.

    A flat run of equal highs/lows is one pivot, not several fake swings.
    The final `width` bars cannot be confirmed yet.
    """
    candles = list(candles)
    highs, lows = [], []
    for i in range(width, len(candles) - width):
        c = candles[i]
        left, right = candles[i - width:i], candles[i + 1:i + width + 1]
        if c.high > max(x.high for x in left) and \
                c.high >= max(x.high for x in right):
            highs.append((i, c.high))
        if c.low < min(x.low for x in left) and \
                c.low <= min(x.low for x in right):
            lows.append((i, c.low))
    return highs, lows


def bull_progress(candles, now_ms: int, interval_ms: int,
                  min_bull_pct: float) -> list[bool]:
    """Older completed, latest completed, current forming; never stale bars."""
    candles = list(candles)
    if len(candles) < 3:
        return [False, False, False]
    start = now_ms // interval_ms * interval_ms
    old, prev, current = candles[-3:]
    strong = lambda c: c.open > 0 and \
        c.close >= c.open * (1 + min_bull_pct / 100)
    return [
        old.ts == start - 2 * interval_ms and strong(old),
        prev.ts == start - interval_ms and strong(prev),
        current.ts == start and current.is_bull,
    ]


def higher_highs_lows(candles: list[Candle], width: int = 3) -> bool:
    """True when recent pivots are rising -> upward trend structure."""
    highs, lows = swing_highs_lows(candles, width)
    if len(highs) >= 2 and len(lows) >= 2:
        return highs[-1] > highs[-2] and lows[-1] > lows[-2]
    return False


def is_bullish_reversal_candle(c: Candle) -> bool:
    """Hammer-ish / strong-close candle used as a reversal confirmation."""
    if c.range == 0:
        return False
    close_pos = (c.close - c.low) / c.range
    return c.is_bull and close_pos > 0.65


# ---------------------------------------------------------------- microstructure

def taker_buy_ratio(trades: list[tuple], since_ms: int) -> float | None:
    """Share of buy-initiated volume in trades newer than since_ms.

    trades: list of (ts_ms, price, size, side) with side 'buy'/'sell'.
    """
    buy = sell = 0.0
    for ts, _p, sz, side in trades:
        if ts >= since_ms:
            if side == "buy":
                buy += sz
            else:
                sell += sz
    tot = buy + sell
    return buy / tot if tot else None


def orderbook_metrics(bids: list[list[float]],
                      asks: list[list[float]]) -> dict:
    """Spread %, mid, and +/-1% depth imbalance from a level2 snapshot."""
    if not bids or not asks:
        return {"spread_pct": None, "mid": None, "imbalance": None,
                "bid_depth": 0.0, "ask_depth": 0.0}
    best_bid, best_ask = bids[0][0], asks[0][0]
    mid = (best_bid + best_ask) / 2
    spread_pct = (best_ask - best_bid) / mid * 100 if mid else None
    bd = sum(p * s for p, s in bids if p >= mid * 0.99)
    ad = sum(p * s for p, s in asks if p <= mid * 1.01)
    imbalance = (bd - ad) / (bd + ad) if (bd + ad) else None
    return {"spread_pct": spread_pct, "mid": mid,
            "imbalance": imbalance, "bid_depth": bd, "ask_depth": ad}


def expected_slippage_pct(asks: list[list[float]],
                          quote_amount: float) -> float | None:
    """Walk the ask book to estimate avg fill price for a market buy."""
    if not asks:
        return None
    best = asks[0][0]
    remaining, base_qty = quote_amount, 0.0
    for price, size in asks:
        take = min(remaining, price * size)
        base_qty += take / price
        remaining -= take
        if remaining <= 0:
            break
    if remaining > 0 or base_qty == 0:
        return None          # book too thin to estimate -> treat as unfillable
    avg_price = quote_amount / base_qty
    return (avg_price / best - 1) * 100


def expected_sell_slippage_pct(bids: list[list[float]],
                               quote_amount: float) -> float | None:
    """Walk bids for a quote-sized exit; a thin book is not sellable."""
    if not bids or not bids[0][0] or quote_amount <= 0:
        return None
    best = bids[0][0]
    size = quote_amount / best
    remaining, proceeds = size, 0.0
    for price, available in bids:
        take = min(remaining, available)
        proceeds += take * price
        remaining -= take
        if remaining <= 1e-10:
            break
    if remaining > 1e-10:
        return None
    return (1 - proceeds / size / best) * 100
