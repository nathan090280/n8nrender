"""Dynamic coin switching (plan E).

The bot may sit in cash indefinitely. Switching is a two-step process:
manage/close the current position by its own exit rules, then reassess.
A switch only happens when a challenger scores meaningfully better
(hysteresis) - never just because another coin is more volatile.
"""
from __future__ import annotations

import time


class Switcher:
    def __init__(self, cfg):
        self.cfg = cfg
        self.last_switch_ts = 0.0
        self.pending_switch_to: str | None = None

    def evaluate(self, current_sym: str | None, current_pos,
                 candidates: list, signal_for) -> dict:
        """Returns {"action": "hold"|"exit_for_switch"|"enter",
                    "target": symbol|None, "reason": str}."""
        s = self.cfg.strategy
        best = next((c for c in candidates
                     if (current_sym is None or c.symbol != current_sym)
                     and signal_for(c.symbol)), None)

        # flat: just pick the best candidate with a valid signal
        if current_sym is None or current_pos is None:
            if best:
                return {"action": "enter", "target": best.symbol,
                        "reason": f"best candidate score={best.score:.1f}"}
            return {"action": "hold", "target": None, "reason": "in cash"}

        # holding: a challenger must beat the current coin decisively
        held = time.time() - current_pos.entry_ts
        if held < s.switch_min_hold_sec:
            return {"action": "hold", "target": current_sym,
                    "reason": "min hold not met"}
        if time.time() - self.last_switch_ts < s.switch_cooldown_sec:
            return {"action": "hold", "target": current_sym,
                    "reason": "switch cooldown"}
        if best is None:
            return {"action": "hold", "target": current_sym,
                    "reason": "no challenger"}
        cur_score = next((c.score for c in candidates
                          if c.symbol == current_sym), 0.0)
        if best.score < cur_score * s.switch_advantage_factor:
            return {"action": "hold", "target": current_sym,
                    "reason": f"challenger {best.symbol} not decisively better"}
        self.pending_switch_to = best.symbol
        return {"action": "exit_for_switch", "target": best.symbol,
                "reason": f"switch {current_sym}->{best.symbol} "
                          f"({cur_score:.1f}->{best.score:.1f})"}

    def switched(self):
        self.last_switch_ts = time.time()
        self.pending_switch_to = None
