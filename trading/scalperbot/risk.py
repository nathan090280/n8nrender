"""Risk manager (plan F). All limits are enforced here before any order.

Hard limits (daily loss, drawdown) can only be tightened at runtime,
never loosened - the dashboard writes through `update_limits` which
clamps to the configured ceiling.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class RiskVerdict:
    allowed: bool
    reason: str = ""
    size_quote: float = 0.0


class RiskManager:
    def __init__(self, cfg):
        self.cfg = cfg
        r = cfg.risk
        self.start_equity = r.starting_capital
        self.equity = r.starting_capital
        self.cash = r.starting_capital
        # account_total = the WHOLE pool this bot may reach into for sizing;
        # equity stays the bot's own ledger for PnL + loss limits
        self.account_total = r.starting_capital
        self.peak_equity = r.starting_capital
        # hard ceilings loaded from config - runtime changes can only lower
        self.hard_daily_loss_pct = r.max_daily_loss_pct
        self.hard_drawdown_pct = r.max_drawdown_pct
        self.daily_loss_pct = r.max_daily_loss_pct
        self.drawdown_pct = r.max_drawdown_pct
        self.consec_losses = 0
        self.trades_today = 0
        self.day_realized = 0.0
        self.day_start_equity = r.starting_capital
        self._pnl_floor = 0.0             # losses booked before a resume
        self._day = self._today()
        self.cooldown_until = 0.0
        self.halted = False
        self.halt_reason = ""
        self._boot_ts = time.time()     # dd checks ignored during warmup

    @staticmethod
    def _today() -> str:
        return time.strftime("%Y-%m-%d", time.gmtime())

    def _roll_day(self):
        if self._today() != self._day:
            self._day = self._today()
            self.trades_today = 0
            self.day_realized = 0.0
            self.day_start_equity = self.equity
            self._pnl_floor = 0.0
            self.consec_losses = 0

    # ------------------------------------------------------------- gates
    def can_trade(self, data_health: dict | None = None) -> RiskVerdict:
        self._roll_day()
        r = self.cfg.risk
        if self.halted:
            return RiskVerdict(False, f"HALTED: {self.halt_reason}")
        if Path(r.emergency_file).exists():
            self.halted = True
            self.halt_reason = "emergency file present"
            return RiskVerdict(False, "emergency HALT file present")
        if time.time() < self.cooldown_until:
            return RiskVerdict(False, "cooldown after consecutive losses")
        if self.trades_today >= r.max_trades_per_day:
            return RiskVerdict(False, "max trades/day reached")
        daily_loss = ((self.day_realized - self._pnl_floor)
                      / self.day_start_equity * 100
                      if self.day_start_equity else 0)
        if daily_loss <= -self.daily_loss_pct:      # HARD limit
            self.halted, self.halt_reason = True, "hard daily loss limit"
            self._write_halt_file()
            return RiskVerdict(False, "hard daily loss limit hit")
        if time.time() - self._boot_ts >= 90:        # warmup skips dd check
            dd = ((self.peak_equity - self.equity) / self.peak_equity * 100
                  if self.peak_equity else 0)
            if dd >= self.drawdown_pct:              # HARD limit, needs 2 reads
                self._dd_breach = getattr(self, "_dd_breach", 0) + 1
                if self._dd_breach >= 2:
                    self.halted, self.halt_reason = True, "max drawdown hit"
                    self._write_halt_file()
                return RiskVerdict(False, "max drawdown hit")
            self._dd_breach = 0                      # equity recovered -> reset
        if data_health and data_health.get("ws_stale"):
            return RiskVerdict(False, "market data unreliable (WS stale)")
        return RiskVerdict(True)

    def position_size(self, stop_distance_pct: float,
                      available_cash: float | None = None) -> float:
        """Quote amount: min(risk-based, account position cap, real cash).

        The cap denominates on the whole account so a single bot can use
        the full pot; `available_cash` (real exchange balance) is what
        splits the pot when several bots trade at once."""
        r = self.cfg.risk
        by_risk = (self.equity * r.max_risk_per_trade_pct / 100
                   / max(stop_distance_pct / 100, 1e-6))
        if r.max_risk_pct is not None:
            by_risk = min(
                by_risk,
                self.equity * r.max_risk_pct / 100
                / max(stop_distance_pct / 100, 1e-6))
        by_cap = self.account_total * r.max_position_pct / 100
        # shared pot, first come first served: the REAL free balance is the
        # only cash limit; the ledger is just a fallback when it's unknown
        cash = self.cash if available_cash is None else available_cash
        return max(0.0, min(by_risk, by_cap, cash))

    # ------------------------------------------------------------- updates
    def on_fill_buy(self, quote_spent: float):
        self.cash -= quote_spent
        self.trades_today += 1

    def on_fill_sell(self, quote_received: float):
        self.cash += quote_received

    def on_trade_close(self, net_pnl: float):
        self.equity += net_pnl
        self.day_realized += net_pnl
        self.peak_equity = max(self.peak_equity, self.equity)
        if net_pnl < 0:
            self.consec_losses += 1
            if self.consec_losses >= self.cfg.risk.max_consecutive_losses:
                self.cooldown_until = (time.time()
                                       + self.cfg.risk.cooldown_min * 60)
                self.consec_losses = 0
        else:
            self.consec_losses = 0

    def sync_cash(self, available: float):
        """Mirror the real exchange balance (shared pool accounting). Must be
        able to RISE again when another bot's trade frees the money."""
        self.cash = max(0.0, available)

    def mark_unrealised(self, upnl: float):
        # peak tracks realized equity only - paper spikes must not inflate
        # the drawdown baseline and trip a phantom halt on the fallback
        self.peak_equity = max(self.peak_equity, self.equity)

    def _write_halt_file(self):
        """Persist the halt so it survives restarts/redeploys."""
        try:
            Path(self.cfg.risk.emergency_file).touch()
        except Exception:
            pass

    def halt(self, reason: str):
        self.halted, self.halt_reason = True, reason
        self._write_halt_file()

    def resume(self):
        self.halted, self.halt_reason = False, ""
        # bypass the halt but keep the honest P&L: only losses AFTER the
        # resume count toward the daily-loss AND drawdown limits
        self._pnl_floor = self.day_realized
        self.peak_equity = self.equity          # reset drawdown baseline too
        ef = Path(self.cfg.risk.emergency_file)
        if ef.exists():
            ef.unlink()

    def update_limits(self, **kw) -> dict:
        """Runtime-tunable limits; hard caps can only tighten, never loosen."""
        r = self.cfg.risk
        out = {}
        for k, v in kw.items():
            if k == "max_daily_loss_pct":
                self.daily_loss_pct = min(float(v), self.hard_daily_loss_pct)
                out[k] = self.daily_loss_pct
            elif k == "max_drawdown_pct":
                self.drawdown_pct = min(float(v), self.hard_drawdown_pct)
                out[k] = self.drawdown_pct
            elif k in {"max_position_pct", "max_risk_per_trade_pct",
                       "max_consecutive_losses", "max_trades_per_day",
                       "max_open_positions", "cooldown_min"}:
                setattr(r, k, type(getattr(r, k))(v))
                out[k] = getattr(r, k)
        return out
