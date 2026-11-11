"""Notifications: console + optional webhook (plan J: halt/error alerts)."""
from __future__ import annotations

import logging

import aiohttp

log = logging.getLogger("notify")


class Notifier:
    def __init__(self, webhook_url: str = "", session=None):
        self.url = webhook_url
        self.session = session

    async def send(self, level: str, kind: str, message: str,
                   data: dict | None = None):
        line = f"[{level.upper()}] {kind}: {message}"
        (log.error if level == "critical" else log.info)(line)
        if self.url and self.session:
            try:
                await self.session.post(
                    self.url, json={"level": level, "kind": kind,
                                    "message": message, "data": data or {}},
                    timeout=aiohttp.ClientTimeout(total=5))
            except Exception as e:
                log.warning("webhook notify failed: %s", e)

    async def critical(self, kind: str, message: str, data=None):
        await self.send("critical", kind, message, data)

    async def info(self, kind: str, message: str, data=None):
        await self.send("info", kind, message, data)
