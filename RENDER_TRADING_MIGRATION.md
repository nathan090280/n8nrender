# Render trading-fleet staging

This branch is a staging integration only. It does not start trading unless
both `ENABLE_TRADING_FLEET=true` and `TRADING_STATE_READY=true` are set.

## What it contains

- The SuperSpeech Node service remains the public web process.
- All ScalperBot services run as child processes in the same Render instance.
- The bots share `/data` for SQLite, positions, and qualification state.
- The dashboard is proxied at `/trading`; its API remains protected by
  `DASHBOARD_USER` and `DASHBOARD_PASSWORD`.
- The read-only collector is optional and defaults off.

## Before enabling trading

1. Rotate any API credentials that were pasted into chat. Never commit keys
   or put them in this file.
2. Add the replacement credentials as Render environment variables:
   `KUCOIN_API_KEY`, `KUCOIN_API_SECRET`, `KUCOIN_API_PASSPHRASE`, and the
   corresponding `KUCOIN_API_KEY2`, `KUCOIN_API_SECRET2`,
   `KUCOIN_API_PASSPHRASE2` names. A single key can be entered in both groups
   only if it has both required spot and margin permissions.
3. Set `DASHBOARD_USER` and `DASHBOARD_PASSWORD` in Render.
4. Attach the persistent disk at `/data`.
5. Keep `ENABLE_TRADING_FLEET=false` and `TRADING_STATE_READY=false`. Set a
   temporary random `TRADING_MIGRATION_TOKEN`, then set
   `TRADING_STATE_IMPORT_ENABLED=true`.
6. While the VPS bots are still running, turn off new entries and wait for
   open positions to become flat. From Git Bash in this repository, export a
   consistent SQLite backup and bot-state snapshot:

   ```bash
   bash scripts/export_vps_trading_state.sh backups
   ```

7. Stop the VPS bot services only after the export succeeds. Upload the
   resulting archive from Git Bash, with the same temporary token set in the
   local shell environment:

   ```bash
   python scripts/upload_trading_state.py \
     backups/scalperbot-state-<timestamp>.tgz \
     https://superspeech-backend.onrender.com
   ```

8. Confirm the import response lists `scalperbot.db` and state files. Then
   remove `TRADING_MIGRATION_TOKEN`, set
   `TRADING_STATE_IMPORT_ENABLED=false`, and redeploy while the fleet remains
   disabled.
9. Set `TRADING_STATE_READY=true`, then `ENABLE_TRADING_FLEET=true`. Confirm
   all child services and positions in `/trading` before considering the
   migration complete.

Never run the VPS and Render trading fleets live at the same time. The
collector's large research database is intentionally not migrated or started.

## Capacity note

This Blueprint selects Render's Starter/512 MB plan. The combined Node service
plus nine Python bot processes may exceed that memory limit. The Docker image
could not be built in this workspace because the local Docker daemon is not
running; do not arm the fleet until a staging deploy confirms startup and
memory use. If it exceeds the plan, keep the fleet disabled and resize this
single service rather than splitting bots into separate instances.
