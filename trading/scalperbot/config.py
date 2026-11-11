"""Configuration loading: config.yaml + environment variable overrides.

Secrets never live in config.yaml - they come from env vars:
    KUCOIN_API_KEY, KUCOIN_API_SECRET, KUCOIN_API_PASSPHRASE
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = ROOT / "state"
DATA_DIR = ROOT / "data"


@dataclass
class MarketConfig:
    quote_currency: str = "USDT"
    base_url: str = "https://api.kucoin.com"
    ws_bullet_path: str = "/api/v1/bullet-public"
    scan_interval_sec: float = 15.0
    top_candidates: int = 5
    candle_interval: str = "1min"          # KuCoin candle type
    history_limit: int = 240               # candles kept per symbol
    trade_buffer_sec: int = 600            # live trade ring-buffer length
    watchlist: list[str] = field(default_factory=list)   # e.g. ["BTC-USDT"]
    blacklist: list[str] = field(default_factory=list)
    min_24h_quote_volume: float = 150_000
    min_listing_age_days: float = 7.0    # ban coins listed <N days ago
    max_spread_pct: float = 0.15
    min_history_candles: int = 60
    max_price_change_pct_1m: float = 8.0   # suspicious-move filter
    stale_data_ms: int = 10_000            # data older than this is stale


@dataclass
class StrategyConfig:
    vol_spike_factor: float = 2.0          # recent vol vs baseline to flag a spike
    atr_min_pct: float = 0.6               # ALT path: always-volatile coins qualify too
    # PATH 3 - peak/trough rhythm: buy the swing low of an oscillating coin
    rhythm_enabled: bool = True
    rhythm_min_range_atr: float = 2.0      # range must be >= this many ATRs
    rhythm_min_pivots: int = 3             # need this many swing pivots = rhythm
    rhythm_zone_pct: float = 0.35          # price must be in bottom X of range
    rhythm_window_bars_15m: int = 48       # history only; latest pivots still must be fresh
    rhythm_max_stop_pct: float | None = None   # scope default: 1m 1.5%, 15m 2%
    rhythm_min_path_pct: float | None = None   # net reachable: 1m 2%, 15m 3%
    rhythm_min_reward_risk: float | None = None  # scope default: 1.1 / 1.25
    rhythm_trail_steps: list | None = None  # saved on new rhythm positions only
    rhythm_max_roundtrip_cost_pct: float | None = None
    rhythm_realistic_reward_risk: float = 0.6
    ema_fast: int = 9
    ema_slow: int = 21
    atr_period: int = 14
    pullback_min_atr: float = 0.8          # min pullback depth in ATRs
    pullback_max_atr: float = 3.5          # beyond this it is a decline, not a dip
    pullback_max_pct: float = 4.0          # absolute cap on pullback depth
    extended_move_pct: float = 8.0         # skip entries after >x% run-up
    reversal_min_buy_ratio: float = 0.55   # taker buy share needed on reversal
    min_bull_pct: float = 0.18             # completed bull bar must gain this %
    rhythm_shock_btc_1h_pct: float | None = None  # BTC 1h below -> relaxed bulls
    max_taker_fee_pct: float = 0.2         # refuse live buys above this per side
    dying_dump_pct: float = 10.0           # ban if this % below the ~12h high
    dying_lookback_bars: int = 48          # ~12h at 15m (uses all avail bars)
    reversal_min_imbalance: float = 0.15   # book bid-depth edge needed (path b)
    reversal_lookback_sec: int = 30
    expected_profit_min_pct: float = 0.60  # min expected net profit to enter
    take_profit_pct: float = 0.9
    stop_loss_pct: float = 1.0
    trail_activate_pct: float = 0.5        # profit at which trailing stop arms
    # stepped trailing ladder [gain%, offset%] - moon-catching mode
    trail_steps: list = field(default_factory=lambda:
                              [[0.9, 0.25], [3.0, 0.4], [5.0, 0.6],
                               [10.0, 1.0]])
    gated_enabled: bool = True
    new_enabled: bool = False           # independent Chatty service only
    claude_enabled: bool = False        # independent Claude services only
    claude_params: dict = field(default_factory=dict)  # profile overrides
    swing_enabled: bool = False         # independent Swing service only
    swing_params: dict = field(default_factory=dict)   # profile overrides
    new_min_trend30_pct: float = 0.3
    new_momentum_hold: bool = False        # suspend red time-exit in uptrend
    new_momo_trend30_pct: float = 1.0      # min +% over 30m to count as run
    new_momo_off_high_pct: float = 1.5     # must stay within this % of 30m high
    new_runner_enabled: bool = False       # buy-strength entry path
    new_runner_trend30_pct: float = 1.5    # min run strength to chase
    new_runner_max_trend30_pct: float = 4.0  # don't buy the blow-off top
    new_runner_off_high_pct: float = 0.8   # must be near 30m highs to enter
    new_min_range10_pct: float = 0.8
    new_min_uptick_pct: float = 0.02    # min live lift above forming-candle open
    new_persist_cycles: int = 1         # scans the setup must survive before entry
    new_min_btc12h_pct: float = 0.0        # legacy, superseded by regime gate
    new_btc_lookback_h: float = 6.0        # BTC window for the regime veto
    new_min_btc_regime_pct: float = -5.0   # veto if BTC fell more than this
    new_min_btc_1h_pct: float = 0.15       # momentum gate: need BTC 1h >= this
    rhythm_min_btc_1h_pct: float = 0.10    # same gate for rhythm/gated entries
    loss_cooldown_sec: float = 300      # per-symbol block after a losing exit
    # path 4: knife catcher
    knife_enabled: bool = True
    knife_drop_pct: float = 4.0         # min dump % over knife_lookback bars
    knife_lookback: int = 12            # bars measuring the dump
    knife_rec_hist: int = 300           # candles of history for bounce record
    knife_rec_min: int = 1              # min past knives required
    knife_rec_ratio: float = 0.5        # recovered >= 50% of drop = a bounce
    knife_rec_rate: float = 0.6         # >= 60% of past knives must have bounced
    knife_target_ratio: float = 0.8     # ride the bounce to this retracement
    knife_stop_buffer_pct: float = 0.05 # stop this far under the crash close
    knife_turn_pct: float = 10.0       # reclaim this % of the crash (open->low)
    knife_max_risk_pct: float = 0.8    # planned knife loss cap, % of equity
    knife_cooldown_sec: float = 3600   # 1h per-coin cooldown after ANY knife
    knife_min_age_days: float = 7      # knives need 7d+ listing history
    knife_stab_pct: float = 0.2         # lift off the low counts as stabilizing
    knife_steps: list = field(default_factory=lambda:
                              [[2.0, 1.0], [5.0, 0.8], [10.0, 0.6],
                               [20.0, 0.4]])
    trail_offset_pct: float = 0.35
    time_exit_sec: int = 2700              # flat-timer == cap (losers get room)
    time_exit_gain_pct: float | None = None  # flat-timer gain gate; None = trail_activate*0.3
    max_hold_sec: int = 2700
    signal_max_age_ms: int = 5_000         # reject stale signals
    hold_presets_sec: list[int] = field(default_factory=lambda: [30, 60, 300])
    switch_advantage_factor: float = 1.6   # candidate must score this much better
    switch_min_hold_sec: int = 120         # min hold before allowing a switch
    switch_cooldown_sec: int = 180         # min gap between switches


@dataclass
class RiskConfig:
    starting_capital: float = 1_000.0
    max_position_pct: float = 25.0         # % of equity per position
    max_risk_per_trade_pct: float = 0.5    # % of equity risked per trade
    max_risk_pct: float | None = None      # optional planned loss cap, % equity
    max_daily_loss_pct: float = 3.0        # HARD limit - cannot be raised at runtime
    max_drawdown_pct: float = 8.0          # HARD limit
    max_consecutive_losses: int = 4        # triggers cooldown
    cooldown_min: int = 30
    max_trades_per_day: int = 60
    max_open_positions: int = 1          # concurrent positions allowed
    allocation_pct: float = 100.0        # share of account equity this bot owns
    leverage: float = 1.0                  # spot only - no borrowing
    emergency_file: str = "state/HALT"     # touch this file to halt


@dataclass
class ExecutionConfig:
    mode: str = "paper"                    # paper | live
    taker_fee_pct: float = 0.1             # KuCoin base spot taker fee
    maker_fee_pct: float = 0.1
    slippage_bps: float = 5.0              # assumed slippage for paper fills
    order_timeout_sec: float = 10.0        # cancel unfilled entry after this
    reconcile_interval_sec: float = 60.0


@dataclass
class DashboardConfig:
    enabled: bool = True
    host: str = "127.0.0.1"
    port: int = 8377


@dataclass
class Config:
    market: MarketConfig = field(default_factory=MarketConfig)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    dashboard: DashboardConfig = field(default_factory=DashboardConfig)
    notify_webhook: str = ""               # optional POST webhook for alerts
    db_path: str = "state/scalperbot.db"
    qualification_file: str = "state/qualification.json"

    # --- secrets (env only) -------------------------------------------------
    @property
    def api_key(self) -> str:
        return os.environ.get("KUCOIN_API_KEY", "")

    @property
    def api_secret(self) -> str:
        return os.environ.get("KUCOIN_API_SECRET", "")

    @property
    def api_passphrase(self) -> str:
        return os.environ.get("KUCOIN_API_PASSPHRASE", "")

    @property
    def has_credentials(self) -> bool:
        return bool(self.api_key and self.api_secret and self.api_passphrase)


def _merge(dc, data: dict):
    names = {f.name for f in fields(dc)}
    for k, v in (data or {}).items():
        if k in names:
            setattr(dc, k, v)


def load_config(path: str | Path | None = None) -> Config:
    cfg = Config()
    p = Path(path or os.environ.get("CONFIG_PATH", ROOT / "config.yaml"))
    if p.exists():
        raw = yaml.safe_load(p.read_text()) or {}
        _merge(cfg.market, raw.get("market"))
        _merge(cfg.strategy, raw.get("strategy"))
        _merge(cfg.risk, raw.get("risk"))
        _merge(cfg.execution, raw.get("execution"))
        _merge(cfg.dashboard, raw.get("dashboard"))
        _merge(cfg, {k: v for k, v in raw.items()
                     if k in {"notify_webhook", "db_path", "qualification_file"}})
    # env override for mode so you can run live without editing files
    if os.environ.get("BOT_MODE"):
        cfg.execution.mode = os.environ["BOT_MODE"]
    name = os.environ.get("BOT_NAME", "")
    if (name in ("new", "claude", "claude15", "swing") and
            cfg.execution.mode == "paper" and
            cfg.db_path == "state/scalperbot.db"):
        # paper bots never share live locks/positions/account maths
        cfg.db_path = ("state/newbot-paper.db" if name == "new"
                       else f"state/{name}-paper.db")
    if os.environ.get("DASHBOARD_HOST"):
        cfg.dashboard.host = os.environ["DASHBOARD_HOST"]
    if os.environ.get("DASHBOARD_PORT"):
        cfg.dashboard.port = int(os.environ["DASHBOARD_PORT"])
    if os.environ.get("DB_PATH"):
        cfg.db_path = os.environ["DB_PATH"]
    if os.environ.get("QUALIFICATION_FILE"):
        cfg.qualification_file = os.environ["QUALIFICATION_FILE"]
    STATE_DIR.mkdir(exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)
    return cfg
