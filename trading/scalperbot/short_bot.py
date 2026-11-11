"""Long Shorts: PAPER dual-direction bot.

Longs  = the real ClaudeStrategy (identical params, identical logic) run
         paper-side: capitulation flush below value -> buy the turn up.
Shorts = the same staged formula mirrored: blow-off spike above value with
         climactic volume -> 'sell' the turn down. Same variables, inverted.

Hard mutex: a long and a short can never coexist - if one is open the
other direction's entries are skipped entirely.

Paper only: simulated fills at live prices, 1x, 0.1% fees each way. Closed
trades are written to the shared trades table (mode='paper', meta.bot=
'longshort') so fleet history sees them. Toggle via /api/path path=short -
OFF blocks new entries, open positions keep being managed.

Env: DB_PATH, POS_PATH, PORT, SIZE_Q, TOP_N, FEE_PCT, MAX_HOLD_MIN,
RETENTION not needed here.
"""
import asyncio, json, os, time, sqlite3, aiohttp
from collections import deque
from aiohttp import web
from .indicators import Candle
from .kucoin_private import KucoinPrivateREST

LIVE_LONG = os.environ.get("LIVE_LONG", "0") == "1"
LIVE_SHORT = os.environ.get("LIVE_SHORT", "0") == "1"
BASE_URL = os.environ.get("KUCOIN_BASE_URL", "https://api.kucoin.com")
kp = None         # spot client (key1) for live longs
kp_margin = None  # margin client (key2/Scalper4) for live shorts
MIN_BORROW_UNITS = 10.5  # KuCoin v3 borrow floor: >=10 units of base coin

BASE = "https://api.kucoin.com"
DB = os.environ.get("DB_PATH", "/app/state/scalperbot.db")
POSF = os.environ.get("POS_PATH", "/app/state/longshort_positions.json")
PORT = int(os.environ.get("PORT", 8377))
SIZE_Q = float(os.environ.get("SIZE_Q", 5))
FEE = float(os.environ.get("FEE_PCT", 0.1)) / 100
MAX_HOLD_MIN = float(os.environ.get("MAX_HOLD_MIN", 90))
TOP_N = int(os.environ.get("TOP_N", 15))
# shared ladder: (gain% from entry, floor locked at % in profit)
LADDER = [(1.0, 0.0), (2.0, 0.75), (3.0, 1.75), (4.0, 2.75), (5.0, 3.75),
          (6.0, 4.75), (7.0, 5.75), (8.0, 6.75), (9.0, 7.75), (10.0, 8.75)]
# short staging mirrors the SAME claude 15m params (read from claude.p at
# runtime): mr_stretch_atr, mr_vol_mult, mr_bars, atr_stop, min/max_stop,
# btc gate inverted: longs blocked by weak tape -> shorts blocked by strong
BTC_GATE = float(os.environ.get("BTC_GATE_PCT", 0.0))  # shorts need sad tape

syms, candles1m, candles15 = {}, {}, {}
long_cands, short_cands, positions = [], [], {}
enabled_long, enabled_short = True, True
closed_at = {}                        # sym -> last exit ts (cooldown)
COOLDOWN_SEC = 3600                   # no re-entry for 1h after an exit
close_times = []                      # recent closes -> panic circuit
panic_until = 0.0                     # epoch: no entries until then
PANIC_CLOSES = 3                      # losing closes within PANIC_WIN trip it
PANIC_WIN = 600
DAY_LOSS_CAP = -0.40                  # stop trading for the day past this
MAX_TRADES_DAY = 12
day_realized, day_fees = 0.0, 0.0
realized, trades_today, day = 0.0, 0, ""
btc1h = None
STATEF = POSF + ".state"


def db():
    c = sqlite3.connect(DB, timeout=30)
    c.execute("PRAGMA journal_mode=WAL")
    return c


def save_all():
    try:
        json.dump(positions, open(POSF, "w"))
        json.dump({"enabled_long": enabled_long,
                   "enabled_short": enabled_short,
                   "realized": realized}, open(STATEF, "w"))
    except Exception:
        pass


def load_all():
    global positions, enabled_long, enabled_short, realized
    try:
        positions = json.load(open(POSF))
    except Exception:
        positions = {}
    try:
        st = json.load(open(STATEF))
        enabled_long = st.get("enabled_long", st.get("enabled", True))
        enabled_short = st.get("enabled_short", st.get("enabled", True))
        realized = st.get("realized", 0.0)
    except Exception:
        pass


async def get(sess, path):
    for i in range(3):
        try:
            async with sess.get(BASE + path, timeout=aiohttp.ClientTimeout(total=12)) as r:
                if r.status == 200:
                    return await r.json(content_type=None)
                await asyncio.sleep(.3 * i)
        except Exception:
            await asyncio.sleep(.3 * i)
    return None


async def universe(sess):
    global syms
    d = await get(sess, "/api/v1/market/allTickers")
    rows = (d or {}).get("data", {}).get("ticker") or []
    top = sorted((t for t in rows if t.get("symbol", "").endswith("-USDT")
                  and float(t.get("volValue") or 0) > 1e6),
                 key=lambda x: float(x["volValue"]), reverse=True)[:TOP_N]
    syms = {t["symbol"]: float(t["last"] or 0) for t in top}
    # held positions MUST stay priced — a symbol dropping out of top-N
    # leaves its stop unmanaged otherwise
    for t in rows:
        if t.get("symbol") in positions and t["symbol"] not in syms:
            syms[t["symbol"]] = float(t["last"] or 0)
    # the prey: coins already in sustained decline (serial bleeders live
    # below the volume radar - AKE/JCT/EVAA paid +30% each in the replay)
    bleeders = sorted((t for t in rows if t.get("symbol", "").endswith("-USDT")
                       and float(t.get("volValue") or 0) > 3e5
                       and float(t.get("changeRate") or 0) <= -0.08),
                      key=lambda x: float(x["changeRate"]))
    for t in bleeders[:25]:
        syms.setdefault(t["symbol"], float(t["last"] or 0))


async def fetch_candles(sess, sym, tf, limit=None):
    d = await get(sess, f"/api/v1/market/candles?type={tf}&symbol={sym}")
    rows = ((d or {}).get("data") or [])[::-1]
    return rows[-limit:] if limit else rows


def to_candles(rows):
    from .indicators import Candle
    return [Candle(ts=int(r[0]) * 1000, open=float(r[1]), close=float(r[2]),
                   high=float(r[3]), low=float(r[4]), volume=float(r[5]))
            for r in rows]


async def fetch_ticks(sess, sym):
    d = await get(sess, f"/api/v1/market/histories?symbol={sym}")
    out = []
    for r in (d or {}).get("data") or []:
        if isinstance(r, dict):
            out.append((int(r["time"]) // 1_000_000, float(r["price"]),
                        float(r["size"]), r["side"]))
    return out


async def fetch_book(sess, sym):
    d = await get(sess, f"/api/v1/market/orderbook/level2_20?symbol={sym}")
    dd = (d or {}).get("data") or {}
    cv = lambda lv: [[float(p), float(s)] for p, s in (lv or [])]
    return cv(dd.get("bids")), cv(dd.get("asks"))


async def open_long(sym, px, stop):
    qty = SIZE_Q / px
    live = False
    if LIVE_LONG and kp is not None:
        try:
            bals = await kp.accounts("USDT")
            spend = round(max(0.0, float(bals[0]["available"]) - 1.0)
                          * 0.9, 2)               # 90% of free cash
            if spend < 1.0:
                print(f"live buy skip {sym}: no cash ${bals[0]['available']}",
                      flush=True)
                return None
            await kp.market_order(sym, "buy", funds=spend)
            bals = await kp.accounts(sym.split("-")[0])
            qty = float((bals[0] if bals else {}).get("available") or qty)
            live = True
        except Exception as ex:
            print(f"live buy fail {sym}: {str(ex)[:80]}", flush=True)
            return None
    positions[sym] = {"sym": sym, "side": "long", "entry": px,
                      "ts": time.time(), "qty": qty, "stop": stop,
                      "rung": -1, "live": live}
    return positions[sym]


_meta_cache = {"ts": 0.0, "syms": {}}


async def sym_meta(sess):
    """KuCoin /api/v2/symbols: marginability + size increments, 5min cache."""
    if _meta_cache["syms"] and time.time() - _meta_cache["ts"] < 300:
        return _meta_cache["syms"]
    d = await get(sess, "/api/v2/symbols")
    _meta_cache["syms"] = {s["symbol"]: s for s in (d or {}).get("data", [])}
    _meta_cache["ts"] = time.time()
    return _meta_cache["syms"]


async def open_short(sym, px, stop, meta=None):
    # KuCoin cross margin: sell + autoBorrow borrows & sells in one order.
    qty = SIZE_Q / px
    live = False
    if LIVE_SHORT and kp_margin is not None:
        inc = float((meta or {}).get("baseIncrement") or 0) or 1e-8
        minsize = float((meta or {}).get("baseMinSize") or 0)
        qty = int(qty / inc) * inc                    # pair's size increment
        if qty <= 0 or qty < max(minsize, inc):
            print(f"short skip {sym}: qty {qty} below min "
                  f"{max(minsize, inc)}", flush=True)
            return None
        if qty * px > 20.0:   # $25 collateral @2x -> keep borrow small
            print(f"short skip {sym}: ${qty*px:.0f} > $20 margin cap",
                  flush=True)
            return None
        try:
            await kp_margin._req(
                "POST", "/api/v3/hf/margin/order",
                body={"clientOid": __import__("uuid").uuid4().hex,
                      "side": "sell", "symbol": sym, "type": "market",
                      "size": f"{qty:.8f}", "marginModel": "cross",
                      "autoBorrow": True})
            live = True
            print(f"LIVE SHORT opened {sym} qty {qty:.4f}", flush=True)
        except Exception as ex:
            print(f"live short fail {sym}: {str(ex)[:80]}", flush=True)
            return None
    positions[sym] = {"sym": sym, "side": "short", "entry": px,
                      "ts": time.time(), "qty": qty, "stop": stop,
                      "rung": -1, "live": live}
    return positions[sym]


async def close_trade(sym, p, px, why):
    if p.get("live") and p["side"] == "short" and kp_margin is not None:
        try:
            await kp_margin._req(
                "POST", "/api/v3/hf/margin/order",
                body={"clientOid": __import__("uuid").uuid4().hex,
                      "side": "buy", "symbol": sym, "type": "market",
                      "size": f"{p['qty']:.8f}", "marginModel": "cross",
                      "autoRepay": True})
        except Exception as ex:
            print(f"live cover fail {sym}: {str(ex)[:80]}", flush=True)
            return          # keep position; retry next manage tick
    elif p.get("live") and kp is not None:
        try:
            await kp.market_order(sym, "sell", size=p["qty"])
        except Exception as ex:
            print(f"live sell fail {sym}: {str(ex)[:80]}", flush=True)
            return          # keep position; retry next manage tick
    global realized, trades_today, day_realized, panic_until, day_fees
    side = p["side"]
    qty = p["qty"]
    gross = ((px - p["entry"]) if side == "long" else (p["entry"] - px)) * qty
    fees = (p["entry"] + px) * qty * FEE
    net = gross - fees
    # drop the ledger FIRST: history write is best-effort and a failed
    # close must never retry into dupes (the ELSA bug)
    del positions[sym]
    closed_at[sym] = time.time()
    if net < 0:
        close_times.append(time.time())
    realized += net
    day_realized += net
    day_fees += fees
    if len([t for t in close_times
            if time.time() - t < PANIC_WIN]) >= PANIC_CLOSES:
        panic_until = time.time() + 3600
        print(f"LONGSHORT PANIC HALT: {PANIC_CLOSES} losing closes/"
              f"{PANIC_WIN}s - entries frozen 1h", flush=True)
    try:
        conn = db()
        try:
            conn.execute(
                "INSERT INTO trades (symbol,side,entry_ts,exit_ts,qty,"
                "entry_price,exit_price,gross_pnl,fees,net_pnl,exit_reason,"
                "mode,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (sym, "long" if side == "long" else "short", p["ts"],
                 time.time(), qty, p["entry"], px, gross, fees, net, why,
                 "live" if p.get("live") else "paper",
                 json.dumps({"bot": "longshort", "signal": [side],
                             "rung": p["rung"]})))
            conn.commit()
        finally:
            conn.close()
    except Exception as ex:
        print(f"trade record fail {sym}: {str(ex)[:80]}", flush=True)
    print(f"CLOSE {side} {sym} @ {px} net {net:+.3f} ({why})", flush=True)


async def still_working(sess, sym, p):
    """A flat trade isn't dead if the coin still moves its way:
    shorts stay alive while price keeps falling, longs while rising."""
    try:
        r = await fetch_candles(sess, sym, "1min", 8)
        if len(r) < 5:
            return False
        cl = [float(x[2]) for x in r]
        px = syms.get(sym) or cl[-1]
        if p["side"] == "short":
            return px < p["entry"] and cl[-1] <= cl[-4]
        return px > p["entry"] and cl[-1] >= cl[-4]
    except Exception:
        return False


_mng_busy = False


async def manage(sess):
    global _mng_busy
    if _mng_busy:
        return
    _mng_busy = True
    try:
        await _manage_body(sess)
    finally:
        _mng_busy = False


async def _manage_body(sess):
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
                # stops only tighten toward profit
                if (side == "long" and lvl > p["stop"]) or \
                        (side == "short" and lvl < p["stop"]):
                    p["stop"], p["rung"] = lvl, i
        held = (time.time() - p["ts"]) / 60
        why = None
        if side == "long" and px <= p["stop"]:
            why = "trailing_stop" if p["rung"] >= 0 else "stop_loss"
        elif side == "short" and px >= p["stop"]:
            why = "trailing_stop" if p["rung"] >= 0 else "stop_loss"
        elif held > MAX_HOLD_MIN and (
                (p["side"] == "long" and p["stop"] < p["entry"]) or
                (p["side"] == "short" and p["stop"] > p["entry"])):
            why = "max_hold"        # still at risk; locked runs ride free
        elif held > 10 and gain < 0.2 \
                and not await still_working(sess, sym, p):
            why = "time_exit"
        if why:
            await close_trade(sym, p, px, why)
    save_all()


def prefill(sym, o, c, h, l, v):
    return {"symbol": sym, "blocked": "—"}


async def fast_tick(sess):
    """~1.2s price refresh on held positions so stops see wicks the
    6s scan loop would miss."""
    while True:
        try:
            for sym in list(positions):
                d = await get(sess, "/api/v1/market/orderbook/level1"
                                    f"?symbol={sym}")
                px = float(((d or {}).get("data") or {})
                           .get("price") or 0)
                if px:
                    syms[sym] = px
            if positions:
                await manage(sess)
        except Exception:
            pass
        await asyncio.sleep(1.2)


async def scan(sess, claude):
    global long_cands, short_cands, btc1h, trades_today, day, kp, kp_margin
    global day_realized, panic_until, day_fees
    if LIVE_LONG and kp is None:
        kp = KucoinPrivateREST(BASE_URL,
                               os.environ.get("KUCOIN_API_KEY", ""),
                               os.environ.get("KUCOIN_API_SECRET", ""),
                               os.environ.get("KUCOIN_API_PASSPHRASE", ""), sess)
        print("LIVE_LONG armed: real spot orders on longs", flush=True)
    if LIVE_SHORT and kp_margin is None:
        kp_margin = KucoinPrivateREST(
            BASE_URL, os.environ.get("KUCOIN_API_KEY2", ""),
            os.environ.get("KUCOIN_API_SECRET2", ""),
            os.environ.get("KUCOIN_API_PASSPHRASE2", ""), sess)
        print("LIVE_SHORT armed: real cross-margin shorts", flush=True)
    today = time.strftime("%Y-%m-%d", time.gmtime())
    if today != day:
        day, trades_today, day_realized, day_fees = today, 0, 0.0, 0.0
        panic_until = 0.0
        try:
            conn = db()
            r = conn.execute(
                "SELECT COALESCE(SUM(net_pnl),0), COUNT(*),"
                " COALESCE(SUM(fees),0) FROM trades"
                " WHERE meta LIKE '%longshort%' AND exit_ts >= ?",
                (time.time() - time.time() % 86400,)).fetchone()
            day_realized, trades_today, day_fees = \
                float(r[0]), int(r[1]), float(r[2])
            conn.close()
        except Exception:
            pass
    b = await fetch_candles(sess, "BTC-USDT", "15min", 24)
    if len(b) >= 18:
        btc1h = (float(b[-2][2]) / float(b[-18][2]) - 1) * 100  # ~4h window
    from .market_data import SymbolState
    now_ms = int(time.time() * 1000)
    lc, sc = [], []
    any_long = any(p["side"] == "long" for p in positions.values())
    any_short = any(p["side"] == "short" for p in positions.values())
    mmeta = await sym_meta(sess)
    for sym, px in syms.items():
        if sym in positions or not px:
            continue
        r1 = await fetch_candles(sess, sym, "15min", 100)
        await asyncio.sleep(.08)
        if len(r1) < 80:
            continue
        closes = [float(r[2]) for r in r1]
        mean = sum(closes[-90:]) / 90
        p = getattr(claude, "p", None) or {}
        trs = [max(float(r1[k][3]) - float(r1[k][4]),
                   abs(float(r1[k][3]) - float(r1[k - 1][2])),
                   abs(float(r1[k][4]) - float(r1[k - 1][2])))
               for k in range(len(r1) - 14, len(r1))]
        atr = sum(trs) / len(trs) or px * 0.01
        need_atr = p.get("mr_stretch_atr", 3.0)
        mbn = int(p.get("mr_bars", 3))
        stretch_atr = (px - mean) / atr          # + above mean, - below
        stretch = (px / mean - 1) * 100
        # ---------- SHORTS: TREND engine (validated +net on 60 pairs) ----
        # serial bleeder: -15% over ~22h + below mean + fresh break low ->
        # short the continuation; stop above swing high; reverse ladder.
        last5 = [[float(x[1]), float(x[2]), float(x[5])] for x in r1[-6:-1]]
        prior_v = [float(x[5]) for x in r1[-66:-6]]
        avgv = sum(prior_v) / len(prior_v) or 1
        v5 = sum(x[2] for x in last5) / 5
        chg22 = (closes[-1] / closes[0] - 1) * 100 if len(closes) >= 88 else 0
        chg6 = (closes[-1] / closes[-25] - 1) * 100 if len(closes) >= 25 else 0
        falling = closes[-1] < closes[-25]
        below = px < mean - 1.0 * atr
        low_now = px < min(float(x[4]) for x in r1[-9:-1])
        # downtrend continuation: -2.5%/6h slide or -15%/22h bleeder
        # peak-rejection ONLY: stretched above mean, turning down off the
        # high - the mirror of the longs' trough entries. Never short a
        # fresh low (that's selling the bottom of a dump).
        peak = max(float(x[3]) for x in r1[-9:])
        # real reversal, not a pullback: last completed bar red AND the
        # live tick breaks below that bar's low (a rejection break)
        turn_dn = (float(r1[-1][2]) < float(r1[-1][1])
                   and px < float(r1[-1][4]))
        peak_short = stretch_atr >= 2.5 and turn_dn
        shortable = peak_short
        stages = int(shortable) + int(peak_short) + int(low_now)
        row = {"symbol": sym, "px": px, "stretch": round(stretch, 2),
               "vr": round(v5 / avgv, 1), "move5": round(chg22, 1),
               "score": f"{stages}/3"}
        sreason = ""
        if not enabled_short:
            sreason = "bot OFF"
        elif panic_until > time.time():
            sreason = f"PANIC {int((panic_until-time.time())/3600)}h"
        elif day_realized <= DAY_LOSS_CAP:
            sreason = "daily loss cap"
        elif trades_today >= MAX_TRADES_DAY:
            sreason = "max trades/day"
        elif closed_at.get(sym, 0) + COOLDOWN_SEC > time.time():
            sreason = f"cooldown {int((closed_at[sym]+COOLDOWN_SEC-time.time())/60)}m"
        elif any_short:
            sreason = "max 1 short"
        elif shortable and not (mmeta.get(sym) or {}).get(
                "isMarginEnabled"):
            sreason = "not marginable"
        elif btc1h is not None and btc1h > BTC_GATE:
            sreason = f"BTC too strong {btc1h:+.2f}%"
        elif not shortable:
            sreason = (f"no setup str{stretch_atr:+.1f} "
                       f"6h{chg6:+.1f}% 22h{chg22:+.1f}%")
        if sreason:
            row["blocked"] = sreason
        else:
            hi = max(float(x[3]) for x in r1[-8:])
            sd = min(max((hi - px) / px * 100 + 0.15,
                     float(p.get("min_stop", 0.9))),
                     float(p.get("max_stop", 2.4)))
            if await open_short(sym, px, px * (1 + sd / 100),
                                mmeta.get(sym)):
                trades_today += 1
                print(f"SHORT {sym} @ {px} chg22 {chg22:.1f}% stop {sd:.2f}%",
                      flush=True)
                row["blocked"] = "ENTERED"
            else:
                row["blocked"] = "live short failed"
        sc.append(row)
        # ---------- LONGS: the real ClaudeStrategy ----------
        fall_mb = (float(r1[-(mbn + 1)][1]) - last5[-1][1]) / atr
        turn_up = px > float(r1[-1][1]) and px > float(r1[-1][2])
        climax = v5 >= avgv * float(p.get("mr_vol_mult", 1.5))
        lstages = int(-stretch_atr >= need_atr) + int(climax and fall_mb >= 1.0) + int(turn_up)
        lrow = {"symbol": sym, "px": px, "stretch": round(stretch, 2),
                "vr": round(v5 / avgv, 1), "move5": round(-fall_mb, 1),
                "score": f"{lstages}/3"}
        lreason = ""
        if not enabled_long:
            lreason = "bot OFF"
        elif panic_until > time.time():
            lreason = f"PANIC {int((panic_until-time.time())/3600)}h"
        elif day_realized <= DAY_LOSS_CAP:
            lreason = "daily loss cap"
        elif trades_today >= MAX_TRADES_DAY:
            lreason = "max trades/day"
        elif closed_at.get(sym, 0) + COOLDOWN_SEC > time.time():
            lreason = f"cooldown {int((closed_at[sym]+COOLDOWN_SEC-time.time())/60)}m"
        elif any_long:
            lreason = "max 1 long"
        elif claude is None:
            lreason = "claude init failed"
        if not lreason and -stretch_atr < need_atr:   # same ATR gate as shorts
            lreason = f"stretch {stretch_atr:.1f}ATR > -{need_atr}"
        if lreason:
            lrow["blocked"] = lreason
            lc.append(lrow)
            continue
        try:
            htf = await fetch_candles(sess, sym, "1hour", 60)
            ticks = await fetch_ticks(sess, sym)
            bids, asks = await fetch_book(sess, sym)
            await asyncio.sleep(.08)
            st = SymbolState(sym)
            st.candles = deque(to_candles(r1), maxlen=400)
            st.macro_candles = deque(to_candles(htf), maxlen=400)
            st.trades = deque(ticks, maxlen=500)
            st.bids, st.asks = bids, asks
            st.last_price = px
            sig, why, info = claude.evaluate(st, FEE * 100, SIZE_Q,
                                             now_ms, st.macro_candles)
            lrow["info"] = {k: info.get(k) for k in
                            ("score", "stop_pct", "vr") if k in info}
            if sig:
                if await open_long(sym, px,
                                   sig.stop_price or px * 0.985):
                    trades_today += 1
                    print(f"LONG {sym} @ {px} ({sig.reasons})", flush=True)
                    lrow["blocked"] = "ENTERED"
                else:
                    lrow["blocked"] = "live buy failed"
            else:
                lrow["blocked"] = why or "no signal"
        except Exception as e:
            lrow["blocked"] = f"eval err {str(e)[:40]}"
        # ------ LONGS: mirrored TREND engine (serial pumper) ------------
        # +15%/22h + above rising mean + fresh break HIGH -> long the leg
        hi_now = px > max(float(x[3]) for x in r1[-9:-1])
        tl = int(chg22 >= 15.0) + int(closes[-1] > closes[-25]
                                      and px > mean + 1.0 * atr) + int(hi_now)
        lrow["score"] = f"{lstages}/3|t{tl}/3"
        if (enabled_long and not any_long
                and panic_until <= time.time()
                and day_realized > DAY_LOSS_CAP
                and trades_today < MAX_TRADES_DAY
                and closed_at.get(sym, 0) + COOLDOWN_SEC <= time.time()
                and tl == 3 and lrow.get("blocked") != "ENTERED"):
            lo = min(float(x[4]) for x in r1[-8:])
            sd = min(max((px - lo) / px * 100 + 0.15,
                     float(p.get("min_stop", 0.9))),
                     float(p.get("max_stop", 2.4)))
            if await open_long(sym, px, px * (1 - sd / 100)):
                trades_today += 1
                print(f"LONG-TREND {sym} @ {px} chg22 {chg22:+.1f}%",
                      flush=True)
                lrow["blocked"] = "ENTERED(trend)"
            else:
                lrow["blocked"] = "live buy failed"
        lc.append(lrow)
    lc.sort(key=lambda r: str(r.get("blocked", "")))
    sc.sort(key=lambda r: -r.get("stretch", 0))
    long_cands, short_cands = lc[:40], sc[:40]


async def state(_req):
    open_p = [{"symbol": s, "side": p["side"], "entry": p["entry"],
               "px": syms.get(s), "stop": p["stop"], "rung": p["rung"],
               "qty": p["qty"], "last": syms.get(s) or p["entry"],
               "path": p["side"],
               "take": 0,
               "upnl_pct": ((syms.get(s) or p["entry"]) / p["entry"] - 1)
               * 100 * (1 if p["side"] == "long" else -1),
               "held_s": time.time() - p["ts"],
               "unreal": ((syms.get(s) or p["entry"]) - p["entry"])
               * p["qty"] * (1 if p["side"] == "long" else -1),
               "age_min": (time.time() - p["ts"]) / 60}
              for s, p in positions.items()]
    return web.json_response({
        "bot_id": "short",
        "mode": ("live" if LIVE_LONG and LIVE_SHORT else
                 "live-longs" if LIVE_LONG else
                 "live-shorts" if LIVE_SHORT else "paper"),
        "halted": False,
        "status": ("scanning" if (enabled_long or enabled_short)
                   else "entries OFF (managing only)"),
        "paths": {"long": enabled_long, "short": enabled_short},
        "allocation_pct": 0,
        "equity": 50.0 + realized, "real_total": 50.0 + realized,
        "avail": 50.0 + realized, "positions": open_p,
        "open_positions": open_p,
        "unrealized": sum(p["unreal"] for p in open_p),
        "day_realized": day_realized, "trades_today": trades_today,
        "fees_today": round(day_fees, 4),
        "realized": realized, "btc_1h": btc1h, "gate": BTC_GATE,
        "long_candidates": long_cands, "short_candidates": short_cands,
        "candidates": short_cands, "errors": [], "watched": len(syms)})


async def path_toggle(req):
    global enabled_long, enabled_short
    try:
        d = await req.json()
    except Exception:
        d = {}
    p = d.get("path")
    if p == "long":
        enabled_long = bool(d.get("on"))
    elif p == "short":
        enabled_short = bool(d.get("on"))
    if p in ("long", "short"):
        save_all()
        print(f"longshort {p}={d.get('on')}", flush=True)
    return web.json_response(
        {"ok": True, "long": enabled_long, "short": enabled_short})


async def main():
    load_all()
    con = db()
    con.execute("""CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY
        AUTOINCREMENT, symbol TEXT, side TEXT, entry_ts REAL, exit_ts REAL,
        qty REAL, entry_price REAL, exit_price REAL, gross_pnl REAL,
        fees REAL, net_pnl REAL, exit_reason TEXT, mode TEXT, meta TEXT)""")
    con.commit()
    claude = None
    try:
        from .claude_bot import ClaudeStrategy
        from .config import load_config
        claude = ClaudeStrategy(load_config("config-claude15.yaml"))
        print("longs: real ClaudeStrategy(15m) armed", flush=True)
    except Exception as e:
        print("claude init failed:", e, flush=True)
    app = web.Application()
    app.router.add_get("/api/state", state)
    app.router.add_post("/api/path", path_toggle)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    print(f"long-shorts paper up :{PORT}", flush=True)
    async with aiohttp.ClientSession() as sess:
        asyncio.create_task(fast_tick(sess))
        while True:
            try:
                await universe(sess)
                await scan(sess, claude)
                await manage(sess)
            except Exception as e:
                print("loop err", e, flush=True)
            await asyncio.sleep(6)


if __name__ == "__main__":
    asyncio.run(main())
