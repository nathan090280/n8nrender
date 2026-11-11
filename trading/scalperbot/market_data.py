"""MarketDataService: maintains live candles, trades and book per symbol.

Sub-minute trading (plan B): decisions use live trade ticks and bookTicker
updates; candles are only the context, not the trigger clock.
"""
from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field

from .indicators import Candle
from .kucoin_public import KucoinPublicREST, KucoinWebSocket
from .utils import now_ms

log = logging.getLogger("market_data")


@dataclass
class SymbolState:
    symbol: str
    candles: deque = field(default_factory=deque)        # Candle, oldest->new
    trades: deque = field(default_factory=deque)         # (ts,px,sz,side)
    bids: list = field(default_factory=list)
    asks: list = field(default_factory=list)
    last_price: float = 0.0
    last_update_ms: int = 0
    stats24: dict = field(default_factory=dict)          # volValue, changeRate..
    macro_candles: list[Candle] = field(default_factory=list)

    def is_stale(self, max_age_ms: int) -> bool:
        return (self.last_update_ms == 0 or
                now_ms() - self.last_update_ms > max_age_ms)


class MarketDataService:
    def __init__(self, rest: KucoinPublicREST, ws: KucoinWebSocket,
                 cfg):
        self.rest, self.ws, self.cfg = rest, ws, cfg
        self.states: dict[str, SymbolState] = {}
        self.ws.on_message = self._on_ws
        self.trade_listeners: list = []        # async cbs(symbol, px, ts)

    # ------------------------------------------------------------- bootstrap
    _INTERVAL_SEC = {"1min": 60, "3min": 180, "5min": 300, "15min": 900,
                     "30min": 1800, "1hour": 3600, "2hour": 7200,
                     "4hour": 14400, "6hour": 21600, "8hour": 28800,
                     "12hour": 43200, "1day": 86400, "1week": 604800}

    async def load_history(self, symbol: str):
        st = self.states.setdefault(symbol, SymbolState(symbol))
        st.candles = deque(maxlen=self.cfg.market.history_limit)
        st.trades = deque(maxlen=2000)
        # KuCoin returns only ~100 rows without startAt - slow-interval bots
        # need an explicit window or they "warm" for days on one bar/interval
        interval = self.cfg.market.candle_interval
        sec = self._INTERVAL_SEC.get(interval, 60)
        start = int(time.time()) - (self.cfg.market.history_limit + 10) * sec
        rows = await self.rest.candles(symbol, interval, start=start)
        for r in rows:
            st.candles.append(Candle(
                ts=int(r[0]) * 1000, open=float(r[1]), close=float(r[2]),
                high=float(r[3]), low=float(r[4]), volume=float(r[5])))
        if st.candles:
            st.last_price = st.candles[-1].close
            st.last_update_ms = now_ms()
        try:
            book = await self.rest.orderbook(symbol)
            self._apply_book(st, book)
        except Exception as e:
            log.warning("book fetch failed for %s: %s", symbol, e)

    def _apply_book(self, st: SymbolState, book: dict):
        st.bids = [[float(p), float(s)] for p, s in book.get("bids", [])]
        st.asks = [[float(p), float(s)] for p, s in book.get("asks", [])]
        st.last_update_ms = now_ms()

    # ------------------------------------------------------------- subscribe
    def subscribe_symbols(self, symbols: list[str]):
        for s in symbols:
            self.states.setdefault(s, SymbolState(s))
        # One desired set, chunked to avoid oversized grouped WS topics.
        syms = sorted(set(symbols))
        groups = [",".join(syms[i:i + 50])
                  for i in range(0, len(syms), 50)]
        desired = {f"/market/match:{group}" for group in groups}
        desired.update(f"/market/ticker:{sym}" for sym in syms)
        for topic in self.ws.topics - desired:
            self.ws.unsubscribe(topic)
        for topic in desired - self.ws.topics:
            self.ws.subscribe(topic)

    # ------------------------------------------------------------- ws feed
    async def _on_ws(self, topic: str, subject: str, data: dict):
        if topic.startswith("/market/match:"):
            group = topic.split(":", 1)[1]
            sym = data.get("symbol") or (group if "," not in group else None)
            if not sym:
                return
            st = self.states.get(sym)
            if st is None:
                return
            px = float(data["price"]); sz = float(data["size"])
            side = data.get("side", "buy")
            ts = int(int(data.get("time", 0)) / 1_000_000) or now_ms()
            st.trades.append((ts, px, sz, side))
            st.last_price = px
            st.last_update_ms = now_ms()
            for cb in self.trade_listeners:
                try:
                    await cb(sym, px, ts)
                except Exception as e:
                    log.error("trade listener error: %s", e)
        elif topic.startswith("/market/ticker:"):
            group = topic.split(":", 1)[1]
            sym = data.get("symbol") or (group if "," not in group else None)
            if not sym:
                return  # never assign a grouped ticker to the first pair
            st = self.states.get(sym)
            if st is None:
                return
            if data.get("bestBid") and data.get("bestAsk"):
                bb, ba = float(data["bestBid"]), float(data["bestAsk"])
                if st.bids:
                    st.bids[0] = [bb, float(data.get("bestBidSize") or 0)]
                else:
                    st.bids = [[bb, 0]]
                if st.asks:
                    st.asks[0] = [ba, float(data.get("bestAskSize") or 0)]
                else:
                    st.asks = [[ba, 0]]
                st.last_price = float(data.get("price") or st.last_price)
                st.last_update_ms = now_ms()

    # ------------------------------------------------------------- refresh
    async def refresh_candle(self, symbol: str):
        """Poll latest candles - keeps history fresh even between WS ticks."""
        st = self.states.get(symbol)
        if st is None:
            return
        try:
            rows = await self.rest.candles(
                symbol, self.cfg.market.candle_interval)
            latest = {}
            for r in rows:
                ts = int(r[0]) * 1000
                latest[ts] = Candle(ts=ts, open=float(r[1]),
                                    close=float(r[2]), high=float(r[3]),
                                    low=float(r[4]), volume=float(r[5]))
            # REST may revise the just-finished bar after it leaves the
            # last slot. Refresh by timestamp so the entry flags see its close.
            for i, candle in enumerate(st.candles):
                if candle.ts in latest:
                    st.candles[i] = latest[candle.ts]
            for ts in sorted(latest):
                if not st.candles or ts > st.candles[-1].ts:
                    st.candles.append(latest[ts])
        except Exception as e:
            log.warning("candle refresh failed %s: %s", symbol, e)

    async def refresh_book(self, symbol: str):
        st = self.states.get(symbol)
        if st is None:
            return
        try:
            self._apply_book(st, await self.rest.orderbook(symbol))
        except Exception as e:
            log.warning("book refresh failed %s: %s", symbol, e)

    # ------------------------------------------------------------- health
    def data_health(self) -> dict:
        """Stale/missing data report used by the risk gate (plan B/F)."""
        max_age = self.cfg.market.stale_data_ms
        out = {"ws_stale": self.ws.is_stale(max_age * 3), "symbols": {}}
        for sym, st in self.states.items():
            out["symbols"][sym] = {
                "stale": st.is_stale(max_age),
                "candles": len(st.candles),
                "has_book": bool(st.bids and st.asks),
                "last_price": st.last_price,
            }
        return out
