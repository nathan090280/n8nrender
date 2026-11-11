"""SQLite persistence: trades, orders, equity snapshots, events.

Synchronous sqlite3 is fine here - writes are short and infrequent.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT, side TEXT,
    entry_ts REAL, exit_ts REAL,
    qty REAL, entry_price REAL, exit_price REAL,
    gross_pnl REAL, fees REAL, net_pnl REAL,
    exit_reason TEXT, mode TEXT,
    meta TEXT
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL, symbol TEXT, side TEXT, type TEXT,
    requested_qty REAL, filled_qty REAL, avg_price REAL,
    fee REAL, status TEXT, client_oid TEXT UNIQUE, exchange_id TEXT,
    slippage_pct REAL, mode TEXT
);
CREATE TABLE IF NOT EXISTS equity (
    ts REAL, equity REAL, cash REAL, mode TEXT
);
CREATE TABLE IF NOT EXISTS events (
    ts REAL, level TEXT, kind TEXT, message TEXT, data TEXT
);
CREATE TABLE IF NOT EXISTS symbol_locks (
    symbol TEXT PRIMARY KEY,
    bot_id TEXT, ts REAL
);
CREATE TABLE IF NOT EXISTS open_positions (
    bot_id TEXT, symbol TEXT, qty REAL, entry_price REAL,
    entry_ts REAL, stop_price REAL, take_price REAL,
    trail_high REAL, meta TEXT,
    PRIMARY KEY(bot_id, symbol)
);
"""


class Storage:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        # autocommit + busy_timeout: two bot PROCESSES share this file;
        # lingering write txns cause "database is locked" crashes
        self.conn = sqlite3.connect(path, check_same_thread=False,
                                    timeout=30, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=15000")
        self.conn.executescript(SCHEMA)
        # Older databases have only trail_high; add state needed to restore
        # the exact exit rules of positions opened after this migration.
        for name, typ in (("entry_fee", "REAL"), ("trailing", "INTEGER"),
                          ("trail_steps", "TEXT"), ("no_exit", "INTEGER")):
            if name not in {r[1] for r in self.conn.execute(
                    "PRAGMA table_info(open_positions)")}:
                try:
                    self.conn.execute(
                        f"ALTER TABLE open_positions ADD COLUMN {name} {typ}")
                except sqlite3.OperationalError as e:
                    if "duplicate column" not in str(e).lower():
                        raise
        self.conn.commit()

    # ------------------------------------------------------------- writes
    def log_order(self, o: dict):
        with self._lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO orders (ts,symbol,side,type,requested_qty,"
                "filled_qty,avg_price,fee,status,client_oid,exchange_id,"
                "slippage_pct,mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (o.get("ts", time.time()), o["symbol"], o["side"], o["type"],
                 o["requested_qty"], o["filled_qty"], o["avg_price"],
                 o["fee"], o["status"], o["client_oid"], o.get("exchange_id"),
                 o.get("slippage_pct"), o["mode"]))

    def log_trade(self, t: dict):
        with self._lock:
            self.conn.execute(
                "INSERT INTO trades (symbol,side,entry_ts,exit_ts,qty,entry_price,"
                "exit_price,gross_pnl,fees,net_pnl,exit_reason,mode,meta)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (t["symbol"], t["side"], t["entry_ts"], t["exit_ts"], t["qty"],
                 t["entry_price"], t["exit_price"], t["gross_pnl"], t["fees"],
                 t["net_pnl"], t["exit_reason"], t["mode"],
                 json.dumps(t.get("meta", {}))))

    def log_equity(self, equity: float, cash: float, mode: str):
        with self._lock:
            self.conn.execute(
                "INSERT INTO equity (ts,equity,cash,mode) VALUES (?,?,?,?)",
                (time.time(), equity, cash, mode))

    def event(self, level: str, kind: str, message: str, data: dict | None = None):
        with self._lock:
            self.conn.execute(
                "INSERT INTO events (ts,level,kind,message,data) VALUES (?,?,?,?,?)",
                (time.time(), level, kind, message, json.dumps(data or {})))
            self.conn.commit()

    # ------------------------------------------------- open positions
    def save_position(self, bot_id: str, p):
        with self._lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO open_positions"
                " (bot_id,symbol,qty,entry_price,entry_ts,stop_price,"
                "take_price,trail_high,meta,entry_fee,trailing,trail_steps,"
                "no_exit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (bot_id, p.symbol, p.qty, p.entry_price, p.entry_ts,
                 p.stop_price, p.take_price,
                 p.highest_px, json.dumps(p.meta), p.fees_paid,
                 int(p.trailing), json.dumps(p.trail_steps),
                 int(getattr(p, "no_exit", False))))

    def delete_position(self, bot_id: str, symbol: str):
        with self._lock:
            self.conn.execute(
                "DELETE FROM open_positions WHERE bot_id=? AND symbol=?",
                (bot_id, symbol))

    def open_value(self) -> float:
        """Total entry value of all open positions (shared account view)."""
        return self.conn.execute(
            "SELECT COALESCE(SUM(qty*entry_price),0) FROM open_positions"
        ).fetchone()[0]

    def load_positions(self, bot_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM open_positions WHERE bot_id=?",
            (bot_id,)).fetchall()
        return [dict(r) for r in rows]

    def latest_buy(self, symbol: str, bot_id: str) -> dict | None:
        row = self.conn.execute(
            "SELECT avg_price, filled_qty, fee, ts FROM orders"
            " WHERE symbol=? AND side='buy' AND filled_qty>0"
            " AND client_oid LIKE ?"
            " ORDER BY ts DESC LIMIT 1",
            (symbol, bot_id + ":%")).fetchone()
        return dict(row) if row else None

    def orders_since(self, symbol: str, side: str,
                     since_ts: float) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM orders WHERE symbol=? AND side=?"
            " AND filled_qty>0 AND ts>=? ORDER BY ts",
            (symbol, side, since_ts)).fetchall()

    def settle_position(self, bot_id: str, symbol: str, trade: dict | None,
                        remaining_qty: float, remaining_fee: float):
        """Atomically record a recovered close and resize/remove the row."""
        with self._lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                if trade:
                    self.conn.execute(
                        "INSERT INTO trades (symbol,side,entry_ts,exit_ts,qty,"
                        "entry_price,exit_price,gross_pnl,fees,net_pnl,"
                        "exit_reason,mode,meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (trade["symbol"], trade["side"], trade["entry_ts"],
                         trade["exit_ts"], trade["qty"], trade["entry_price"],
                         trade["exit_price"], trade["gross_pnl"], trade["fees"],
                         trade["net_pnl"], trade["exit_reason"], trade["mode"],
                         json.dumps(trade.get("meta", {}))))
                if remaining_qty > 1e-10:
                    cur = self.conn.execute(
                        "UPDATE open_positions SET qty=?, entry_fee=?"
                        " WHERE bot_id=? AND symbol=?",
                        (remaining_qty, remaining_fee, bot_id, symbol))
                    if cur.rowcount != 1:
                        raise RuntimeError(f"open position row missing: {symbol}")
                else:
                    self.conn.execute(
                        "DELETE FROM open_positions WHERE bot_id=? AND symbol=?",
                        (bot_id, symbol))
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise

    def day_order_stats(self, bot_id: str, since_ts: float) -> tuple[int, float]:
        """(buy fills, total fees) for this bot since `since_ts` - used to
        re-seed daily counters after a restart."""
        # main also owns legacy orders logged before bot tagging existed
        mine = ("(client_oid LIKE ? OR client_oid NOT LIKE '%:%')"
                if bot_id == "main" else "client_oid LIKE ?")
        r = self.conn.execute(
            "SELECT COUNT(*) c, COALESCE(SUM(fee),0) f FROM orders"
            f" WHERE side='buy' AND filled_qty>0 AND ts>=? AND {mine}",
            (since_ts, bot_id + ":%")).fetchone()
        f = self.conn.execute(
            "SELECT COALESCE(SUM(fee),0) f FROM orders"
            f" WHERE ts>=? AND {mine}",
            (since_ts, bot_id + ":%")).fetchone()
        return r["c"], f["f"]

    def day_realized(self, bot_id: str, since_ts: float,
                     mode: str) -> float:
        """Net PnL of this bot's closed trades since `since_ts`."""
        own = f'%"bot": "{bot_id}"%'
        q = ("SELECT COALESCE(SUM(net_pnl),0) p FROM trades"
             " WHERE exit_ts>=? AND mode=? AND meta LIKE ?")
        args = [since_ts, mode, own]
        if bot_id == "main":            # plus legacy untagged trades
            q = q.replace("meta LIKE ?",
                          "(meta LIKE ? OR meta NOT LIKE '%\"bot\"%')")
        row = self.conn.execute(q, args).fetchone()
        return row["p"]

    # ------------------------------------------------- cross-bot locking
    def claim_symbol(self, symbol: str, bot_id: str,
                     ttl_s: int = 7200) -> bool:
        """Atomically claim a symbol for this bot (multi-instance safety).
        Never steal a lock while another bot has a persisted open position."""
        now = time.time()
        with self._lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                held = self.conn.execute(
                    "SELECT 1 FROM open_positions WHERE symbol=? "
                    "AND bot_id!=? AND qty>0 LIMIT 1",
                    (symbol, bot_id)).fetchone()
                row = self.conn.execute(
                    "SELECT bot_id, ts FROM symbol_locks WHERE symbol=?",
                    (symbol,)).fetchone()
                if held or (row and row["bot_id"] != bot_id and
                            now - row["ts"] < ttl_s):
                    self.conn.rollback()
                    return False
                self.conn.execute(
                    "INSERT OR REPLACE INTO symbol_locks (symbol,bot_id,ts)"
                    " VALUES (?,?,?)", (symbol, bot_id, now))
                self.conn.commit()
                return True
            except Exception:
                self.conn.rollback()
                raise

    def release_symbol(self, symbol: str, bot_id: str):
        with self._lock:
            self.conn.execute(
                "DELETE FROM symbol_locks WHERE symbol=? AND bot_id=?",
                (symbol, bot_id))
            self.conn.commit()

    def claimed_symbols(self, exclude_bot: str,
                        ttl_s: int = 7200) -> set[str]:
        """Symbols currently held by OTHER bots."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT symbol FROM symbol_locks WHERE bot_id!=? AND ts>?",
                (exclude_bot, time.time() - ttl_s)).fetchall()
            return {r["symbol"] for r in rows}

    # ------------------------------------------------------------- reads
    def trades(self, mode: str | None = None,
               since: float | None = None) -> list[sqlite3.Row]:
        q, args = "SELECT * FROM trades WHERE 1=1", []
        if mode:
            q += " AND mode=?"; args.append(mode)
        if since:
            q += " AND exit_ts>=?"; args.append(since)
        with self._lock:
            return self.conn.execute(q + " ORDER BY exit_ts", args).fetchall()

    def equity_curve(self, mode: str) -> list[sqlite3.Row]:
        with self._lock:
            return self.conn.execute(
                "SELECT * FROM equity WHERE mode=? ORDER BY ts", (mode,)).fetchall()

    def close(self):
        self.conn.close()
