"""KuCoin public REST + WebSocket market-data client (plan A/B).

Public endpoints used (no auth):
    GET /api/v1/symbols                     symbol metadata / increments
    GET /api/v1/market/allTickers           24h stats for universe discovery
    GET /api/v1/market/candles              OHLCV history
    GET /api/v1/market/orderbook/level2_20  order-book snapshot
    GET /api/v1/market/histories            recent trades

WebSocket: POST /api/v1/bullet-public -> token + endpoint, then topics:
    /market/match:{symbols}     live trades (sub-minute data)
    /market/ticker:{symbols}    best bid/ask
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid

import aiohttp

from .utils import RateLimiter, now_ms

log = logging.getLogger("kucoin.public")


class KucoinPublicREST:
    def __init__(self, base_url: str, session: aiohttp.ClientSession):
        self.base = base_url.rstrip("/")
        self.s = session
        self.rl = RateLimiter(max_per_sec=8)

    async def _get(self, path: str, params: dict | None = None,
                   retries: int = 3) -> dict | list:
        for attempt in range(retries):
            wait = self.rl.consume()
            if wait:
                await asyncio.sleep(wait)
            try:
                async with self.s.get(self.base + path, params=params,
                                      timeout=aiohttp.ClientTimeout(total=10)
                                      ) as r:
                    if r.status == 429:
                        await asyncio.sleep(1 + attempt * 2)
                        continue
                    r.raise_for_status()
                    payload = await r.json()
                    if payload.get("code") != "200000":
                        raise RuntimeError(f"KuCoin error: {payload}")
                    return payload["data"]
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                if attempt == retries - 1:
                    raise
                await asyncio.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"GET {path} failed after {retries} tries")

    # ------------------------------------------------------------ endpoints
    async def symbols(self) -> list[dict]:
        return await self._get("/api/v2/symbols")

    async def all_tickers(self) -> list[dict]:
        data = await self._get("/api/v1/market/allTickers")
        return data.get("ticker", [])

    async def candles(self, symbol: str, ctype: str = "1min",
                      start: int | None = None,
                      end: int | None = None) -> list[list]:
        # KuCoin returns newest-first rows: [time_s, o, c, h, l, vol, turnover]
        params: dict = {"type": ctype, "symbol": symbol}
        if start:
            params["startAt"] = start
        if end:
            params["endAt"] = end
        rows = await self._get("/api/v1/market/candles", params)
        return list(reversed(rows))          # -> oldest-first

    async def orderbook(self, symbol: str, depth: int = 20) -> dict:
        path = ("/api/v1/market/orderbook/level2_100" if depth > 20
                else "/api/v1/market/orderbook/level2_20")
        return await self._get(path, {"symbol": symbol})

    async def trades(self, symbol: str) -> list[dict]:
        return await self._get("/api/v1/market/histories",
                               {"symbol": symbol})

    async def bullet_public(self) -> dict:
        async with self.s.post(self.base + "/api/v1/bullet-public",
                               timeout=aiohttp.ClientTimeout(total=10)) as r:
            r.raise_for_status()
            return (await r.json())["data"]


class KucoinWebSocket:
    """Resilient WS client: reconnects, resubscribes, tracks staleness."""

    def __init__(self, rest: KucoinPublicREST, on_message, on_state=None):
        self.rest = rest
        self.on_message = on_message          # async cb(topic, subject, data)
        self.on_state = on_state or (lambda s: None)  # cb("up"/"down")
        self.topics: set[str] = set()
        self.last_msg_ms: int = 0
        self._ws = None
        self._stop = asyncio.Event()
        self._id = 0

    def subscribe(self, topic: str):
        if topic in self.topics:
            return
        self.topics.add(topic)
        # live-subscribe on the open socket, not just at reconnect
        if self._ws:
            try:
                asyncio.get_running_loop().create_task(self._send(
                    {"id": self._next(), "type": "subscribe",
                     "topic": topic, "response": True}))
            except RuntimeError:
                pass

    def unsubscribe(self, topic: str):
        if topic not in self.topics:
            return
        self.topics.discard(topic)
        if self._ws:
            try:
                asyncio.get_running_loop().create_task(self._send(
                    {"id": self._next(), "type": "unsubscribe",
                     "topic": topic, "response": True}))
            except RuntimeError:
                pass

    @staticmethod
    def topic_for(kind: str, symbols: list[str], extra: str = "") -> str:
        joined = ",".join(symbols)
        return f"/market/{kind}:{joined}{extra}"

    async def run(self):
        backoff = 1
        while not self._stop.is_set():
            try:
                bullet = await self.rest.bullet_public()
                server = bullet["instanceServers"][0]
                url = (f"{server['endpoint']}?token={bullet['token']}"
                       f"&connectId={uuid.uuid4().hex}")
                ping_ms = int(server.get("pingInterval", 18000))
                async with self.rest.s.ws_connect(
                        url, heartbeat=None,
                        timeout=aiohttp.ClientTimeout(total=30)) as ws:
                    self._ws = ws
                    self.on_state("up")
                    backoff = 1
                    ping_task = asyncio.create_task(self._pinger(ping_ms))
                    try:
                        await self._resubscribe()
                        async for msg in ws:
                            if self._stop.is_set():
                                break
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                await self._handle(msg.data)
                            elif msg.type in (aiohttp.WSMsgType.CLOSED,
                                              aiohttp.WSMsgType.ERROR):
                                break
                    finally:
                        ping_task.cancel()
            except Exception as e:            # reconnect w/ backoff
                log.warning("WS error: %s - reconnecting in %ss", e, backoff)
            self._ws = None
            self.on_state("down")
            if not self._stop.is_set():
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def stop(self):
        self._stop.set()
        if self._ws:
            await self._ws.close()

    async def _pinger(self, ping_ms: int):
        while True:
            await asyncio.sleep(ping_ms / 1000)
            await self._send({"id": self._next(), "type": "ping"})

    async def _resubscribe(self):
        for t in sorted(self.topics):
            await self._send({"id": self._next(), "type": "subscribe",
                              "topic": t, "response": True})
            await asyncio.sleep(0.05)

    async def _send(self, obj: dict):
        if self._ws:
            await self._ws.send_str(json.dumps(obj))

    def _next(self) -> str:
        self._id += 1
        return str(self._id)

    async def _handle(self, raw: str):
        self.last_msg_ms = now_ms()
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        if msg.get("type") == "pong" or msg.get("type") == "ack":
            return
        if msg.get("type") == "message":
            await self.on_message(msg.get("topic", ""),
                                  msg.get("subject", ""),
                                  msg.get("data", {}))

    def is_stale(self, max_age_ms: int) -> bool:
        return self.last_msg_ms == 0 or now_ms() - self.last_msg_ms > max_age_ms
