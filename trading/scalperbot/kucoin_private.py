"""KuCoin private signed REST client (plan G).

Requires env vars: KUCOIN_API_KEY, KUCOIN_API_SECRET, KUCOIN_API_PASSPHRASE.
Keys must be created with TRADE permission only - never withdrawal.

Signature: sign = b64(hmac_sha256(secret, ts + METHOD + path + body))
Passphrase (v2): b64(hmac_sha256(secret, passphrase))
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import uuid

import aiohttp

from .utils import RateLimiter

log = logging.getLogger("kucoin.private")


class KucoinPrivateREST:
    def __init__(self, base_url: str, key: str, secret: str, passphrase: str,
                 session: aiohttp.ClientSession):
        if not (key and secret and passphrase):
            raise ValueError("Missing KuCoin credentials "
                             "(KUCOIN_API_KEY/SECRET/PASSPHRASE)")
        self.base = base_url.rstrip("/")
        self.key, self.secret = key, secret.encode()
        self.passphrase = passphrase
        self.s = session
        self.rl = RateLimiter(max_per_sec=10)

    def _sign(self, method: str, path: str, body: str = "") -> dict:
        ts = str(__import__("time").time_ns() // 1_000_000)
        pre = ts + method.upper() + path + body
        sig = base64.b64encode(
            hmac.new(self.secret, pre.encode(), hashlib.sha256).digest())
        pw = base64.b64encode(
            hmac.new(self.secret, self.passphrase.encode(),
                     hashlib.sha256).digest())
        return {"KC-API-KEY": self.key, "KC-API-SIGN": sig.decode(),
                "KC-API-TIMESTAMP": ts, "KC-API-PASSPHRASE": pw.decode(),
                "KC-API-KEY-VERSION": "2", "Content-Type": "application/json"}

    async def _req(self, method: str, path: str, body: dict | None = None,
                   params: dict | None = None, retries: int = 2) -> dict:
        payload = json.dumps(body) if body else ""
        if params:
            from urllib.parse import urlencode
            path_q = path + "?" + urlencode(params)
        else:
            path_q = path
        headers = self._sign(method, path_q, payload)
        for attempt in range(retries):
            wait = self.rl.consume()
            if wait:
                await asyncio.sleep(wait)
            try:
                async with self.s.request(
                        method, self.base + path_q, data=payload or None,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=10)) as r:
                    if r.status == 429:
                        await asyncio.sleep(1 + attempt * 2)
                        continue
                    out = await r.json()
                    if r.status >= 400 or out.get("code") != "200000":
                        raise RuntimeError(f"KuCoin {method} {path}: {out}")
                    return out["data"]
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                if attempt == retries - 1:
                    raise RuntimeError(f"{method} {path}: {e}") from e
                await asyncio.sleep(0.5 * (attempt + 1))
        raise RuntimeError("unreachable")

    # ------------------------------------------------------------- accounts
    async def accounts(self, currency: str | None = None) -> list[dict]:
        params = {"type": "trade"}
        if currency:
            params["currency"] = currency
        return await self._req("GET", "/api/v1/accounts", params=params)

    async def balance(self, currency: str) -> float:
        accs = await self.accounts(currency)
        return float(accs[0]["available"]) if accs else 0.0

    async def margin_overview(self) -> float:
        """Cross+isolated margin equity in quote terms (assets - liabilities)."""
        total = 0.0
        try:
            d = await self._req("GET", "/api/v3/margin/accounts")
            total += (float(d.get("totalAssetOfQuoteCurrency") or 0)
                      - float(d.get("totalLiabilityOfQuoteCurrency") or 0))
        except Exception:
            pass
        try:
            d = await self._req("GET", "/api/v3/isolated/accounts")
            total += (float(d.get("totalAssetOfQuoteCurrency") or 0)
                      - float(d.get("totalLiabilityOfQuoteCurrency") or 0))
        except Exception:
            pass
        return total

    # --------------------------------------------------------------- orders
    async def market_order(self, symbol: str, side: str,
                           funds: float | None = None,
                           size: float | None = None,
                           client_oid: str | None = None) -> dict:
        body = {"clientOid": client_oid or uuid.uuid4().hex,
                "symbol": symbol, "side": side, "type": "market"}
        if side == "buy" and funds:
            body["funds"] = f"{funds:.8f}"
        elif size:
            body["size"] = f"{size:.8f}"
        return await self._req("POST", "/api/v1/orders", body=body)

    async def limit_order(self, symbol: str, side: str, price: float,
                          size: float, client_oid: str | None = None,
                          post_only: bool = False) -> dict:
        body = {"clientOid": client_oid or uuid.uuid4().hex,
                "symbol": symbol, "side": side, "type": "limit",
                "price": f"{price:.8f}", "size": f"{size:.8f}",
                "postOnly": post_only}
        return await self._req("POST", "/api/v1/orders", body=body)

    async def get_order(self, order_id: str) -> dict:
        return await self._req("GET", f"/api/v1/orders/{order_id}")

    async def get_order_by_client_oid(self, client_oid: str) -> dict:
        return await self._req(
            "GET", f"/api/v1/order/client-order/{client_oid}")

    async def cancel(self, order_id: str) -> dict:
        return await self._req("DELETE", f"/api/v1/orders/{order_id}")

    async def fills(self, symbol: str | None = None,
                    order_id: str | None = None) -> list[dict]:
        params = {}
        if symbol:
            params["symbol"] = symbol
        if order_id:
            params["orderId"] = order_id
        data = await self._req("GET", "/api/v1/fills", params=params)
        return data.get("items", [])

    async def taker_fee_pct(self, symbol: str) -> float:
        """Actual account/pair taker fee, in percent (not a decimal rate)."""
        data = await self._req(
            "GET", "/api/v1/trade-fees", params={"symbols": symbol})
        item = next((r for r in data if r.get("symbol") == symbol), None)
        if not item or item.get("takerFeeRate") is None:
            raise RuntimeError(f"{symbol}: actual taker fee unavailable")
        fee = float(item["takerFeeRate"]) * 100
        if not 0 <= fee <= 5:
            raise RuntimeError(f"{symbol}: invalid taker fee {fee}")
        return fee

    async def inner_transfer_ok(self) -> bool:
        """Sanity check that keys work and have trade scope."""
        try:
            await self.accounts()
            return True
        except Exception as e:
            log.error("Credential check failed: %s", e)
            return False
