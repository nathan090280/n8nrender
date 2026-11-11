"""ScalperBot CLI.

    python main.py scan                        one-shot market ranking (A)
    python main.py backtest [--days N]         historical backtest (J)
    python main.py run                         paper/live bot (config: mode)
    python main.py report                      performance from DB (H)
    python main.py mark paper_done|backtest_done   qualification gate (J)

Live trading is gated: `backtest_done` and `paper_done` must both be
recorded in state/qualification.json first.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

import aiohttp

from scalperbot.backtest import Backtester
from scalperbot.config import ROOT, load_config
from scalperbot.indicators import Candle
from scalperbot.kucoin_public import KucoinPublicREST
from scalperbot.performance import compute
from scalperbot.storage import Storage

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("main")


def _qual() -> dict:
    cfg = load_config()
    p = Path(cfg.qualification_file)
    return json.loads(p.read_text()) if p.exists() else {}


def _set_qual(**kw):
    cfg = load_config()
    p = Path(cfg.qualification_file)
    q = _qual()
    q.update(kw)
    p.write_text(json.dumps(q, indent=2))
    print(f"qualification -> {q}")


# -------------------------------------------------------------------- scan

async def cmd_scan():
    cfg = load_config()
    async with aiohttp.ClientSession() as s:
        rest = KucoinPublicREST(cfg.market.base_url, s)
        from scalperbot.market_data import MarketDataService
        from scalperbot.scanner import Scanner

        class DummyWS:
            topics = set()
            def subscribe(self, t): pass
            def is_stale(self, m): return False
        mds = MarketDataService(rest, DummyWS(), cfg)
        sc = Scanner(cfg, mds)
        await sc.refresh_universe()
        cands = await sc.scan()
        print(f"{'symbol':14} {'score':>7} {'relVol':>7} {'mom%':>7} "
              f"{'rVol':>5} {'sprd%':>6} {'24hQVol':>12} trend")
        for c in cands:
            print(f"{c.symbol:14} {c.score:7.1f} {c.rel_vol:7.2f} "
                  f"{c.mom:7.2f} {c.rel_volume:5.2f} {c.spread_pct:6.3f} "
                  f"{c.quote_volume_24h/1e6:10.1f}M {'up' if c.trend_ok else 'dn'}")


# ---------------------------------------------------------------- backtest

async def cmd_backtest(days: int, symbols: list[str]):
    cfg = load_config()
    async with aiohttp.ClientSession() as s:
        rest = KucoinPublicREST(cfg.market.base_url, s)
        end = int(time.time())
        start = end - days * 86400
        bt = Backtester(cfg)
        all_trades = []
        for sym in symbols:
            # KuCoin candles endpoint returns <=1500 per call; page back
            candles, cur = [], end
            while cur > start:
                rows = await rest.candles(sym, cfg.market.candle_interval,
                                          max(start, cur - 1500 * 60), cur)
                if not rows:
                    break
                candles = rows + candles
                cur = int(rows[0][0])
                if len(rows) < 2:
                    break
            cs = [Candle(ts=int(r[0]) * 1000, open=float(r[1]),
                         close=float(r[2]), high=float(r[3]),
                         low=float(r[4]), volume=float(r[5]))
                  for r in candles]
            print(f"{sym}: {len(cs)} candles "
                  f"({cs[0].ts if cs else '?'} -> {cs[-1].ts if cs else '?'})")
            res = bt.run(sym, cs)
            all_trades += res.trades
            m = compute(res.trades, cfg.risk.starting_capital)
            print(f"  in-sample: {m}")
            oos = bt.out_of_sample(sym, cs)
            tm = compute(oos["test"], cfg.risk.starting_capital)
            print(f"  out-of-sample ({len(oos['test'])} trades): {tm}")
            wf = bt.walk_forward(sym, cs)
            print(f"  walk-forward: {wf}")
        m = compute(all_trades, cfg.risk.starting_capital)
        print(f"\nTOTAL ({len(all_trades)} trades): {m}")
        _set_qual(backtest_done=True, backtest_at=time.time(),
                  backtest_trades=len(all_trades))


# --------------------------------------------------------------------- run

async def _run_once(cfg):
    from scalperbot.orchestrator import Bot
    bot = Bot(cfg)
    await bot.start()
    started = time.time()
    try:
        await bot.run()
    finally:
        # plan J gate: a paper session >30min counts toward qualification
        if cfg.execution.mode == "paper" and time.time() - started > 1800:
            _set_qual(paper_done=True, paper_at=time.time())


def cmd_run():
    cfg = load_config()
    restart_delay, attempt = 2, 0
    while True:                                   # auto-restart (plan J)
        try:
            asyncio.run(_run_once(load_config()))
            break                                 # clean exit
        except KeyboardInterrupt:
            break
        except Exception as e:
            attempt += 1
            log.error("bot crashed (%s) - restart #%d in %ss",
                      e, attempt, restart_delay)
            time.sleep(restart_delay)
            restart_delay = min(restart_delay * 2, 60)


# ------------------------------------------------------------------ report

def cmd_report(mode: str):
    cfg = load_config()
    st = Storage(cfg.db_path)
    trades = [dict(r) for r in st.trades(mode=mode)]
    print(json.dumps(compute(trades, cfg.risk.starting_capital), indent=2))
    st.close()


def main():
    ap = argparse.ArgumentParser(description="ScalperBot (KuCoin)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan")
    p = sub.add_parser("backtest")
    p.add_argument("--days", type=int, default=5)
    p.add_argument("--symbols", nargs="+",
                   default=["BTC-USDT", "ETH-USDT", "SOL-USDT"])
    sub.add_parser("run")
    r = sub.add_parser("report")
    r.add_argument("--mode", default="paper", choices=["paper", "live"])
    m = sub.add_parser("mark")
    m.add_argument("key", choices=["paper_done", "backtest_done"])
    a = ap.parse_args()

    if a.cmd == "scan":
        asyncio.run(cmd_scan())
    elif a.cmd == "backtest":
        asyncio.run(cmd_backtest(a.days, a.symbols))
    elif a.cmd == "run":
        cmd_run()
    elif a.cmd == "report":
        cmd_report(a.mode)
    elif a.cmd == "mark":
        _set_qual(**{a.key: True})


if __name__ == "__main__":
    main()
