"""Market data reservoir: scrapes the scarce stuff candles can't give back.

Captures, forever:
  - full USDT ticker snapshots (breadth, 24h stats) every SNAP_SEC
  - recent public trade ticks per tracked symbol every TICK_SEC
  - top-5 order-book snapshots per tracked symbol every BOOK_SEC
  - every fleet bot's /api/state (candidates, blockers, regime) every SNAP_SEC

Tracked symbols = top-N by 24h quote volume + every symbol any bot watches
+ a small majors set, refreshed hourly.

Env: DB_PATH (default /app/state/reservoir.db), SNAP_SEC, TICK_SEC,
BOOK_SEC, TOP_N, RETENTION_DAYS, DASHBOARD_USER, DASHBOARD_PASSWORD.
"""
import asyncio, os, time, json, sqlite3, aiohttp

BASE = "https://api.kucoin.com"
DB = os.environ.get("DB_PATH", "/app/state/reservoir.db")
SNAP_SEC = float(os.environ.get("SNAP_SEC", 60))
TICK_SEC = float(os.environ.get("TICK_SEC", 8))
BOOK_SEC = float(os.environ.get("BOOK_SEC", 60))
TOP_N = int(os.environ.get("TOP_N", 30))
RETENTION = int(os.environ.get("RETENTION_DAYS", 30))
AUTH = (os.environ.get("DASHBOARD_USER", ""), os.environ.get("DASHBOARD_PASSWORD", ""))
BOTS = {
    "main": "http://scalperbot:8377", "15m": "http://scalperbot-15m:8377",
    "new": "http://scalperbot-new:8377", "claude": "http://scalperbot-claude:8377",
    "claude15": "http://scalperbot-claude15:8377", "swing": "http://scalperbot-swing:8377",
}
MAJORS = {"BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT",
          "PEPE-USDT", "LINK-USDT", "AVAX-USDT", "NEAR-USDT", "UNI-USDT"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS tickers(
  ts REAL, sym TEXT, last REAL, chg REAL, vol24 REAL);
CREATE INDEX IF NOT EXISTS tk_i ON tickers(ts);
CREATE TABLE IF NOT EXISTS ticks(
  sym TEXT, seq TEXT, ts REAL, price REAL, size REAL, side TEXT,
  PRIMARY KEY(sym, seq));
CREATE TABLE IF NOT EXISTS books(
  ts REAL, sym TEXT, bids TEXT, asks TEXT);
CREATE INDEX IF NOT EXISTS bk_i ON books(ts);
CREATE TABLE IF NOT EXISTS bot_state(ts REAL, bot TEXT, payload TEXT);
CREATE INDEX IF NOT EXISTS bs_i ON bot_state(ts);
CREATE TABLE IF NOT EXISTS decisions(
  ts REAL, bot TEXT, sym TEXT, blocked TEXT, feat TEXT);
CREATE INDEX IF NOT EXISTS dc_i ON decisions(ts);
"""

symbols: set = set(MAJORS)


def db():
    con = sqlite3.connect(DB, timeout=30)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


async def get(sess, path, auth=None):
    for _ in range(3):
        try:
            kw = {"timeout": aiohttp.ClientTimeout(total=15)}
            if auth:
                kw["auth"] = aiohttp.BasicAuth(*auth)
            async with sess.get(BASE + path if path.startswith("/api") else path, **kw) as r:
                if r.status == 200:
                    return await r.json(content_type=None)
                await asyncio.sleep(0.4 * _)
        except Exception:
            await asyncio.sleep(0.4 * _)
    return None


async def ticker_loop(sess, con):
    while True:
        t0 = time.time()
        d = await get(sess, "/api/v1/market/allTickers")
        rows = (d or {}).get("data", {}).get("ticker") or []
        ts = time.time()
        batch = [(ts, t["symbol"], float(t["last"] or 0),
                  float(t["changeRate"] or 0) * 100, float(t["volValue"] or 0))
                 for t in rows if t.get("symbol", "").endswith("-USDT")]
        con.executemany("INSERT INTO tickers VALUES(?,?,?,?,?)", batch)
        con.commit()
        # refresh tracked set from volume ranking
        top = sorted((t for t in rows if t.get("symbol", "").endswith("-USDT")),
                     key=lambda x: float(x.get("volValue") or 0), reverse=True)
        symbols.update(t["symbol"] for t in top[:TOP_N])
        await asyncio.sleep(max(1, SNAP_SEC - (time.time() - t0)))


async def trades_loop(sess, con):
    syms, idx = [], 0
    while True:
        cur = sorted(symbols)
        if cur != syms:
            syms, idx = cur, 0
        sym = syms[idx % len(syms)] if syms else None
        idx += 1
        if sym:
            d = await get(sess, f"/api/v1/market/histories?symbol={sym}")
            rows = (d or {}).get("data") or []
            con.executemany(
                "INSERT OR IGNORE INTO ticks VALUES(?,?,?,?,?,?)",
                [(sym, str(r["sequence"]), int(r["time"]) / 1e9,
                  float(r["price"]), float(r["size"]), r["side"])
                 for r in rows if isinstance(r, dict) and "sequence" in r])
            con.commit()
        await asyncio.sleep(TICK_SEC)


async def books_loop(sess, con):
    while True:
        t0 = time.time()
        for sym in sorted(symbols):
            d = await get(sess, f"/api/v1/market/orderbook/level2_20?symbol={sym}")
            dd = (d or {}).get("data") or {}
            if dd.get("bids"):
                con.execute("INSERT INTO books VALUES(?,?,?,?)",
                            (time.time(), sym,
                             json.dumps(dd["bids"][:5]), json.dumps(dd["asks"][:5])))
            await asyncio.sleep(0.15)
        con.commit()
        await asyncio.sleep(max(1, BOOK_SEC - (time.time() - t0)))


def walk_candidates(d):
    """Yield (sym, blocked, feat) from a bot /api/state payload."""
    seen = set()
    for key in ("candidates", "new_candidates", "claude_candidates", "swing_candidates"):
        for r in d.get(key) or []:
            sym = r.get("symbol")
            if not sym or sym in seen:
                continue
            seen.add(sym)
            feat = {k: r[k] for k in r
                    if k not in ("symbol", "blocked") and not callable(r[k])}
            yield sym, str(r.get("blocked") or ""), feat


async def bots_loop(sess, con):
    while True:
        t0 = time.time()
        for bot, url in BOTS.items():
            d = await get(sess, url + "/api/state", auth=AUTH)
            if not d:
                continue
            ts = time.time()
            con.execute("INSERT INTO bot_state VALUES(?,?,?)",
                        (ts, bot, json.dumps(d)))
            for sym, blocked, feat in walk_candidates(d):
                con.execute("INSERT INTO decisions VALUES(?,?,?,?,?)",
                            (ts, bot, sym, blocked, json.dumps(feat)))
        con.commit()
        await asyncio.sleep(max(1, SNAP_SEC - (time.time() - t0)))


async def prune_loop(con):
    while True:
        await asyncio.sleep(3600)
        cut = time.time() - RETENTION * 86400
        for tbl in ("tickers", "books", "bot_state", "decisions"):
            con.execute(f"DELETE FROM {tbl} WHERE ts < ?", (cut,))
        con.execute("DELETE FROM ticks WHERE ts < ?", (cut,))
        con.commit()


async def main():
    con = db()
    print(f"collector up -> {DB} (retention {RETENTION}d)", flush=True)
    async with aiohttp.ClientSession() as sess:
        await asyncio.gather(
            ticker_loop(sess, con), trades_loop(sess, con),
            books_loop(sess, con), bots_loop(sess, con), prune_loop(con))


if __name__ == "__main__":
    asyncio.run(main())
