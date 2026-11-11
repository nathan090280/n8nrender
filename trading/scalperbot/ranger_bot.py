"""Ranger: peak/trough range hunter.

Detects established horizontal ranges on 15m candles: >=2 touches of a
floor AND a ceiling over ~24h, range height 1.8-10%, low net drift.
Enters LONG near the floor once a completed candle turns up, stop just
below the floor (a range break kills the thesis). Trailing ladder locks
profit - the ONLY exits are the trail catching a reversal or the floor
breaking. No time exits, no max_hold - a range can rotate for days.

Live: real spot market orders via key1 creds. Size = 90% of available
USDT (minus $1 dust buffer), up to one long + one short at a time (they
live in different accounts). Closed trades write
to the shared trades table (mode='live', meta.bot='ranger').
Toggle via /api/path path=ranger - OFF blocks new entries, open
positions keep being managed to exit.
"""
import asyncio, json, os, time, sqlite3, aiohttp
from collections import deque
from aiohttp import web
from .kucoin_private import KucoinPrivateREST
from .storage import Storage

LIVE = os.environ.get("LIVE", "1") == "1"
LIVE_SHORT = os.environ.get("LIVE_SHORT", "1") == "1"
BASE = os.environ.get("KUCOIN_BASE_URL", "https://api.kucoin.com")
kp_margin = None
MIN_BORROW_UNITS = 10.5  # KuCoin v3 borrow floor: >=10 units of base coin
DB = os.environ.get("DB_PATH", "/app/state/scalperbot.db")
POSF = os.environ.get("POS_PATH", "/app/state/ranger_positions.json")
PORT = int(os.environ.get("PORT", 8377))
FEE = float(os.environ.get("FEE_PCT", 0.1)) / 100
POT_USE = float(os.environ.get("POT_USE", 0.9))   # 90% of free USDT/entry
TOP_N = int(os.environ.get("TOP_N", 25))
# tight profit-lock ladder: bank ~70-85% of the move at each rung -
# +0.5% arms and immediately locks +0.35% (~9c on a $26 range trade)
LADDER = [(1.0, 0.5), (1.5, 1.0), (2.0, 1.5), (2.5, 2.0),
          (3.0, 2.5), (4.0, 3.4), (5.0, 4.3), (6.0, 5.2), (8.0, 7.0),
          (10.0, 8.7)]
kp = None
store = None      # shared DB handle for symbol claims (set on first scan)

syms, positions = {}, {}
closed_at = {}                        # sym -> last exit ts (cooldown)
COOLDOWN_SEC = 3600                   # a broken range is dead for 1h
close_times = []                      # recent closes -> panic circuit
panic_until = 0.0                     # epoch: no entries at all until then
PANIC_CLOSES = 3                      # losing closes within PANIC_WIN trip it
PANIC_WIN = 600
DAY_LOSS_CAP = float(os.environ.get("DAY_LOSS_CAP", -1.50))
MAX_TRADES_DAY = 12
cands = []
ENTRY_DEFAULT = os.environ.get("RANGER_ENTRIES_ENABLED", "0") == "1"
enabled, realized, trades_today, day = ENTRY_DEFAULT, 0.0, 0, ""
day_realized, day_fees = 0.0, 0.0


def save_all():
    json.dump(positions, open(POSF, "w"))
    json.dump({"enabled": enabled, "realized": realized},
              open(POSF.replace("positions", "state"), "w"))


def load_all():
    global positions, enabled, realized
    try:
        positions = json.load(open(POSF))
    except Exception:
        positions = {}
    try:
        st = json.load(open(POSF.replace("positions", "state")))
        enabled, realized = st.get("enabled", ENTRY_DEFAULT), st.get("realized", 0.0)
    except Exception:
        pass


def db():
    return sqlite3.connect(DB, timeout=30)


async def fetch(sess, url):
    async with sess.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
        return await r.json()


async def universe(sess):
    d = await fetch(sess, f"{BASE}/api/v1/market/allTickers")
    rows = (d.get("data") or {}).get("ticker") or []
    top = sorted((t for t in rows if t.get("symbol", "").endswith("-USDT")
                  and float(t.get("volValue") or 0) > 5e5),
                 key=lambda x: float(x["volValue"]), reverse=True)[:TOP_N]
    syms = {t["symbol"]: float(t["last"] or 0) for t in top}
    # held positions MUST stay priced even if they drop out of top-N,
    # or their stops go unmanaged
    for t in rows:
        if t.get("symbol") in positions and t["symbol"] not in syms:
            syms[t["symbol"]] = float(t["last"] or 0)
    return syms


async def candles15(sess, sym, n=110):
    d = await fetch(sess, f"{BASE}/api/v1/market/candles?type=15min"
                          f"&symbol={sym}")
    rows = (d.get("data") or [])[:n][::-1]
    return rows  # [ts,o,c,h,l,vol,turnover] oldest->newest


def detect_range(rows):
    """Return dict{floor, ceil, ftouch, ctouch, rng_pct} or None.

    Break-aware: if price closed outside the fitted range for 2+
    consecutive bars, the old range is dead - refit using only bars
    after the last break so we trade the CURRENT range, not old news.
    """
    if len(rows) < 60:
        return None
    win = rows[-96:]
    # iteratively cut the window at each confirmed breakout
    for _ in range(4):
        lows0 = [float(x[4]) for x in win]
        highs0 = [float(x[3]) for x in win]
        fl = sorted(lows0)[len(lows0) // 10]
        ce = sorted(highs0, reverse=True)[len(highs0) // 10]
        if fl <= 0 or ce <= fl:
            return None
        cut = None
        for i in range(len(win) - 2):
            c1 = float(win[i][2])
            c2 = float(win[i + 1][2])
            c3 = float(win[i + 2][2])
            if (c1 < fl * 0.998 and c2 < fl * 0.998 and c3 < fl * 0.998) or \
                    (c1 > ce * 1.002 and c2 > ce * 1.002
                     and c3 > ce * 1.002):
                cut = i + 1          # breakout starts here; keep latest
        if cut is None:
            break
        win = win[cut:]
        if len(win) < 40:
            return None              # broke out recently; new range unproven
    # recent-weighted fit: levels from the last ~16h, touches over window
    fit = win[-64:]
    lows = [float(x[4]) for x in win]
    highs = [float(x[3]) for x in win]
    closes = [float(x[2]) for x in win]
    floor = sorted(float(x[4]) for x in fit)[len(fit) // 10]
    ceil = sorted((float(x[3]) for x in fit), reverse=True)[len(fit) // 10]
    if floor <= 0 or ceil <= floor:
        return None
    rng = (ceil / floor - 1) * 100
    if not (1.8 <= rng <= 10.0):
        return None
    tol_f, tol_c = floor * 0.004, ceil * 0.004
    ft = sum(1 for l in lows if abs(l - floor) <= tol_f)
    ct = sum(1 for h in highs if abs(h - ceil) <= tol_c)
    if ft < 2 or ct < 2:
        return None
    drift = abs(closes[-1] - closes[0]) / (ceil - floor)
    if drift > 0.9:
        return None
    return {"floor": floor, "ceil": ceil, "ft": ft, "ct": ct, "rng": rng}


async def close_pos(sym, p, px, why):
    global realized, day_realized, panic_until, day_fees
    if p.get("live") and p["side"] == "short" and kp_margin is not None:
        try:
            await kp_margin._req(
                "POST", "/api/v3/hf/margin/order",
                body={"clientOid": __import__("uuid").uuid4().hex,
                      "side": "buy", "symbol": sym, "type": "market",
                      "size": f"{p['qty']:.8f}", "marginModel": "cross",
                      "autoRepay": True})
        except Exception as ex:
            print(f"ranger cover fail {sym}: {str(ex)[:80]}", flush=True)
            return                    # keep position; retry next tick
    elif p.get("live") and p["side"] == "long" and kp is not None:
        try:
            bals = await kp.accounts(sym.split("-")[0])
            real_q = float((bals[0] if bals else {}).get("available") or 0)
            qty = min(p["qty"], real_q)
            if qty <= 0:
                print(f"ranger {sym} no balance left; closing ledger",
                      flush=True)
            else:
                await kp.market_order(sym, "sell", size=qty)
        except Exception as ex:
            print(f"ranger sell fail {sym}: {str(ex)[:80]}", flush=True)
            return                    # keep position; retry next tick
    qty = p["qty"]
    gross = ((px - p["entry"]) if p["side"] == "long"
             else (p["entry"] - px)) * qty
    fees = (p["entry"] + px) * qty * FEE
    net = gross - fees
    # release + drop the ledger FIRST: the history write below is
    # best-effort and a failed close must never be retried into dupes
    if store:
        try:
            store.release_symbol(sym, "ranger")
        except Exception:
            pass
    del positions[sym]
    closed_at[sym] = time.time()        # symbol is done for COOLDOWN_SEC
    if net < 0:
        close_times.append(time.time())
    realized += net
    day_realized += net
    day_fees += fees
    if len([t for t in close_times
            if time.time() - t < PANIC_WIN]) >= PANIC_CLOSES:
        panic_until = time.time() + 3600
        print(f"RANGER PANIC HALT: {PANIC_CLOSES} losing closes/"
              f"{PANIC_WIN}s — entries frozen 1h", flush=True)
    try:
        conn = db()
        try:
            conn.execute(
                "INSERT INTO trades (symbol,side,entry_ts,exit_ts,qty,"
                "entry_price,exit_price,gross_pnl,fees,net_pnl,exit_reason,"
                "mode,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (sym, p["side"], p["ts"], time.time(), qty, p["entry"], px,
                 gross, fees, net, why,
                 "live" if p.get("live") else "paper",
                 json.dumps({"bot": "ranger", "signal": ["range"],
                             "rung": p["rung"], "floor": p.get("floor"),
                             "ceil": p.get("ceil")})))
            conn.commit()
        finally:
            conn.close()
    except Exception as ex:
        print(f"ranger trade record fail {sym}: {str(ex)[:80]}",
              flush=True)
    print(f"RANGER CLOSE {sym} @ {px} net {net:+.3f} ({why})", flush=True)


_bal_check = 0.0
_mng_busy = False


async def manage():
    global _mng_busy
    if _mng_busy:
        return
    _mng_busy = True
    try:
        await _manage_body()
    finally:
        _mng_busy = False


async def _manage_body():
    global _bal_check
    # a live long whose coins are gone (manual sell / external close)
    # must close the ledger even when the stop hasn't triggered
    if kp is not None and time.time() - _bal_check > 60:
        _bal_check = time.time()
        for sym, p in list(positions.items()):
            if not (p.get("live") and p.get("side") == "long"):
                continue
            try:
                bals = await kp.accounts(sym.split("-")[0])
                free = float((bals[0] if bals else {}).get("available")
                             or 0)
                if free < p["qty"] * 0.5:
                    print(f"ranger {sym} balance gone "
                          f"({free:.6f}<{p['qty']:.6f}); external close",
                          flush=True)
                    try:                    # find the real exit fill
                        fills = await kp.fills(sym)
                        items = (fills if isinstance(fills, list)
                                 else fills.get("items", []))
                        sell = next(
                            (f for f in items if f["side"] == "sell"),
                            None)
                        exit_px = (float(sell["price"]) if sell
                                   else p["entry"])
                    except Exception:
                        exit_px = p["entry"]
                    await close_pos(sym, p, exit_px, "external_close")
            except Exception as ex:
                print(f"ranger bal check {sym}: {str(ex)[:60]}",
                      flush=True)
    for sym, p in list(positions.items()):
        px = syms.get(sym)
        if not px:
            continue
        side = p["side"]
        gain = (((px - p["entry"]) if side == "long" else
                 (p["entry"] - px)) / p["entry"]) * 100
        for i, (thr, lock) in enumerate(LADDER):
            if gain >= thr and i > p["rung"]:
                lvl = p["entry"] * (1 + lock / 100) if side == "long" \
                    else p["entry"] * (1 - lock / 100)
                if (side == "long" and lvl > p["stop"]) or \
                        (side == "short" and lvl < p["stop"]):
                    p["stop"], p["rung"] = lvl, i
        why = None
        if side == "long" and px <= p["stop"]:
            why = "trailing_stop" if p["rung"] >= 0 else "stop_loss"
        elif side == "short" and px >= p["stop"]:
            why = "trailing_stop" if p["rung"] >= 0 else "stop_loss"
        elif side == "long" and px < p.get("brk",
                                           p["floor"] * 0.997):
            why = "range_broken"
        elif side == "short" and px > p["ceil"] * 1.003:
            why = "range_broken"
        if why:
            await close_pos(sym, p, px, why)
    save_all()


async def scan(sess):
    global cands, trades_today, day, kp, day_realized, panic_until
    global day_fees
    today = time.strftime("%Y-%m-%d", time.gmtime())
    if day != today:
        day, trades_today, day_realized, day_fees = today, 0, 0.0, 0.0
        panic_until = 0.0
        try:                            # seed day P&L from real trade rows
            conn = db()
            r = conn.execute(
                "SELECT COALESCE(SUM(net_pnl),0), COUNT(*),"
                " COALESCE(SUM(fees),0) FROM trades"
                " WHERE meta LIKE '%ranger%' AND exit_ts >= ?",
                (time.time() - time.time() % 86400,)).fetchone()
            day_realized, trades_today, day_fees = \
                float(r[0]), int(r[1]), float(r[2])
            conn.close()
        except Exception:
            pass
    global store
    if store is None:
        store = Storage(DB)
    if LIVE and kp is None:
        kp = KucoinPrivateREST(BASE, os.environ.get("KUCOIN_API_KEY", ""),
                               os.environ.get("KUCOIN_API_SECRET", ""),
                               os.environ.get("KUCOIN_API_PASSPHRASE", ""),
                               sess)
        print("RANGER live: real spot orders", flush=True)
    global kp_margin
    if LIVE_SHORT and kp_margin is None:
        kp_margin = KucoinPrivateREST(
            BASE, os.environ.get("KUCOIN_API_KEY2", ""),
            os.environ.get("KUCOIN_API_SECRET2", ""),
            os.environ.get("KUCOIN_API_PASSPHRASE2", ""), sess)
        print("RANGER live shorts: cross-margin via key2", flush=True)
    global syms
    syms.update(await universe(sess))
    out = []
    for sym, px in list(syms.items()):
        if not px:
            continue
        try:
            rows = await candles15(sess, sym)
            await asyncio.sleep(.08)
        except Exception:
            continue
        if len(rows) < 60:
            continue
        R = detect_range(rows)
        row = {"symbol": sym, "px": px}
        if R is None:
            row["blocked"] = "no range"
            out.append(row)
            continue
        row.update({"floor": R["floor"], "ceil": R["ceil"],
                    "rng": round(R["rng"], 1),
                    "touches": f"{R['ft']}/{R['ct']}"})
        near = px <= R["floor"] * 1.003
        near_c = px >= R["ceil"] * 0.997
        prev = rows[-1]                       # last completed bar
        bull = float(prev[2]) > float(prev[1])
        # dying-coin veto: >6% down over the whole window = floors are
        # stairs, not bounces - skip longs entirely
        dying = float(rows[-1][2]) < float(rows[0][2]) * 0.94
        bear = float(prev[2]) < float(prev[1])
        open_long = any(p.get("side") == "long" for p in positions.values())
        open_short = any(p.get("side") == "short" for p in positions.values())
        cd_left = closed_at.get(sym, 0) + COOLDOWN_SEC - time.time()
        if panic_until > time.time():
            row["blocked"] = f"PANIC halt {int((panic_until-time.time())/3600)}h"
        elif day_realized <= DAY_LOSS_CAP:
            row["blocked"] = "daily loss cap"
        elif trades_today >= MAX_TRADES_DAY:
            row["blocked"] = "max trades/day"
        elif positions.get(sym):
            row["blocked"] = "position open"
        elif cd_left > 0:
            row["blocked"] = f"cooldown {int(cd_left/60)}m"
        elif not enabled:
            row["blocked"] = "bot OFF"
        elif px > R["ceil"] * 1.002:
            row["blocked"] = f"over ceil {R['ceil']:.4f} (broken)"
        elif near_c and bear and open_short:
            row["blocked"] = "short already open"
        elif near_c and bear:
            # ------ SHORT the ceiling: borrow -> sell -> autoRepay ------
            qty = None
            if LIVE_SHORT and kp_margin is not None:
                qty = max(0.9 * 5.0 / px, MIN_BORROW_UNITS)
                if qty * px > 20.0:
                    row["blocked"] = f"borrow too big ${qty*px:.0f}"
                    qty = None
            if qty and store and not store.claim_symbol(sym, "ranger"):
                row["blocked"] = "held by other bot"
                qty = None
            if qty:
                try:
                    await kp_margin._req(
                        "POST", "/api/v3/hf/margin/order",
                        body={"clientOid": __import__("uuid").uuid4().hex,
                              "side": "sell", "symbol": sym,
                              "type": "market", "size": f"{qty:.8f}",
                              "marginModel": "cross", "autoBorrow": True})
                    stop = R["ceil"] * 1.004
                    sd = min(max((stop - px) / px * 100, 0.8), 2.5)
                    positions[sym] = {
                        "sym": sym, "side": "short", "entry": px,
                        "ts": time.time(), "qty": qty,
                        "stop": px * (1 + sd / 100), "rung": -1,
                        "live": True, "floor": R["floor"], "ceil": R["ceil"]}
                    trades_today += 1
                    print(f"RANGER SHORT {sym} @ {px} ceil {R['ceil']:.4f}",
                          flush=True)
                    row["blocked"] = "SHORTED"
                except Exception as ex:
                    print(f"ranger short fail {sym}: {str(ex)[:80]}",
                          flush=True)
                    if store:
                        store.release_symbol(sym, "ranger")
                    row["blocked"] = "short failed"
            elif not qty:
                row.setdefault("blocked", "short off")
        elif not near:
            row["blocked"] = f"mid-range {100*(px-R['floor'])/R['floor']:.1f}%"
        elif px < R["floor"] * 0.985:
            row["blocked"] = f"deep break < {R['floor']*0.985:.4f}"
        elif dying:
            row["blocked"] = "dying coin"
        elif not bull:
            row["blocked"] = "no turn yet"
        elif open_long:
            row["blocked"] = "long already open"
        else:
            cash = 5.0
            if LIVE and kp is not None:
                try:
                    bals = await kp.accounts("USDT")
                    cash = max(0.0, float(bals[0]["available"]) - 1.0)
                except Exception:
                    cash = 0.0
            size_q = round(cash * POT_USE, 2)   # funds increment is 0.01
            if size_q < 1.0:
                row["blocked"] = f"no cash ${cash:.2f}"
            elif store and not store.claim_symbol(sym, "ranger"):
                row["blocked"] = "held by other bot"
            else:
                stop = R["floor"] * 0.996
                sd = min(max((px - stop) / px * 100, 0.8), 2.5)
                stop = px * (1 - sd / 100)
                qty = size_q / px
                live = False
                if LIVE and kp is not None:
                    try:
                        await kp.market_order(sym, "buy", funds=size_q)
                        b = await kp.accounts(sym.split("-")[0])
                        qty = float((b[0] if b else {}).get("available")
                                    or qty)
                        live = True
                    except Exception as ex:
                        print(f"ranger buy fail {sym}: {str(ex)[:80]}",
                              flush=True)
                        if store:
                            store.release_symbol(sym, "ranger")
                        row["blocked"] = "buy failed"
                if not row.get("blocked"):
                    positions[sym] = {
                        "sym": sym, "side": "long", "entry": px,
                        "ts": time.time(), "qty": qty, "stop": stop,
                        "rung": -1, "live": live,
                        "floor": R["floor"], "ceil": R["ceil"],
                        "brk": R["floor"] * (0.9965 if px
                                           >= R["floor"] * 0.998
                                           else 0.985)}
                    trades_today += 1
                    print(f"RANGER LONG {sym} @ {px} floor {R['floor']:.4f}"
                          f" rng {R['rng']:.1f}%", flush=True)
                    row["blocked"] = "ENTERED"
        out.append(row)
    cands = sorted(out, key=lambda r: r.get("rng", 0), reverse=True)[:40]


async def state(_req):
    open_p = [{"symbol": s, "side": p["side"], "entry": p["entry"],
               "px": syms.get(s), "last": syms.get(s) or p["entry"],
               "qty": p["qty"], "stop": p["stop"], "rung": p["rung"],
               "take": 0.0, "bot": "ranger", "path": "ranger",
               "held_s": int(time.time() - p["ts"]),
               "upnl_pct": round(
                   (((syms.get(s) or p["entry"]) - p["entry"])
                    if p["side"] == "long" else
                    (p["entry"] - (syms.get(s) or p["entry"])))
                   / p["entry"] * 100, 2),
               "floor": p["floor"], "ceil": p["ceil"],
               "gain_pct": round(
                   (((syms.get(s) or p["entry"]) - p["entry"])
                    if p["side"] == "long" else
                    (p["entry"] - (syms.get(s) or p["entry"])))
                   / p["entry"] * 100, 2)}
              for s, p in positions.items()]
    try:
        n_today = db().execute(
            "SELECT COUNT(*) FROM trades WHERE meta LIKE '%ranger%'"
            " AND exit_ts > ?", (time.time() - 86400,)).fetchone()[0]
    except Exception:
        n_today = 0
    unreal = sum((((syms.get(s) or p["entry"]) - p["entry"])
                  if p["side"] == "long" else
                  (p["entry"] - (syms.get(s) or p["entry"]))) * p["qty"]
                 for s, p in positions.items())
    return web.json_response({
        "bot_id": "ranger", "mode": "live" if LIVE else "paper",
        "halted": False, "watched": len(syms),
        "status": "scanning" if enabled else "entries OFF (managing only)",
        "enabled": enabled, "paths": {"ranger": enabled},
        "equity": round(realized + 50, 2), "cash": 0, "allocation_pct": 0,
        "today_trades": n_today, "trades_today": trades_today,
        "realized_pnl": round(realized, 4), "daily_pnl":
        round(day_realized, 4),
        "day_realized": round(day_realized, 4),
        "fees_today": round(day_fees, 4),
        "unrealized": round(unreal, 4),
        "positions": open_p, "candidates": cands, "long_candidates": cands,
        "open_orders": []})


async def path_toggle(req):
    global enabled
    try:
        d = await req.json()
    except Exception:
        d = {}
    if d.get("path") == "ranger":
        enabled = bool(d.get("on"))
        save_all()
        print(f"ranger enabled={enabled}", flush=True)
    return web.json_response({"ok": True, "enabled": enabled})


async def fast_tick(sess):
    """~1.2s price refresh on held positions so stops see wicks the
    6s scan loop would miss."""
    while True:
        try:
            for sym in list(positions):
                d = await fetch(
                    sess, f"{BASE}/api/v1/market/orderbook/level1"
                          f"?symbol={sym}")
                px = float(((d or {}).get("data") or {})
                           .get("price") or 0)
                if px:
                    syms[sym] = px
            if positions:
                await manage()
        except Exception:
            pass
        await asyncio.sleep(1.2)


async def run():
    load_all()
    app = web.Application()
    app.router.add_get("/api/state", state)
    app.router.add_post("/api/path", path_toggle)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    print(f"ranger up :{PORT} live={LIVE}", flush=True)
    async with aiohttp.ClientSession() as sess:
        asyncio.create_task(fast_tick(sess))
        while True:
            try:
                await scan(sess)
                await manage()
            except Exception as e:
                print("loop err", e, flush=True)
            await asyncio.sleep(6)


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()
