# UpdatePilot

UpdatePilot is a local, single-device Windows update manager. It combines a Next.js dashboard, a loopback PostgreSQL API, and a .NET Windows agent that scans WinGet/registry inventory, resolves a version-pinned update, verifies the installer, and executes only explicitly allowed update profiles.

## Safety model

- The dashboard and API bind to loopback; there is no multi-user or remote deployment support.
- The browser can start an update only with a record ID. Package IDs, versions, installer URLs, hashes, commands, and execution profiles are derived by the backend.
- Updates require a fresh preview, matching installer SHA-256, valid Authenticode signature, compatible architecture, and an allowlisted execution profile.
- `UPDATE_EXECUTION_ENABLED=false` is the default hard gate. Set it to `true` only when you intend real installs.
- The agent re-downloads the exact pinned installer and repeats the hash, signature, and architecture checks before running it silently.
- Machine-scope installers require the agent process to run elevated. Exit codes 3010/1641 become `restart_required`; interrupted or failed jobs are not retried automatically.

## Components

- [`apps/web`](apps/web/README.md): dashboard, live inventory/update detail, confirmation, execution progress/history, and NVD security findings.
- [`apps/api`](apps/api/README.md): PostgreSQL schema, local authenticated API, pairing/job control, execution lifecycle, catalog/history APIs, and NVD matching.
- [`apps/windows-agent`](apps/windows-agent/README.md): scanner, preview/verification, controlled installer execution, and document/result transport.
- `examples/`: original visual design reference only.

## Quick start

Prerequisites: Node.js 22.12+, PostgreSQL, and the .NET 10 SDK on Windows.

```powershell
cd apps/api
npm install
Copy-Item .env.example .env
# Edit .env with DATABASE_URL and local secrets.
npm run db:generate
npm run db:migrate
npm run dev
```

In a second terminal:

```powershell
cd apps/web
npm install
npm run dev
```

Then pair and listen with the agent as described in [`apps/windows-agent/README.md`](apps/windows-agent/README.md), and open <http://localhost:3000>.

Keep `UPDATE_EXECUTION_ENABLED=false` until you have verified a test package on a disposable machine or VM.
