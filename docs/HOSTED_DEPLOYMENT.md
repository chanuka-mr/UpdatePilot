# Hosted UpdatePilot Deployment Guide

This guide covers deploying UpdatePilot to **Vercel** (`apps/web`) and **Railway or Render** (`apps/api` + managed PostgreSQL) for **Milestone 1 (private single-account test)** and **Production Release**.

## 1. Hosting Setup (Milestone 1)

1. **Managed PostgreSQL + API (`apps/api`) on Railway or Render**
   - Create a managed PostgreSQL database and copy its `DATABASE_URL` (with `sslmode=require` in production).
   - Deploy `apps/api` with Node 22: build with `npm ci && npx prisma generate`, start with `npx prisma migrate deploy && npm start`.
   - Set environment variables on the API service:
     - `DATABASE_URL` = managed PostgreSQL connection string
     - `BACKEND_API_TOKEN` = random 64-char hex secret (`openssl rand -hex 32`)
     - `TRUST_PROXY` = `true`
     - `SIGNUP_ENABLED` = `false` (for private Milestone 1)
     - `MAX_DEVICES_PER_USER` = `1`
     - `UPDATE_EXECUTION_ENABLED` = `false` (keep disabled until VM testing is complete)
   - Verify the healthcheck at `GET https://<your-api-host>/healthz` returns `{"ok":true}`.

2. **Frontend (`apps/web`) on Vercel**
   - Set Root Directory to `apps/web`.
   - Set environment variables on Vercel:
     - `BACKEND_API_URL` = `https://<your-api-host>`
     - `BACKEND_API_TOKEN` = exact same 64-char secret as the API
     - `NEXT_PUBLIC_APP_URL` = `https://<your-vercel-domain>`
     - `NEXT_PUBLIC_AGENT_API_URL` = `https://<your-api-host>`
     - `NEXT_PUBLIC_AGENT_DOWNLOAD_URL` = public HTTPS URL for `UpdatePilot-Agent-win-x64.zip`

3. **Publish the Windows agent package**
   - Build the self-contained agent and package the entire publish output (not just the `.exe`):
     ```powershell
     cd apps/windows-agent
     dotnet publish .\UpdatePilot.Agent\UpdatePilot.Agent.csproj -c Release -r win-x64 --self-contained true -o .\publish
     Compress-Archive -Path .\publish\* -DestinationPath .\UpdatePilot-Agent-win-x64.zip -Force
     ```
   - Upload `UpdatePilot-Agent-win-x64.zip` to public object storage or a release-download service. The ZIP must have `UpdatePilot.Agent.exe` at its top level.
   - Set its public HTTPS URL as `NEXT_PUBLIC_AGENT_DOWNLOAD_URL` in Vercel and redeploy. Users can then download the ZIP or use the install command shown on Settings; no access to your development folder is needed.

4. **Create Your Private Milestone 1 Account**
   - Run once against your production database (via Railway/Render shell or local `.env` pointing to the DB):
     ```bash
     cd apps/api
     npm run user:create -- --email you@example.com --password "YourLongUniquePassword123!" --name "Owner" --role admin
     ```

## 2. Enroll and Verify One Test Windows PC

1. Sign in at `https://<your-vercel-domain>/login`.
2. Go to **Settings** and click **Generate Pairing Code** (5-minute, single-use).
3. On your Windows PC (no inbound firewall port or router forwarding needed):
   ```powershell
   $env:UPDATEPILOT_API_URL = "https://<your-api-host>"
   $env:UPDATEPILOT_ALLOWED_HOST = "<your-api-host>"
   .\UpdatePilot.Agent.exe --pair
   .\UpdatePilot.Agent.exe --listen
   ```
4. Confirm end-to-end:
   - Agent shows **Connected - heartbeat received**.
   - Click **Scan Now** and confirm inventory populates.
   - Open an update candidate and run **Preview** and **Verify Installer**.
   - Test **Revoke Agent** and confirm the agent stops with a revocation message and can re-pair with a new code.

## 3. Disposable Windows VM Testing (Before Enabling Updates)

1. Provision a disposable Windows 10/11 VM (e.g. Windows Sandbox, Hyper-V, or cloud VM with snapshot).
2. Enroll the VM as your test device.
3. Temporarily set `UPDATE_EXECUTION_ENABLED=true` on the private test API.
4. Run a real update for a benign package (e.g. `VideoLAN.VLC`) and verify:
   - Exact version pinning, SHA-256 verification, Authenticode signature check, and architecture check pass.
   - Progress updates stream to the web UI.
   - Post-update confirming scan marks execution `succeeded` (or `restart_required` on 3010/1641).
5. Reset `UPDATE_EXECUTION_ENABLED=false` until ready for production release.

## 4. Production Release Checklist

- [ ] Custom domain + HTTPS active for both web and API.
- [ ] Managed PostgreSQL automated daily backups and point-in-time recovery enabled.
- [ ] Uptime monitoring on `https://<your-api-host>/healthz` and error/audit log alerts configured.
- [ ] Windows agent built self-contained (`dotnet publish -c Release -r win-x64`) and Authenticode-signed with a code-signing certificate.
- [ ] `SIGNUP_ENABLED=true` (and `MAX_DEVICES_PER_USER` raised as desired) only when ready for multiple users.
- [ ] `UPDATE_EXECUTION_ENABLED=true` enabled only after disposable VM verification passes.
