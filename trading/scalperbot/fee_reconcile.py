"""Plan audited corrections for exchange-confirmed fees omitted at fill time."""
from __future__ import annotations

import json
import time


def plan_fee_corrections(orders: list[dict], trades: list[dict],
                         exchange_fees: dict[str, float]) -> dict:
    """Return proposed order/trade updates without writing to the database.

    Each trade is matched to the immediately preceding buy and sell order.
    Ambiguous or unmatched trades are left unchanged and reported for review.
    """
    order_updates, trade_updates, unmatched = [], [], []
    deltas = {}
    for order in orders:
        actual = exchange_fees.get(order["exchange_id"])
        if actual is None:
            continue
        delta = actual - order["fee"]
        if delta < -1e-8:
            unmatched.append(("order", order["id"], "exchange fee lower"))
        elif delta > 1e-10:
            deltas[order["id"]] = delta
            order_updates.append({
                "id": order["id"], "old_fee": order["fee"],
                "new_fee": actual, "exchange_id": order["exchange_id"]})

    def match(trade, side, ts):
        candidates = [
            o for o in orders
            if o["symbol"] == trade["symbol"] and o["side"] == side
            and o["filled_qty"] > 0
            and o["filled_qty"] >= trade["qty"] * 0.999999
            and 0 <= ts - o["ts"] < 3
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda o: ts - o["ts"])
        if len(candidates) > 1 and \
                abs(candidates[0]["ts"] - candidates[1]["ts"]) < 0.001:
            return None
        return candidates[0]

    for trade in trades:
        if trade["exit_reason"] == "manual-rescue":
            continue
        buy = match(trade, "buy", trade["entry_ts"])
        sell = match(trade, "sell", trade["exit_ts"])
        if not buy or not sell:
            unmatched.append(("trade", trade["id"], "order match missing"))
            continue
        delta = (deltas.get(buy["id"], 0) * trade["qty"] / buy["filled_qty"]
                 + deltas.get(sell["id"], 0) * trade["qty"] /
                 sell["filled_qty"])
        if delta > 1e-10:
            trade_updates.append({
                "id": trade["id"], "old_fee": trade["fees"],
                "new_fee": trade["fees"] + delta,
                "old_net": trade["net_pnl"],
                "new_net": trade["net_pnl"] - delta,
                "buy_id": buy["id"], "sell_id": sell["id"]})
    return {"orders": order_updates, "trades": trade_updates,
            "unmatched": unmatched}


def apply_fee_corrections(conn, plan: dict) -> None:
    """Record old values, then correct only rows still matching the audit."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS fee_corrections (
                ts REAL, kind TEXT, row_id INTEGER,
                old_fee REAL, new_fee REAL, old_net REAL, new_net REAL,
                source TEXT
            )
        """)
        for update in plan["orders"]:
            conn.execute(
                "INSERT INTO fee_corrections VALUES (?,?,?,?,?,?,?,?)",
                (time.time(), "order", update["id"], update["old_fee"],
                 update["new_fee"], None, None, update["exchange_id"]))
            cur = conn.execute(
                "UPDATE orders SET fee=? WHERE id=? AND fee=?",
                (update["new_fee"], update["id"], update["old_fee"]))
            if cur.rowcount != 1:
                raise RuntimeError("order changed during fee reconciliation")
        for update in plan["trades"]:
            conn.execute(
                "INSERT INTO fee_corrections VALUES (?,?,?,?,?,?,?,?)",
                (time.time(), "trade", update["id"], update["old_fee"],
                 update["new_fee"], update["old_net"], update["new_net"],
                 f"{update['buy_id']}:{update['sell_id']}"))
            cur = conn.execute(
                "UPDATE trades SET fees=?, net_pnl=? "
                "WHERE id=? AND fees=? AND net_pnl=?",
                (update["new_fee"], update["new_net"], update["id"],
                 update["old_fee"], update["old_net"]))
            if cur.rowcount != 1:
                raise RuntimeError("trade changed during fee reconciliation")
        conn.execute(
            "INSERT INTO events (ts,level,kind,message,data) "
            "VALUES (?,?,?,?,?)",
            (time.time(), "info", "fee_reconciliation",
             "Corrected exchange-verified USDT fees",
             json.dumps({"orders": len(plan["orders"]),
                         "trades": len(plan["trades"]),
                         "unmatched": plan["unmatched"]})))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
