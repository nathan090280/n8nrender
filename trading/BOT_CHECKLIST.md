# Bot Build Standard — mandatory safeguards for every trading service

Every item below cost real money or a real incident. A new bot does not
go live until it passes all of them.

## Entry / Ownership
- [ ] `claim_symbol(sym, bot_id)` on EVERY entry; `release_symbol` on close.
      Unclaimed positions get adopted by other bots (XMR phantom incident).
- [ ] Size from the real balance at order time (e.g. 90% of free USDT),
      never a constant. (The $5 SIZE_Q bug.)
- [ ] Verify marginability + `baseIncrement` + `baseMinSize` before any
      order (KuCoin /api/v2/symbols, cached ~5min).
- [ ] Per-side mutex: max 1 long + 1 short (separate accounts). Same-side
      multiples need deliberate pot slicing, not 90% each.
- [ ] Independent ON/OFF toggle per direction, persisted.

## Exits / Loops
- [ ] 1h same-symbol cooldown after every exit (`closed_at`).
      (The ELSA bleed: 8 fee-burning round-trips in 4 min.)
- [ ] Panic fuse: >=3 losing closes in 10 min -> that bot's entries frozen 1h.
- [ ] Daily loss cap (-$0.40) and max trades/day (12), seeded from the
      trades table at boot/day-rollover.
- [ ] Delete the position BEFORE writing history; history write is
      best-effort inside its own try/catch. A failed write must never
      retry into duplicate rows or ghost positions.
- [ ] Ladder trails real profit; red/scratch time-exit cuts; positions
      locked at breakeven+ ride with no clock (no max-hold kill).
- [ ] Drawdown halt requires 2 consecutive bad equity reads; skip the
      check entirely for the first 90s after boot.

## Position Integrity
- [ ] Held positions are ALWAYS priced: a symbol falling out of the
      watchlist must not freeze P&L or stop management. (NEAR incident.)
- [ ] Periodic balance check (~60s): coins gone -> close ledger at the
      real fill price via fills lookup (`external_close` reason).
- [ ] Orphan adoption requires the balance to match a recorded fill qty
      (±15%); never guess an entry price.
- [ ] Positions persist to a state file, reload on boot.

## Display / Reporting
- [ ] Full position schema emitted: qty, last, entry, stop, upnl_pct,
      held_s, take, path, bot. (One missing key kills /api/fleet.)
- [ ] Real bot id in trade meta; history badges map every bot + path.
- [ ] Spot and margin equity reported separately; combined only where
      explicitly labelled.
- [ ] mode: live/paper recorded accurately on every trade.

## Deployment
- [ ] `PYTHONPATH=. python tests/test_regressions.py` green before deploy.
- [ ] Watch first live log lines after restart: entry path, sizing,
      claims, management loop.
- [ ] Verify position appears in fleet feed with correct schema before
      calling the work done.
