"""Market discovery and ranking (plan A).

Universe -> filters -> scoring -> ranked candidate list.

Score emphasises *emerging* volatility (recent vol vs its own baseline)
rather than coins that already moved, plus momentum and liquidity.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from . import indicators as ind
from .market_data import MarketDataService, SymbolState
from .utils import now_ms

log = logging.getLogger("scanner")


@dataclass
class Candidate:
    symbol: str
    score: float
    rel_vol: float          # volatility expansion factor
    mom: float              # % momentum over scoring window
    rel_volume: float       # recent volume vs baseline
    quote_volume_24h: float
    spread_pct: float
    price: float
    trend_ok: bool
    reason: str = ""


class Scanner:
    def __init__(self, cfg, mds: MarketDataService):
        self.cfg, self.mds = cfg, mds
        self.symbol_meta: dict[str, dict] = {}   # increments, min funds, etc
        self._age_cache: dict[str, float | None] = {}
        self.candidates: list[Candidate] = []
        self.last_scan_ms = 0
        self.scan_stats = {"scans": 0, "over_spike_now": 0,
                           "spike_events_today": 0, "max_relvol_today": 0,
                           "_last_over": 0}

    # ---------------------------------------------------------- discovery
    async def refresh_universe(self):
        """Pull symbol metadata once (increments, min sizes, status)."""
        try:
            for s in await self.mds.rest.symbols():
                if s.get("enableTrading"):
                    self.symbol_meta[s["symbol"]] = s
        except Exception as e:
            log.error("symbol metadata failed: %s", e)

    def quote(self, symbol: str) -> str:
        return self.symbol_meta.get(symbol, {}).get("quoteCurrency",
                                                    self.cfg.market.quote_currency)

    def meta(self, symbol: str) -> dict:
        return self.symbol_meta.get(symbol, {})

    async def listed_ts(self, sym: str) -> float | None:
        """Earliest 1d candle ts (s) ~ listing date; cached for process life."""
        if sym in self._age_cache:
            return self._age_cache[sym]
        try:
            rows = await self.mds.rest.candles(
                sym, "1day", start=1_500_000_000)
            ts = float(rows[0][0]) if rows else None
        except Exception:
            ts = None
        self._age_cache[sym] = ts
        return ts

    async def scan(self) -> list[Candidate]:
        """Rank all eligible spot pairs. Called on scan_interval."""
        cfg = self.cfg
        try:
            tickers = await self.mds.rest.all_tickers()
        except Exception as e:
            log.error("ticker scan failed: %s", e)
            return self.candidates

        quote = cfg.market.quote_currency
        wl, bl = set(cfg.market.watchlist), set(cfg.market.blacklist)
        prelim = []
        for t in tickers:
            sym = t.get("symbol", "")
            if not sym.endswith("-" + quote) or sym in bl:
                continue
            if wl and sym not in wl:
                continue
            qv = float(t.get("volValue") or 0)
            if qv < cfg.market.min_24h_quote_volume:
                continue
            # suspicious-move filter: absurd 24h change -> likely news spike
            chg = abs(float(t.get("changeRate") or 0)) * 100
            if chg > cfg.market.max_price_change_pct_1m * 10:
                continue
            prelim.append((sym, qv, float(t.get("last") or 0)))

        # score only the most liquid pre-filter set (bounds REST calls/scan)
        prelim.sort(key=lambda x: x[1], reverse=True)
        min_age_s = cfg.market.min_listing_age_days * 86400
        now_s = now_ms() / 1000
        out: list[Candidate] = []
        checked = 0
        for sym, qv, last in prelim:
            if checked >= 80:
                break
            lts = await self.listed_ts(sym)
            if lts is not None and now_s - lts < min_age_s:
                continue                      # freshly-listed coin: banned
            checked += 1
            st = self.mds.states.get(sym)
            score = await self._score(sym, st, qv, last)
            if score:
                out.append(score)
        out.sort(key=lambda c: c.score, reverse=True)
        self.candidates = out[: cfg.market.top_candidates]
        self.last_scan_ms = now_ms()
        # activity stats: how often does anything actually qualify? (visible
        # on the dashboard so "is it even seeing setups?" is measurable)
        spike = cfg.strategy.vol_spike_factor
        import time as _t
        today = _t.strftime("%Y-%m-%d", _t.gmtime())
        if self.scan_stats.get("_day") != today:
            self.scan_stats.update({"_day": today, "scans": 0,
                                    "spike_events_today": 0,
                                    "max_relvol_today": 0, "_last_over": 0})
        self.scan_stats["scans"] += 1
        over = [c for c in out if c.rel_vol >= spike]
        self.scan_stats["over_spike_now"] = len(over)
        self.scan_stats["max_relvol_today"] = max(
            self.scan_stats["max_relvol_today"],
            max((c.rel_vol for c in out), default=0))
        self.scan_stats["spike_events_today"] += \
            len(over) - self.scan_stats["_last_over"] if \
            len(over) > self.scan_stats["_last_over"] else 0
        self.scan_stats["_last_over"] = len(over)
        return self.candidates

    async def _score(self, sym, st: SymbolState | None, qv, last) -> Candidate | None:
        closes = [c.close for c in st.candles] if st else []
        need = self.cfg.market.min_history_candles
        if len(closes) < need:
            # fetch once so the scanner can rank immediately
            try:
                await self.mds.load_history(sym)
                st = self.mds.states.get(sym)
                closes = [c.close for c in st.candles] if st else []
            except Exception:
                return None
            if len(closes) < need:
                return None
        ob = ind.orderbook_metrics(st.bids, st.asks)
        spread = ob["spread_pct"]
        if spread is None:                       # no book yet -> estimate
            spread = 0.05
        if spread > self.cfg.market.max_spread_pct:
            return None
        rel_vol = ind.relative_volatility(closes) or 0
        rel_v = ind.relative_volume(st.candles) or 0
        mom = ind.momentum(closes, 10) or 0
        atr_v = ind.atr(st.candles, self.cfg.strategy.atr_period) or 0
        atr_pct = atr_v / closes[-1] * 100 if closes[-1] else 0
        trend_ok = (ind.ema(closes, self.cfg.strategy.ema_fast) or 0) >= \
                   (ind.ema(closes, self.cfg.strategy.ema_slow) or 0)

        # Composite: emerging vol dominates; momentum and liquidity secondary.
        # Penalise deteriorating momentum (negative score contribution).
        score = (rel_vol * 40 + min(rel_v, 5) * 8 + max(mom, -3) * 4
                 + min(atr_pct, 3) * 10 + min(qv / 1e7, 10))
        if mom < -2:
            score *= 0.5                          # deteriorating -> deprioritise
        return Candidate(sym, score, rel_vol, mom, rel_v, qv,
                         spread, last or closes[-1], trend_ok)

    def deteriorating(self, sym: str) -> bool:
        """True when a tracked coin's vol/momentum is rolling over."""
        st = self.mds.states.get(sym)
        if not st or len(st.candles) < 60:
            return False
        closes = [c.close for c in st.candles]
        rv = ind.relative_volatility(closes, 5, 30)
        mom = ind.momentum(closes, 10)
        return bool(rv is not None and rv < 0.7 and mom is not None and mom < -1)
