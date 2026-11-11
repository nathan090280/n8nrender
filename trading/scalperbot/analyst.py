"""AI analyst layer (advisory only - never trades).

Reads the bot's live snapshot, sends it to the Anthropic Messages API, and
returns market commentary + a regime tag for the dashboard. It has no path
to order placement: it receives a read-only dict and returns text.
Disabled silently when ANTHROPIC_API_KEY is unset.
"""
from __future__ import annotations

import logging
import os
import time

import aiohttp

log = logging.getLogger("analyst")

SYSTEM = (
    "You are an embedded market analyst for an automated KuCoin scalping "
    "bot. You receive a JSON snapshot of its state and market candidates. "
    "Write a concise assessment: current market regime (trending/choppy/"
    "risk-off), quality of the top candidates, any risks you see in the "
    "data (thin books, wide spreads, suspicious moves), and one line "
    "starting with 'REGIME:' followed by a single word tag. You give "
    "analysis only - trading decisions are made by deterministic rules "
    "that you cannot influence. Keep it under 150 words."
)


class AIAnalyst:
    def __init__(self, cfg):
        self.cfg = cfg
        self.key = os.environ.get("ANTHROPIC_API_KEY", "")
        self.model = "claude-sonnet-4-5-20250929"
        self.interval_sec = 300
        self.last_text = "AI analyst: no key configured" if not self.key \
            else "AI analyst: waiting for first analysis..."
        self.last_ts = 0.0
        self.session: aiohttp.ClientSession | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    async def ask(self, question: str, snapshot: dict) -> str:
        """Free-form user question with live bot context (on-demand only)."""
        if not self.enabled or self.session is None:
            return "AI analyst: no key configured"
        import json as _j
        try:
            async with self.session.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": self.key,
                         "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={"model": self.model, "max_tokens": 400,
                      "system": SYSTEM,
                      "messages": [{"role": "user", "content":
                        f"Bot snapshot:\n{_j.dumps(snapshot, default=str)}"
                        f"\n\nUser question: {question}"}]},
                timeout=aiohttp.ClientTimeout(total=20)) as r:
                out = await r.json()
                if r.status != 200:
                    raise RuntimeError(out.get("error", out))
                return out["content"][0]["text"].strip()
        except Exception as e:
            return f"AI analyst error: {e}"

    async def analyze(self, snapshot: dict,
                      force: bool = False) -> str:
        if not self.enabled or self.session is None:
            return self.last_text
        if not force and time.time() - self.last_ts < self.interval_sec:
            return self.last_text
        # strip noise: keep decision-relevant fields only
        payload = {k: snapshot[k] for k in
                   ("mode", "status", "equity", "unrealized",
                    "day_realized", "positions", "candidates",
                    "risk_limits") if k in snapshot}
        try:
            async with self.session.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": self.key,
                         "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={"model": self.model, "max_tokens": 400,
                      "system": SYSTEM,
                      "messages": [{"role": "user",
                                    "content": __import__("json").dumps(
                                        payload, default=str)}]},
                timeout=aiohttp.ClientTimeout(total=20)) as r:
                out = await r.json()
                if r.status != 200:
                    raise RuntimeError(out.get("error", out))
                self.last_text = out["content"][0]["text"].strip()
                self.last_ts = time.time()
        except Exception as e:
            log.warning("analyst call failed: %s", e)
            self.last_text = f"AI analyst error: {e}"
        return self.last_text
