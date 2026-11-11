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
   rotated key to both KuCoin variable groups. Keep all trading/import flags
   false.
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

   After the upload succeeds, remove the token and set
   `TRADING_STATE_IMPORT_ENABLED=false`.

## Cut over

Once Frankfurt health, API calls, domains, and imported state are verified:

1. Confirm the Netlify site, `api.superspeech.biz`, and Stripe webhook all point
   to Frankfurt. Keep the Oregon service available until these checks pass.
2. Suspend the Oregon service to stop its email, Reddit, and social schedules.
3. Enable `ENABLE_SUPERSPEECH_JOBS=true` on Frankfurt.
4. Enable `TRADING_STATE_READY=true` and `ENABLE_TRADING_FLEET=true`.
5. Verify Grokky and the dashboard at `https://scalperbot-nath.duckdns.org/`.
6. Keep Oregon suspended as rollback until the Frankfurt service is stable.
   Delete Oregon only after SuperSpeech users and integrations are confirmed
   working against Frankfurt.

Do not run both services' background jobs or trading simultaneously. The old
`superspeech-backend.onrender.com` hostname is not assumed to transfer; the
Netlify frontend and generated backend links are moved to
`api.superspeech.biz` before Oregon is retired.
