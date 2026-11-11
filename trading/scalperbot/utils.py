"""Small shared helpers."""
from __future__ import annotations

import math
import time


def now_ms() -> int:
    return int(time.time() * 1000)


def now_s() -> float:
    return time.time()


def floor_to_increment(value: float, increment: float) -> float:
    """Round down to an exchange-legal size/price increment."""
    if increment <= 0:
        return value
    return math.floor(value / increment) * increment


def ceil_to_increment(value: float, increment: float) -> float:
    if increment <= 0:
        return value
    return math.ceil(value / increment) * increment


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def pct(a: float, b: float) -> float:
    """Percent change of a relative to b (b!=0)."""
    if b == 0:
        return 0.0
    return (a - b) / b * 100.0


class RateLimiter:
    """Simple async-friendly token bucket for REST weight control."""

    def __init__(self, max_per_sec: float):
        self.max_per_sec = max_per_sec
        self._tokens = max_per_sec
        self._last = now_s()

    def consume(self, n: float = 1.0) -> float:
        """Returns seconds to wait before the call is allowed (0 = now)."""
        t = now_s()
        self._tokens = min(self.max_per_sec,
                           self._tokens + (t - self._last) * self.max_per_sec)
        self._last = t
        if self._tokens >= n:
            self._tokens -= n
            return 0.0
        return (n - self._tokens) / self.max_per_sec
