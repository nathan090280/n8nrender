"""Candle-only sensitivity replay for New Bot.

Historical match ticks and order books are unavailable: buyer-flow and
depth gates are NOT replayed. Results are not a live-strategy win rate.
"""
from __future__ import annotations

import argparse
import asyncio
import time
from bisect import bisect_right
from collections import Counter

import aiohttp

from .config import load_config
from .indicators import Candle
from .kucoin_public import KucoinPublicREST
from .new_bot import NewStrategy


def _macro_bars(candles: list[Candle]) -> list[Candle]:
    bars: dict[int, Candle] = {}
    for c in candles:
        ts = c.ts // 900_000 * 900_000
        if ts not in bars:
            bars[ts] = Candle(ts=ts, open=c.open, close=c.close,
                              high=c.high, low=c.low, volume=c.volume)
        else:
            b = bars[ts]
            b.close = c.close
            b.high = max(b.high, c.high)
            b.low = min(b.low, c.low)
            b.volume += c.volume
    return list(bars.values())


def replay(candles: list[Candle], cfg, fee_pct: float = .1,
           slip_pct: float = .05, detailed: bool = False,
           market_bars: list[Candle] | None = None) -> list:
    """Returns net percent or details, assuming absent buyer-flow gates pass."""
    if len(candles) < 800:
        return []
    strategy = NewStrategy(cfg)
    macro = _macro_bars(candles)
    macro_ts = [c.ts for c in macro]
    time_bar = max(1, cfg.strategy.time_exit_sec // 60)
    max_bar = max(time_bar, cfg.strategy.max_hold_sec // 60)
    trades = []
    i = 720
    while i < len(candles) - max_bar - 1:
        now = candles[i]
        end = bisect_right(macro_ts, now.ts - 900_000)
        context = macro[max(0, end - 48):end]
        momentum, _ = strategy.candle_setup(
            candles[i-60:i], now.open, now.close, context)
        if momentum is None:
            i += 1
            continue
        if market_bars is not None:
            market_change = strategy.market_change(
                market_bars, now.ts + 60_000,
                cfg.strategy.new_btc_lookback_h)
            if (market_change is None or
                    market_change <= cfg.strategy.new_min_btc_regime_pct):
                i += 1
                continue
        c20 = candles[i-20:i]
        c30 = candles[i-30:i]
        trend30 = (now.close / c30[0].close - 1) * 100
        headroom20 = (max(c.high for c in c20) / now.close - 1) * 100
        range10 = (max(c.high for c in c20[-10:]) -
                   min(c.low for c in c20[-10:])) / now.close * 100
        mean_rise = (
            sum(c.close for c in c30[-15:]) /
            max(sum(c.close for c in c30[:15]), 1e-12) - 1) * 100
        # Decide using the finished bar, fill at the NEXT bar open.
        entry = candles[i+1].open * (1 + slip_pct / 100)
        if entry <= 0:
            i += 1
            continue
        stop = entry * (1 - cfg.strategy.stop_loss_pct / 100)
        highest = entry
        trailing = False
        exit_px = None
        reason = ""
        max_favorable = 0.0
        end_i = i + 1
        for j in range(i + 1, min(i + max_bar + 2, len(candles))):
            bar = candles[j]
            end_i = j
            max_favorable = max(max_favorable,
                                (bar.high / entry - 1) * 100)
            if bar.open <= stop or bar.low <= stop:
                exit_px = min(bar.open, stop)
                reason = "stop" if not trailing else "trail"
                break
            highest = max(highest, bar.high)
            gain = (highest / entry - 1) * 100
            if gain >= cfg.strategy.trail_steps[0][0]:
                trailing = True
            if trailing:
                offset = cfg.strategy.trail_steps[0][1]
                for threshold, amount in cfg.strategy.trail_steps:
                    if gain >= threshold:
                        offset = amount
                stop = max(stop, highest * (1 - offset / 100))
                if bar.low <= stop:
                    exit_px = stop
                    reason = "trail"
                    break
            gate = cfg.strategy.time_exit_gain_pct
            if gate is None:
                gate = cfg.strategy.trail_activate_pct * 0.3
            if j - i >= time_bar and \
                    (bar.close / entry - 1) * 100 < gate:
                exit_px = bar.close
                reason = "time"
                break
            if j - i >= max_bar:
                exit_px = bar.close
                reason = "maxhold"
                break
        if exit_px is not None:
            net = ((exit_px * (1 - slip_pct / 100)) / entry - 1) * 100
            net -= 2 * fee_pct
            trades.append(
                {"net": net, "reason": reason, "mfe": max_favorable,
                 "mom5": momentum, "trend30": trend30,
                 "headroom20": headroom20, "range10": range10,
                 "mean_rise": mean_rise,
                 "entry_ts": candles[i+1].ts}
                if detailed else net)
        i = end_i + 1
    return trades


async def _run(symbols: list[str]):
    cfg = load_config("config-new.yaml")
    print("CANDLE-ONLY SENSITIVITY: assumes ALL buyer-flow/book gates pass; "
          "BTC 12h gate included; not a validated live win rate.")
    async with aiohttp.ClientSession() as session:
        rest = KucoinPublicREST(cfg.market.base_url, session)
        end = int(time.time())
        btc_rows = await rest.candles(
            "BTC-USDT", "1min", start=end - 24 * 3600, end=end)
        btc_candles = [Candle(
            ts=int(r[0]) * 1000, open=float(r[1]), close=float(r[2]),
            high=float(r[3]), low=float(r[4]), volume=float(r[5]))
            for r in btc_rows]
        market = _macro_bars(btc_candles)
        for sym in symbols:
            try:
                rows = (btc_rows if sym == "BTC-USDT" else
                        await rest.candles(
                            sym, "1min", start=end - 24 * 3600, end=end))
                cs = [Candle(ts=int(r[0]) * 1000, open=float(r[1]),
                             close=float(r[2]), high=float(r[3]),
                             low=float(r[4]), volume=float(r[5]))
                      for r in rows]
                details = replay(cs, cfg, detailed=True, market_bars=market)
                results = [item["net"] for item in details]
                wins = [p for p in results if p > 0]
                losses = [p for p in results if p <= 0]
                print(sym, f"bars={len(cs)} trades={len(results)}",
                      f"wins={len(wins)} net%={sum(results):+.2f}",
                      f"avg_win={sum(wins)/len(wins):.2f}%"
                      if wins else "avg_win=n/a",
                      f"avg_loss={sum(losses)/len(losses):.2f}%"
                      if losses else "avg_loss=n/a")
                print("   exits", dict(Counter(t["reason"] for t in details)),
                      "MFE>1.3%",
                      sum(t["mfe"] >= 1.3 for t in details))
            except Exception as exc:
                print(sym, "unavailable:", str(exc)[:120])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("symbols", nargs="*",
                        default=["BTC-USDT", "ETH-USDT", "XMR-USDT",
                                 "SOL-USDT", "XRP-USDT"])
    asyncio.run(_run(parser.parse_args().symbols))
