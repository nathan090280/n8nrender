"""Grokky — range/wedge trader. LONG on spot trade acct, SHORT cross margin.

Recent peak-trough structure (5m bars, ~75min lookback): longs in the
lower 25% of the range, shorts in the upper 25%, RSI(7) + two confirmed
1m candles back inside the structure, stops just beyond the structure,
ladder trails, all fleet armor inside.
Longs spend real spot USDT only — no borrowing, no leverage.
"""
import asyncio, json, os, time, sqlite3, aiohttp
from aiohttp import web
from .kucoin_private import KucoinPrivateREST
from .storage import Storage

BASE = "https://api.kucoin.com"
DB = os.environ.get("DB_PATH", "/app/state/scalperbot.db")
POSF = os.environ.get("POS_PATH", "/app/state/grokky_positions.json")
PORT = int(os.environ.get("PORT", 8384))
FEE = float(os.environ.get("FEE_PCT", 0.1)) / 100
POT_USE = 0.9            # 90% of available account equity — no other cap
PAPER_POT = 20.0         # pretend balance for paper mode
TOP_N = int(os.environ.get("TOP_N", 30))
# structure
LOOKBACK = 16            # 5m bars ≈ 80min
PIVOT_PCT = 0.0012       # neighbor diff for a pivot
RANGE_MIN, RANGE_MAX = 1.00, 3.2
EDGE_BUF = 0.0018        # ≥0.18% off the extreme
LOWER_ZONE, UPPER_ZONE = 0.25, 0.75
WIDE_MIN = 1.3           # sub-floor/sub-ceil dips only on ranges this wide
RSI_LEN = 7
RSI_LONG, RSI_SHORT = 32, 68
VOL_CAP = 2.8            # last bars vol < 2.8× avg20
# risk
STOP_MIN, STOP_MAX = 0.28, 0.45
LADDER = [(0.55, 0.08), (1.0, 0.45), (1.8, 0.9), (3.0, 1.8),
          (5.0, 3.4), (8.0, 6.5)]
TIME_EXIT_MIN = 10       # red/scratch cuts; locked-BE rides free
MIN_RR = 1.6             # expected move ≥1.6× stop distance
# fleet armor
COOLDOWN_SEC = 3600
PANIC_CLOSES, PANIC_WIN = 3, 600
DYING_BARS, DYING_DROP = 49, 0.96   # >4% down over ~4h: floors are stairs
MAX_SYM_LOSS = 2                  # 2 red closes on a coin -> done for the day
DAY_LOSS_CAP = float(os.environ.get("DAY_LOSS_CAP", -2.60))
MAX_TRADES_DAY = int(os.environ.get("MAX_TRADES_DAY", 50))

kp = None
store = None
syms, positions, closed_at = {}, {}, {}
close_times = []
sym_loss = {}                    # sym -> red closes today
panic_until = 0.0
enabled_long, enabled_short = True, True
realized, day_realized, trades_today, day = 0.0, 0.0, 0, ""
day_fees = 0.0
_cands = {"long": [], "short": [], "info": {}}


def db():
    return sqlite3.connect(DB, timeout=30)


def save_all():
    json.dump(positions, open(POSF, "w"))
    json.dump({"realized": realized, "el": enabled_long, "es": enabled_short},
              open(POSF.replace("positions", "state"), "w"))


def load_all():
    global positions, realized, enabled_long, enabled_short
    try:
        positions = json.load(open(POSF))
    except Exception:
        positions = {}
    try:
        st = json.load(open(POSF.replace("positions", "state")))
        realized = st.get("realized", 0.0)
        enabled_long = st.get("el", True)
        enabled_short = st.get("es", True)
    except Exception:
        pass


async def get(sess, path):
    async with sess.get(BASE + path) as r:
        return await r.json()


def rsi(closes, n=RSI_LEN):
    if len(closes) < n + 1:
        return 50.0
    d = [closes[i + 1] - closes[i] for i in range(-n - 1, -1)]
    up = sum(x for x in d if x > 0) / n
    dn = -sum(x for x in d if x < 0) / n
    return 100 - 100 / (1 + up / dn) if dn else 100.0


def detect_structure(bars):
    """Most recent valid peak+trough on 5m bars. bars: (o,c,h,l,v) tuples."""
    if len(bars) < LOOKBACK + 5:
        return None
    w = bars[-(LOOKBACK + 2):]
    peaks, troughs = [], []
    for i in range(1, len(w) - 1):
        h, l = w[i][2], w[i][3]
        if h > w[i-1][2] * (1 + PIVOT_PCT) and h >= w[i+1][2] * (1 + PIVOT_PCT):
            peaks.append((i, h))
        if l < w[i-1][3] * (1 - PIVOT_PCT) and l <= w[i+1][3] * (1 - PIVOT_PCT):
            troughs.append((i, l))
    if not peaks or not troughs:
        return None
    pk_i, pk = peaks[-1]
    tr_i, tr = troughs[-1]
    hi, lo = max(pk, tr), min(pk, tr)
    mid = (hi + lo) / 2
    rng = (hi - lo) / mid * 100
    if not RANGE_MIN <= rng <= RANGE_MAX:
        return None
    # broken structure: closed >0.35% outside either extreme
    last = w[-1][1]
    if last > hi * 1.0035 or last < lo * 0.9965:
        return None
    vols = [b[4] for b in bars[-22:]]
    v3 = sum(vols[-3:]) / 3
    v20 = sum(vols[:-3]) / max(1, len(vols[:-3]))
    if v20 > 0 and v3 > VOL_CAP * v20:
        return None                          # breakout expansion, skip
    return {"floor": lo, "ceil": hi, "rng": rng,
            "kind": "wedge" if pk_i < tr_i else "range"}


async def close_pos(sym, p, px, why):
    """Cover/sell, drop ledger FIRST, best-effort history."""
    if p.get("live") and p["side"] == "short" and kp is not None:
        try:
            await kp._req("POST", "/api/v3/hf/margin/order",
                          body={"clientOid": __import__("uuid").uuid4().hex,
                                "side": "buy", "symbol": sym, "type": "market",
                                "size": f"{p['qty']:.8f}",
                                "marginModel": "cross", "autoRepay": True})
        except Exception as ex:
            print(f"grokky cover fail {sym}: {str(ex)[:80]}", flush=True)
            return
    elif p.get("live") and p["side"] == "long" and kp is not None:
        try:
            # sell what's really there: fees shaved the received qty.
            # acct = where this long lives: "spot" trade acct or margin.
            base = sym.split("-")[0]
            if p.get("acct", "margin") == "spot":
                accs = await kp.accounts(base)
                avail = float(accs[0]["available"]) if accs else 0.0
                sell_qty = min(p["qty"], avail)
                if sell_qty <= 0:
                    print(f"grokky {sym}: no spot bal, external close",
                          flush=True)
                    p["live"] = False
                else:
                    await kp._req(
                        "POST", "/api/v1/orders",
                        body={"clientOid": __import__("uuid").uuid4().hex,
                              "side": "sell", "symbol": sym,
                              "type": "market",
                              "size": f"{sell_qty:.8f}"})
            else:
                d = await kp._req("GET", "/api/v3/margin/accounts",
                                  params={"quoteCurrency": "USDT"})
                acct = {a["currency"]: a
                        for a in (d.get("accounts") or [])}
                avail = float((acct.get(base) or {})
                              .get("available") or 0)
                sell_qty = min(p["qty"], avail)
                if sell_qty <= 0:
                    print(f"grokky {sym}: nothing to sell, external close",
                          flush=True)
                    p["live"] = False
                else:
                    await kp._req(
                        "POST", "/api/v3/hf/margin/order",
                        body={"clientOid": __import__("uuid").uuid4().hex,
                              "side": "sell", "symbol": sym, "type": "market",
                              "size": f"{sell_qty:.8f}",
                              "marginModel": "cross"})
        except Exception as ex:
            print(f"grokky sell fail {sym}: {str(ex)[:80]}", flush=True)
            return
    global realized, day_realized, trades_today, panic_until, day_fees
    qty = p["qty"]
    gross = ((px - p["entry"]) if p["side"] == "long"
             else (p["entry"] - px)) * qty
    # real fees where we can read them: entry fill recorded at open,
    # exit fill read now; fallback is the symbol's true rate, not 0.1%
    rate = (p.get("frate") or 0.1) / 100
    xf = None
    if p.get("live") and kp is not None:
        xf = await fill_fee_usdt(
            sym, "sell" if p["side"] == "long" else "buy", p)
    ef = p.get("entry_fee")
    fees = ((ef if ef is not None else p["entry"] * qty * rate)
            + (xf if xf is not None else px * qty * rate))
    net = gross - fees
    day_fees += fees
    del positions[sym]
    closed_at[sym] = time.time()
    if net < 0:
        close_times.append(time.time())
        sym_loss[sym] = sym_loss.get(sym, 0) + 1
    realized += net
    day_realized += net
    if len([t for t in close_times if time.time() - t < PANIC_WIN]) \
            >= PANIC_CLOSES:
        panic_until = time.time() + 3600
        print(f"GROKKY PANIC HALT: {PANIC_CLOSES} losing closes; "
              "entries frozen 1h", flush=True)
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
                 json.dumps({"bot": "grokky",
                             "signal": [f"Grokky-{p['side'].title()}"],
                             "acct": p.get("acct", "margin"),
                             "structure": p.get("kind"),
                             "floor": p.get("floor"),
                             "ceil": p.get("ceil")})))
            conn.commit()
        finally:
            conn.close()
    except Exception as ex:
        print(f"grokky record fail {sym}: {str(ex)[:60]}", flush=True)
    if store:
        try:
            store.release_symbol(sym, "grokky")
        except Exception:
            pass
    print(f"GROKKY CLOSE {p['side']} {sym} @ {px} net {net:+.3f} ({why})",
          flush=True)


async def open_pos(sym, side, px, stop, S, meta):
    """Long = spot trade-acct buy (cash only); short = cross-margin
    autoBorrow sell."""
    qty, acct, entry_fee = None, "margin", None
    if kp is not None:
        inc = float(meta.get("inc") or 1e-8)
        try:
            if side == "long":
                # cash only: spend up to 90% of FREE spot USDT, so a
                # second/third long sizes off what is actually left —
                # impossible to exceed 1x
                spot = float(meta.get("spot_usdt") or 0)
                spend = round(spot * POT_USE, 2)
                if spend < 1.0:
                    print(f"grokky skip {sym}: no spot ${spot:.2f}",
                          flush=True)
                    return None
                qty = int(spend / px / inc) * inc
                if qty <= 0:
                    print(f"grokky skip {sym}: qty 0 @ inc {inc}",
                          flush=True)
                    return None
                await kp._req(
                    "POST", "/api/v1/orders",
                    body={"clientOid": __import__("uuid").uuid4().hex,
                          "side": "buy", "symbol": sym, "type": "market",
                          "funds": f"{qty*px:.2f}"})
                acct = "spot"
                # record the real received qty (fees shave it)
                accs = await kp.accounts(sym.split("-")[0])
                qty = float(accs[0]["balance"]) if accs else qty
                # and the REAL fee paid — never the 0.1% estimate
                entry_fee = await fill_fee_usdt(
                    sym, "buy", {"ts": time.time(), "entry": px})
            else:
                eq = float(meta.get("margin_eq") or 0)
                spend = round(eq * POT_USE, 2)
                if spend < 1.0:
                    print(f"grokky skip {sym}: no margin ${eq:.2f}",
                          flush=True)
                    return None
                qty = int(spend / px / inc) * inc
                if qty <= 0:
                    print(f"grokky skip {sym}: qty 0 @ inc {inc}",
                          flush=True)
                    return None
                await kp._req(
                    "POST", "/api/v3/hf/margin/order",
                    body={"clientOid": __import__("uuid").uuid4().hex,
                          "side": "sell", "symbol": sym, "type": "market",
                          "size": f"{qty:.8f}", "marginModel": "cross",
                          "autoBorrow": True})
                r = _fee_rate.get(sym) or await taker_rate(None, sym) or 0.1
                entry_fee = qty * px * r / 100
        except Exception as ex:
            print(f"grokky open fail {side} {sym}: {str(ex)[:80]}",
                  flush=True)
            return None
    else:
        qty = (PAPER_POT * POT_USE) / px
        acct = "spot" if side == "long" else "margin"
    positions[sym] = {"sym": sym, "side": side, "entry": px,
                      "ts": time.time(), "qty": qty, "stop": stop,
                      "rung": -1, "live": kp is not None, "acct": acct,
                      "entry_fee": entry_fee,
                      "frate": _fee_rate.get(sym) or 0.1,
                      "floor": S["floor"], "ceil": S["ceil"],
                      "brk": (S["floor"] * (0.9965 if px >= S["floor"]
                                          * 0.998 else 0.985)
                              if side == "long" else
                              S["ceil"] * (1.0035 if px <= S["ceil"]
                                           * 1.002 else 1.015)),
                      "kind": S["kind"]}
    return positions[sym]


async def fetch_bars(sess, sym):
    d = await get(sess, f"/api/v1/market/candles?type=5min&symbol={sym}")
    rows = (d or {}).get("data") or []
    return [(float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5]))
            for c in sorted(rows, key=lambda x: int(x[0]))]


async def confirm_entry(sess, sym, lvl, side):
    """2 completed 1m bars confirm the turn: both green AND closing above
    the floor for longs; both red AND closing below the ceil for shorts.
    No confirmation, no entry — this is what skips knives like a dip
    that keeps falling through the floor."""
    try:
        now = int(time.time())
        d = await get(sess, f"/api/v1/market/candles?type=1min"
                            f"&symbol={sym}&startAt={now - 600}&endAt={now}")
        rows = sorted((d or {}).get("data") or [], key=lambda x: int(x[0]))
        done = [c for c in rows if int(c[0]) < now // 60 * 60]
        if len(done) < 2:
            return False
        b1, b2 = done[-2], done[-1]          # KuCoin: [t,o,c,h,l,v,tv]
        o1, c1, o2, c2 = (float(b1[1]), float(b1[2]),
                          float(b2[1]), float(b2[2]))
        if side == "long":
            return c1 > o1 and c2 > o2 and min(c1, c2) > lvl
        return c1 < o1 and c2 < o2 and max(c1, c2) < lvl
    except Exception:
        return False


KCS_LOW, KCS_TOPUP = 1.50, 0.50  # keep ~$2 KCS per acct for the fee rebate
_kcs_checked = 0.0


async def kcs_topup(sess):
    """Refill KCS fee balances: <$1.50 -> market-buy $0.50. Margin acct
    gets a spot buy + inner transfer (KCS-USDT isn't marginable)."""
    global _kcs_checked
    if kp is None or time.time() - _kcs_checked < 900:
        return
    _kcs_checked = time.time()
    try:
        t = await get(sess, "/api/v1/market/orderbook/level1"
                            "?symbol=KCS-USDT")
        px = float((t or {}).get("data", {}).get("price") or 0)
        if px <= 0:
            return
        accs = await kp.accounts("KCS")
        if not accs or float(accs[0].get("balance") or 0) * px < KCS_LOW:
            await kp._req("POST", "/api/v1/orders",
                          body={"clientOid": __import__("uuid").uuid4().hex,
                                "side": "buy", "symbol": "KCS-USDT",
                                "type": "market",
                                "funds": f"{KCS_TOPUP:.2f}"})
            print("grokky KCS topup: trade acct +$0.50", flush=True)
        d = await kp._req("GET", "/api/v3/margin/accounts",
                          params={"quoteCurrency": "USDT"})
        acct = {a["currency"]: a for a in (d.get("accounts") or [])}
        mkcs = float((acct.get("KCS") or {}).get("total") or 0)
        if mkcs * px < KCS_LOW:
            await kp._req("POST", "/api/v1/orders",
                          body={"clientOid": __import__("uuid").uuid4().hex,
                                "side": "buy", "symbol": "KCS-USDT",
                                "type": "market",
                                "funds": f"{KCS_TOPUP:.2f}"})
            await asyncio.sleep(1)
            accs = await kp.accounts("KCS")
            avail = float(accs[0].get("available") or 0) if accs else 0
            amt = min(avail, KCS_TOPUP / px * 0.95)
            if amt > 0:
                await kp._req("POST", "/api/v2/accounts/inner-transfer",
                              body={"clientOid": __import__("uuid").uuid4().hex,
                                    "currency": "KCS", "from": "trade",
                                    "to": "margin",
                                    "amount": f"{amt:.4f}"})
                print(f"grokky KCS topup: margin +{amt:.4f} KCS",
                      flush=True)
    except Exception as ex:
        print(f"grokky KCS topup fail: {str(ex)[:80]}", flush=True)


_meta = {"ts": 0.0, "syms": {}}


async def sym_meta(sess):
    if _meta["syms"] and time.time() - _meta["ts"] < 300:
        return _meta["syms"]
    d = await get(sess, "/api/v2/symbols")
    _meta["syms"] = {s["symbol"]: s for s in (d or {}).get("data", [])}
    _meta["ts"] = time.time()
    return _meta["syms"]


async def margin_equity(sess):
    """Net cross-margin equity (assets - liabilities) — the short budget."""
    try:
        kp2 = KucoinPrivateREST(BASE, os.environ["KUCOIN_API_KEY2"],
                                os.environ["KUCOIN_API_SECRET2"],
                                os.environ["KUCOIN_API_PASSPHRASE2"], sess)
        d = await kp2._req("GET", "/api/v3/margin/accounts",
                           params={"quoteCurrency": "USDT"})
        return (float(d.get("totalAssetOfQuoteCurrency") or 0)
                - float(d.get("totalLiabilityOfQuoteCurrency") or 0))
    except Exception as e:
        print("grokky margin eq:", str(e)[:60], flush=True)
    return 0.0


async def spot_usdt(sess):
    """Free USDT in the spot trade account — the long budget."""
    try:
        kp2 = KucoinPrivateREST(BASE, os.environ["KUCOIN_API_KEY2"],
                                os.environ["KUCOIN_API_SECRET2"],
                                os.environ["KUCOIN_API_PASSPHRASE2"], sess)
        return await kp2.balance("USDT")
    except Exception as e:
        print("grokky spot usdt:", str(e)[:60], flush=True)
    return 0.0


_fee_rate = {}              # sym -> taker % (0.1 / 0.2 / 0.3 fee class)
MAX_TAKER = 0.2             # Class C (0.3%) pairs are banned — never won


async def taker_rate(_sess, sym):
    """Per-symbol taker %, cached; also learned from real fills."""
    if sym in _fee_rate:
        return _fee_rate[sym]
    if kp is not None:
        try:
            _fee_rate[sym] = await kp.taker_fee_pct(sym)
            return _fee_rate[sym]
        except Exception:
            pass
    return None               # unknown: allowed, learned on first fill


async def fill_fee_usdt(sym, side, p):
    """Real fee from our newest fill on `side`, converted to USDT.
    Returns None if no fill is found."""
    try:
        fs = await kp.fills(sym)
        f = next((x for x in fs if x["side"] == side
                  and float(x.get("createdAt") or 0) / 1000
                  >= p.get("ts", 0) - 30), None) \
            or next((x for x in fs if x["side"] == side), None)
        if not f:
            return None
        fee = float(f["fee"])
        if f.get("feeCurrency") != "USDT":
            fee *= float(f.get("price") or p["entry"])
        if side == "buy":
            _fee_rate[sym] = round(
                fee / max(1e-9, float(f.get("funds") or 0)) * 100, 3)
        return fee
    except Exception:
        return None


async def scan(sess):
    global kp, syms, _cands, trades_today, day, day_realized, panic_until
    global day_fees
    global store
    today = time.strftime("%Y-%m-%d", time.gmtime())
    if day != today:
        day, trades_today, day_realized, panic_until, day_fees = \
            today, 0, 0.0, 0.0, 0.0
        sym_loss.clear()
        try:
            conn = db()
            r = conn.execute(
                "SELECT COALESCE(SUM(net_pnl),0),COUNT(*),"
                "COALESCE(SUM(fees),0) FROM trades"
                " WHERE meta LIKE '%grokky%' AND exit_ts >= ?",
                (time.time() - time.time() % 86400,)).fetchone()
            day_realized, trades_today, day_fees = \
                float(r[0]), int(r[1]), float(r[2])
            conn.close()
        except Exception:
            pass
    if store is None:
        store = Storage(DB)
    if kp is None:
        kp = KucoinPrivateREST(BASE, os.environ.get("KUCOIN_API_KEY2", ""),
                               os.environ.get("KUCOIN_API_SECRET2", ""),
                               os.environ.get("KUCOIN_API_PASSPHRASE2", ""),
                               sess)
        print("GROKKY live: longs spot, shorts cross-margin", flush=True)
    d = await get(sess, "/api/v1/market/allTickers")
    rows = (d or {}).get("data", {}).get("ticker") or []
    top = sorted((t for t in rows if t.get("symbol", "").endswith("-USDT")
                  and float(t.get("volValue") or 0) > 5e5),
                 key=lambda x: float(x["volValue"]), reverse=True)[:TOP_N]
    syms = {t["symbol"]: float(t["last"] or 0) for t in top}
    for t in rows:                              # held positions stay priced
        if t.get("symbol") in positions and t["symbol"] not in syms:
            syms[t["symbol"]] = float(t["last"] or 0)
    meta_map = await sym_meta(sess)
    meq = await margin_equity(sess)
    susdt = await spot_usdt(sess)
    await kcs_topup(sess)
    # short budget: room left under the 1.1x-equity gross cap after what
    # this bot already has open on margin (legacy longs + own shorts)
    mopen = sum(p["qty"] * (syms.get(s) or p["entry"])
                for s, p in positions.items()
                if p.get("acct", "margin") == "margin")
    mroom = max(0.0, 1.1 * meq - mopen)
    lc, sc = [], []
    for sym, px in syms.items():
        if sym in positions or not px:
            continue
        r1 = await fetch_bars(sess, sym)
        await asyncio.sleep(.08)
        S = detect_structure(r1)
        if not S:
            continue
        closes = [b[1] for b in r1]
        rr = rsi(closes)
        zpos = (px - S["floor"]) / (S["ceil"] - S["floor"])
        near_edge = abs(px - S["floor"]) / px < EDGE_BUF or \
            abs(S["ceil"] - px) / px < EDGE_BUF
        m = meta_map.get(sym) or {}
        row = {"symbol": sym, "px": px, "rng": round(S["rng"], 2),
               "floor": S["floor"], "ceil": S["ceil"], "rsi": round(rr, 0),
               "kind": S["kind"]}
        cd = closed_at.get(sym, 0) + COOLDOWN_SEC - time.time()
        fr = await taker_rate(sess, sym)
        if panic_until > time.time():
            row["blocked"] = "PANIC halt"
        elif day_realized <= DAY_LOSS_CAP:
            row["blocked"] = "daily loss cap"
        elif trades_today >= MAX_TRADES_DAY:
            row["blocked"] = "max trades/day"
        elif fr is not None and fr > MAX_TAKER:
            row["blocked"] = f"fee class {fr}%"
        elif sym_loss.get(sym, 0) >= MAX_SYM_LOSS:
            row["blocked"] = "2 red closes"
        elif cd > 0:
            row["blocked"] = f"cooldown {int(cd/60)}m"
        elif near_edge:
            row["blocked"] = "on the edge"
        elif px < S["floor"] * 0.985:
            row["blocked"] = "deep break"
        elif zpos <= LOWER_ZONE and rr < RSI_LONG:
            # LONG lower zone/oversold — armed only after 2 green 1m
            # bars close back above the floor (knife filter)
            stop = S["floor"] * (1 - STOP_MAX / 100)
            sd = min(max((px - stop) / px * 100, STOP_MIN), STOP_MAX)
            rr_ok = (S["ceil"] * 0.995 - px) / px * 100 >= MIN_RR * sd
            # dying-coin veto (from ranger): >4% down over ~4h means
            # the "floor" is a stair in a slide, not a bounce level
            dw = r1[-DYING_BARS:]
            dying = len(dw) >= DYING_BARS and \
                float(dw[-1][1]) < float(dw[0][1]) * DYING_DROP
            if px < S["floor"] and S["rng"] < WIDE_MIN:
                row["blocked"] = "thin range dip"
            elif dying:
                row["blocked"] = "dying coin"
            elif not enabled_long or not rr_ok:
                row["blocked"] = ("rr" if enabled_long else "long off")
            elif not await confirm_entry(sess, sym, S["floor"], "long"):
                row["blocked"] = "no bounce"
            elif not store or store.claim_symbol(sym, "grokky"):
                if await open_pos(sym, "long", px,
                                  px * (1 - sd / 100), S,
                                  {"spot_usdt": susdt,
                                   "inc": m.get("baseIncrement")}):
                    trades_today += 1
                    print(f"GROKKY LONG {sym} @ {px} "
                          f"{S['kind']} {S['rng']:.1f}% rsi {rr:.0f}",
                          flush=True)
                    row["blocked"] = "LONGED"
                else:
                    if store:
                        store.release_symbol(sym, "grokky")
                    row["blocked"] = "long failed"
            else:
                row["blocked"] = "claimed"
        elif px > S["ceil"] * 1.015:
            row["blocked"] = "deep break"
        elif zpos >= UPPER_ZONE and rr > RSI_SHORT:
            # SHORT upper zone/overbought — armed only after 2 red 1m
            # bars close back below the ceil (spike filter)
            stop = S["ceil"] * (1 + STOP_MAX / 100)
            sd = min(max((stop - px) / px * 100, STOP_MIN), STOP_MAX)
            rr_ok = (px - S["floor"] * 1.005) / px * 100 >= MIN_RR * sd
            if px > S["ceil"] and S["rng"] < WIDE_MIN:
                row["blocked"] = "thin range rip"
            elif not m.get("isMarginEnabled"):
                row["blocked"] = "not marginable"
            elif not enabled_short or not rr_ok:
                row["blocked"] = ("rr" if enabled_short else "short off")
            elif not await confirm_entry(sess, sym, S["ceil"], "short"):
                row["blocked"] = "no fade"
            elif not store or store.claim_symbol(sym, "grokky"):
                if await open_pos(sym, "short", px,
                                  px * (1 + sd / 100), S,
                                  {"margin_eq": mroom,
                                   "inc": m.get("baseIncrement")}):
                    trades_today += 1
                    print(f"GROKKY SHORT {sym} @ {px} "
                          f"{S['kind']} {S['rng']:.1f}% rsi {rr:.0f}",
                          flush=True)
                    row["blocked"] = "SHORTED"
                else:
                    if store:
                        store.release_symbol(sym, "grokky")
                    row["blocked"] = "short failed"
            else:
                row["blocked"] = "claimed"
        else:
            row["blocked"] = (f"z{zpos:.2f} rsi{rr:.0f}" if zpos < 0.8
                              else "mid")
        (lc if zpos <= 0.5 else sc).append(row)
    _cands = {"long": lc[:40], "short": sc[:40],
              "info": {"watched": len(syms), "margin_eq": meq,
                       "spot_usdt": susdt}}


_last_bal_check = 0.0
_manage_busy = False


async def manage():
    global _last_bal_check, _manage_busy
    if _manage_busy:            # fast tick + slow loop can overlap at awaits
        return
    _manage_busy = True
    try:
        await _manage_body()
    finally:
        _manage_busy = False


async def _manage_body():
    global _last_bal_check
    # 60s balance check: coins gone -> close ledger (no ghost loops)
    if kp is not None and time.time() - _last_bal_check > 60:
        _last_bal_check = time.time()
        for sym, p in list(positions.items()):
            if not p.get("live"):
                continue
            try:
                base = sym.split("-")[0]
                if p["side"] == "long" and \
                        p.get("acct", "margin") == "spot":
                    accs = await kp.accounts(base)
                    bal = float(accs[0]["balance"]) if accs else 0.0
                    gone = bal < p["qty"] * 0.5
                elif p["side"] == "long":
                    d = await kp._req("GET", "/api/v3/margin/accounts",
                                      params={"quoteCurrency": "USDT"})
                    acct = {a["currency"]: a
                            for a in (d.get("accounts") or [])}
                    avail = float((acct.get(base) or {})
                                  .get("total") or 0)
                    gone = avail < p["qty"] * 0.5
                else:
                    d = await kp._req("GET", "/api/v3/margin/accounts",
                                      params={"quoteCurrency": "USDT"})
                    acct = {a["currency"]: a
                            for a in (d.get("accounts") or [])}
                    liab = float((acct.get(base) or {})
                                 .get("liability") or 0)
                    gone = liab <= 0      # borrow repaid externally
                if gone:
                    px = syms.get(sym) or p["entry"]
                    print(f"grokky external close {sym}: acct empty",
                          flush=True)
                    p["live"] = False
                    await close_pos(sym, p, px, "external_close")
                    continue
            except Exception:
                pass
    for sym, p in list(positions.items()):
        px = syms.get(sym)
        if not px:
            continue
        side = p["side"]
        gain = (((px - p["entry"]) if side == "long"
                 else (p["entry"] - px)) / p["entry"]) * 100
        # continuous tightening trail + 66% peak-profit lock: armed at
        # +0.5%, banks >=66% of the peak move; slack shrinks 0.40% ->
        # 0.15% once peak gain >= 1.5% (tighter than 66% up there)
        if side == "long":
            p["peak"] = max(p.get("peak", p["entry"]), px)
        else:
            p["peak"] = min(p.get("peak", p["entry"]), px)
        pgain = ((p["peak"] - p["entry"]) if side == "long"
                 else (p["entry"] - p["peak"])) / p["entry"] * 100
        if pgain >= 0.5:
            dist = 0.15 if pgain >= 1.5 else 0.40
            trail = p["peak"] * (1 - dist / 100) if side == "long" \
                else p["peak"] * (1 + dist / 100)
            lock = (p["entry"] + 0.80 * (p["peak"] - p["entry"])
                    if side == "long"
                    else p["entry"] - 0.80 * (p["entry"] - p["peak"]))
            lvl = max(trail, lock) if side == "long" \
                else min(trail, lock)
            if (side == "long" and lvl > p["stop"]) or \
                    (side == "short" and lvl < p["stop"]):
                p["stop"], p["rung"] = lvl, max(p["rung"], 0)
        held = (time.time() - p["ts"]) / 60
        why = None
        if side == "long" and px <= p["stop"]:
            why = "trailing_stop" if p["rung"] >= 0 else "stop_loss"
        elif side == "short" and px >= p["stop"]:
            why = "trailing_stop" if p["rung"] >= 0 else "stop_loss"
        elif side == "long" and px < p.get(
                "brk", p["floor"] * 0.9965):
            why = "range_broken"
        elif side == "short" and px > p.get(
                "brk", p["ceil"] * 1.0035):
            why = "range_broken"
        elif held > TIME_EXIT_MIN and gain < 0.1 and p["rung"] < 0:
            why = "time_exit"
        if why:
            await close_pos(sym, p, px, why)
    save_all()


async def state(_req):
    op = [{"symbol": s, "side": p["side"], "entry": p["entry"],
           "px": syms.get(s), "stop": p["stop"], "rung": p["rung"],
           "qty": p["qty"], "last": syms.get(s) or p["entry"],
           "path": "grokky",
           "take": 0,
           "upnl_pct": ((syms.get(s) or p["entry"]) / p["entry"] - 1)
           * 100 * (1 if p["side"] == "long" else -1),
           "held_s": time.time() - p["ts"],
           "unreal": ((syms.get(s) or p["entry"]) - p["entry"])
           * p["qty"] * (1 if p["side"] == "long" else -1)}
          for s, p in positions.items()]
    return web.json_response({
        "bot_id": "grokky", "mode": "live", "halted": False,
        "status": "scanning",
        "paths": {"grokky_long": enabled_long,
                  "grokky_short": enabled_short},
        "allocation_pct": 0,
        "equity": round(realized + 20, 2), "real_total": 20.0,
        "avail": _cands["info"].get("margin_eq", 0),
        "positions": op, "open_positions": op,
        "unrealized": sum(p["unreal"] for p in op),
        "day_realized": round(day_realized, 4),
        "realized": round(realized, 4),
        "fees_today": round(day_fees, 4),
        "trades_today": trades_today,
        "candidates": _cands["long"] + _cands["short"],
        "long_candidates": _cands["long"],
        "short_candidates": _cands["short"],
        "scan_info": _cands["info"]})


async def toggle(req):
    global enabled_long, enabled_short
    body = await req.json()
    p, on = body.get("path"), bool(body.get("on"))
    if p == "grokky_long":
        enabled_long = on
    elif p == "grokky_short":
        enabled_short = on
    save_all()
    return web.json_response({"ok": True, "long": enabled_long,
                              "short": enabled_short})


async def fast_tick(sess):
    """~1.2s price refresh on held positions so stops/trails see wicks
    the 8s scan loop would miss."""
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
                await manage()
        except Exception:
            pass
        await asyncio.sleep(1.2)


async def run():
    load_all()
    app = web.Application()
    app.router.add_get("/api/state", state)
    app.router.add_post("/api/path", toggle)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    async with aiohttp.ClientSession() as sess:
        asyncio.create_task(fast_tick(sess))
        while True:
            try:
                await scan(sess)
                await manage()
            except Exception as e:
                print("grokky loop err", str(e)[:100], flush=True)
            await asyncio.sleep(8)


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()
