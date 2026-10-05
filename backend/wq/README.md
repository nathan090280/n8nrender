# wq/ — Williams Quantum tenant

Self-contained second site on this Render service. Mounted by a single
try/catch block in `../src/server.js` (search for `[WQ]`); delete that block
and this folder to detach it entirely. Fails soft — a WQ error cannot take
SuperSpeech down.

- Routes: `/wq/health`, `/wq/api/status` (public), `/wq/api/contact`
  (public website form), `/wq/api/leads?key=` (principal pipeline view),
  `/wq/api/agent-run`, `/wq/api/incoming-email`
- Env vars: ALL prefixed `WQ_*` — see `.env.example`. Never share names
  with the host app (except the AI key, which intentionally falls back to
  `ANTHROPIC_API_KEY` / `OPENHANDS_API_KEY`).
- Store: JSON file at `wq/data/store.json` (gitignored) or `WQ_STORE_FILE`.
- Source of truth: `C:\openhands_business\WIlliamsQuantum\backend` — copy
  changes into this folder when the upstream version changes.
- Deps: none of its own — resolves upward into this service's node_modules.
