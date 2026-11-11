# Frankfurt replacement service

This branch creates a new Render service named `superspeech-backend-frankfurt`
in Frankfurt. It does not change or redeploy the existing Oregon service.
Render does not support moving an existing service between regions.

The new service starts with SuperSpeech background jobs and trading disabled.
That prevents duplicate email/reddit/social jobs while both services exist.
Grokky and the read-only dashboard aggregator are armed only after state import.
Leave `ENABLE_TRADING_FLEET=false` on the Oregon service while its US IP is
blocked so it does not keep retrying rejected KuCoin requests.

## Create the replacement

1. In Render, create a Blueprint from this repository's
   `frankfurt-migration` branch and use the root `render.yaml`.
2. Confirm the new service name is `superspeech-backend-frankfurt`, region is
   Frankfurt, runtime is Docker, root directory is blank, and disk is mounted
   at `/data`.
3. Copy the current SuperSpeech environment values from the Oregon service to
   the Frankfurt service. Do not copy old KuCoin credentials; add the newly
   rotated key to both KuCoin variable groups. Copy the Williams Quantum
   `WQ_*` settings too. The WQ API secret and mailbox password posted in chat
   are exposed; rotate both before using them on Frankfurt. Use the new WQ
   values in Oregon and Frankfurt during the overlap, and update any WQ client
   that uses the old API secret.
   Keep the new service's WQ job flags false while staging. Pinterest and
   Reddit variables are omitted because you said those integrations are not
   used. `PORT` is supplied by Render; do not add `PORT=8080`.
4. Leave `ENABLE_SUPERSPEECH_JOBS=false` and both trading flags false while
   testing. Verify `/health` on the new service.
5. Add `api.superspeech.biz` and `scalperbot-nath.duckdns.org` under the
   Frankfurt service's Custom Domains settings. Configure the DNS records
   Render shows and wait until both domains verify and have TLS.
6. Set `BACKEND_PUBLIC_URL=https://api.superspeech.biz`. Deploy the prepared
   Netlify site copy at
   `C:\openhands_business\workspace\superspeech-frankfurt-staging`; the
   original site copy remains untouched until that deployment.
7. Temporarily set `TRADING_STATE_IMPORT_ENABLED=true` and
   `TRADING_MIGRATION_TOKEN` in Render, while leaving trading disabled. Upload
   the state archive from Git Bash or PowerShell:

   ```powershell
   $env:TRADING_MIGRATION_TOKEN = Read-Host "Temporary migration token"
   python C:\openhands_business\workspace\render-migration-superSpeech\scripts\upload_trading_state.py C:\openhands_business\workspace\render-migration-superSpeech\backups\scalperbot-state-20261111-191640.tgz https://superspeech-backend-frankfurt.onrender.com
   Remove-Item Env:TRADING_MIGRATION_TOKEN
   ```

8. From the Oregon service's Render Shell, transfer the Williams Quantum store
   file while the same temporary token is set in that shell:

   ```sh
   read -s -p "Frankfurt migration token: " TRADING_MIGRATION_TOKEN
   export TRADING_MIGRATION_TOKEN
   curl -fsSL https://raw.githubusercontent.com/nathan090280/n8nrender/frankfurt-migration/scripts/transfer_wq_store.js | node
   unset TRADING_MIGRATION_TOKEN
   ```

   This sends the WQ JSON store over HTTPS; it does not print the store content.
   Restart the Frankfurt service afterward so WQ loads `/data/wq-store.json`.
   Keep WQ jobs off until cutover.
9. After both imports succeed, remove `TRADING_MIGRATION_TOKEN` and set
   `TRADING_STATE_IMPORT_ENABLED=false`.

## Cut over

Once Frankfurt health, API calls, domains, and imported state are verified:

1. Confirm the Netlify site, `api.superspeech.biz`, and Stripe webhook all point
   to Frankfurt. Keep the Oregon service available until these checks pass.
2. Suspend the Oregon service to stop its email, Reddit, and social schedules.
3. Enable `ENABLE_SUPERSPEECH_JOBS=true`, `WQ_ENABLE_IMAP_POLLING=true`, and
   `WQ_ENABLE_AGENT=true` on Frankfurt.
4. Enable `TRADING_STATE_READY=true` and `ENABLE_TRADING_FLEET=true`.
5. Verify Williams Quantum, Grokky, and the dashboard at
   `https://scalperbot-nath.duckdns.org/`.
6. Keep Oregon suspended as rollback until the Frankfurt service is stable.
   Delete Oregon only after SuperSpeech users and integrations are confirmed
   working against Frankfurt.

Do not run both services' background jobs or trading simultaneously. The old
`superspeech-backend.onrender.com` hostname is not assumed to transfer; the
Netlify frontend and generated backend links are moved to
`api.superspeech.biz` before Oregon is retired.
