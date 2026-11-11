"""Performance analysis (plan H) computed from persisted trades."""
from __future__ import annotations

from collections import defaultdict


def _to_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]


def compute(trades: list[dict], starting_capital: float,
            equity_curve: list | None = None) -> dict:
    if not trades:
        return {"trades": 0}
    wins = [t for t in trades if t["net_pnl"] > 0]
    losses = [t for t in trades if t["net_pnl"] <= 0]
    gross_profit = sum(t["gross_pnl"] for t in trades)
    fees = sum(t["fees"] for t in trades)
    net = gross_profit - fees
    win_sum = sum(t["net_pnl"] for t in wins)
    loss_sum = abs(sum(t["net_pnl"] for t in losses))

    # max drawdown from closed-trade equity path (+ equity curve if given)
    eq = starting_capital
    curve = equity_curve or [{"equity": eq}]
    peak, max_dd = eq, 0.0
    for t in trades:
        eq += t["net_pnl"]
        peak = max(peak, eq)
        max_dd = max(max_dd, (peak - eq) / peak * 100 if peak else 0)

    by_sym = defaultdict(lambda: {"n": 0, "net": 0.0, "wins": 0})
    for t in trades:
        b = by_sym[t["symbol"]]
        b["n"] += 1; b["net"] += t["net_pnl"]; b["wins"] += t["net_pnl"] > 0
    by_hold = defaultdict(lambda: {"n": 0, "net": 0.0})
    for t in trades:
        held = t["exit_ts"] - t["entry_ts"]
        bucket = ("<30s" if held < 30 else "30-60s" if held < 60
                  else "1-5m" if held < 300 else ">5m")
        by_hold[bucket]["n"] += 1; by_hold[bucket]["net"] += t["net_pnl"]
    by_reason = defaultdict(lambda: {"n": 0, "net": 0.0})
    for t in trades:
        by_reason[t["exit_reason"]]["n"] += 1
        by_reason[t["exit_reason"]]["net"] += t["net_pnl"]

    span = (trades[-1]["exit_ts"] - trades[0]["entry_ts"]) or 1
    return {
        "trades": len(trades),
        "gross_pnl": round(gross_profit, 4),
        "fees": round(fees, 4),
        "net_pnl": round(net, 4),
        "win_rate": round(len(wins) / len(trades) * 100, 1),
        "avg_win": round(win_sum / len(wins), 4) if wins else 0,
        "avg_loss": round(-loss_sum / len(losses), 4) if losses else 0,
        "profit_factor": round(win_sum / loss_sum, 2) if loss_sum else None,
        "expectancy": round(net / len(trades), 4),
        "max_drawdown_pct": round(max_dd, 2),
        "return_on_capital_pct": round(net / starting_capital * 100, 2),
        "trades_per_hour": round(len(trades) / (span / 3600), 2),
        "by_symbol": dict(by_sym),
        "by_holding_period": dict(by_hold),
        "by_exit_reason": dict(by_reason),
    }


def compare_live_vs_backtest(live: dict, backtest: dict) -> dict:
    """Reality-vs-model comparison (plan H)."""
    keys = ["win_rate", "profit_factor", "expectancy", "max_drawdown_pct",
            "trades_per_hour"]
    out = {}
    for k in keys:
        l, b = live.get(k), backtest.get(k)
        if l is not None and b not in (None, 0):
            out[k] = {"live": l, "backtest": b,
                      "drift": round((l - b) / b * 100, 1)}
    return out
