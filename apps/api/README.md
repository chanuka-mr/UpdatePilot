# UpdatePilot PostgreSQL backend

Local loopback API for UpdatePilot. It stores inventory, resolves and gates update previews/verification, controls agent jobs, records update executions, serves catalog/history data, and matches curated WinGet packages against NVD CVEs.

## Safety boundaries

- Bind to `127.0.0.1:4010`; this is a single-device local service, not a public or multi-user API.
- Browser update controls accept only `{ "recordId": "<uuid>" }`. The server derives package ID, installed/target version, installer type, hash, scope, architecture, command, and execution profile.
- `UPDATE_EXECUTION_ENABLED=false` is the default hard gate. The server queues an `update` job only after a fresh preview, matching verification evidence, a valid signature, compatible architecture, and an allowlisted execution profile.
- Publisher matching is recorded as evidence but is not yet a hard gate.
- The agent re-downloads and rechecks the exact installer before launch. Nothing is retried automatically.

## Setup

Prerequisites: Node.js 22.12+ and PostgreSQL.

```powershell
cd apps/api
npm install
Copy-Item .env.example .env
notepad .env
```

Set `DATABASE_URL` for a dedicated local database, for example `postgresql://updatepilot:PASSWORD@localhost:5432/updatepilot`. URL-encode reserved characters in credentials. Keep `DEVICE_KEY=local-pc` unless you intentionally use another single local device key. Set a strong local API token; never expose it to the browser. `.env` files are ignored by Git.

Apply the checked-in migrations and start the API:

```powershell
npm run db:generate
npm run db:check
npm run db:migrate
npm run dev
```

`db:check` verifies database login; `db:migrate` runs `prisma migrate deploy` without resetting data. The generated Prisma client is ignored by Git and must be regenerated after checkout or schema changes.

Optional environment:

- `UPDATE_EXECUTION_ENABLED=true`: enables real update jobs after all other gates pass. Leave `false` unless explicitly testing an approved installer.
- `NVD_API_KEY=<key>`: reduces NVD rate limiting from one request every 6.5 seconds to every 0.7 seconds.

## Main APIs

Authenticated dashboard APIs:

- `GET /api/v1/dashboard`
- `GET /api/v1/applications`, `GET /api/v1/updates`
- `GET /api/v1/applications/:id`, `GET /api/v1/updates/:id`
- `GET /api/v1/export/applications`, `GET /api/v1/export/updates`
- `GET /api/v1/history`
- `GET /api/v1/security`
- `GET /api/v1/executions`, `GET /api/v1/executions/:id`

Local control routes use the server-only control credential:

- `GET /api/v1/control/status`
- `POST /api/v1/control/pairing`
- `POST /api/v1/control/scan`
- `POST /api/v1/control/preview`
- `POST /api/v1/control/verify`
- `POST /api/v1/control/update`
- `POST /api/v1/control/cancel`
- `POST /api/v1/control/revoke`

Agent routes use the paired device credential:

- `POST /api/v1/agent/pair`, `/heartbeat`, `/claim`, `/result`

Next.js server proxies expose only the required same-origin dashboard/control routes; the browser never receives backend secrets. Inventory and execution APIs are scoped to the configured device key.

## Update lifecycle

Preview resolves the exact installed/catalog identity and requires a record from the latest scan, a source-matched update, known installed version, recent agent heartbeat, no competing job, and a scan no older than 24 hours. Verification downloads the exact version-pinned installer, checks one matching SHA-256, signature, timestamp, and architecture, and stores bound evidence.

The update gate additionally requires known scope, a compatible architecture, a valid installer signature, and an allowlisted profile: `msi-user`, `msi-machine`, `inno-user`, `inno-machine`, `nsis-user`, `nsis-machine`, `burn-user`, or `burn-machine`. Raw `exe` profiles are not allowed.

Execution statuses progress through `queued`, `preparing`, `downloading`, `verifying`, `installing`, then `confirming`, `awaiting_restart`, `succeeded`, `failed`, `blocked`, `cancelled`, `interrupted`, or `expired`. Successful updates trigger a confirmation scan. Exit codes 3010/1641 become `restart_required` and require reboot confirmation plus a scan. Queued updates can be cancelled; running installs cannot.

Leases: queued verification expires after 20 minutes; claimed/running verification uses a 30-minute lease; queued updates expire after 35 minutes; update progress extends the lease by 15 minutes. Expired running executions are lazily interrupted.

## Security findings

`GET /api/v1/security` uses the latest completed WinGet snapshot. Only the curated mappings in `src/modules/security/mappings.ts` are queried; unmapped packages are never guessed into an NVD product. NVD data is fetched with `virtualMatchString`, up to five 2,000-result pages, a 30-second request timeout, and a six-hour in-memory cache. Mapping/matching is conservative: non-Windows-only configurations and unbounded wildcard CPEs are not treated as verified findings. NVD may lag vendor advisories; findings are context, not update authorization.

## History and exports

`GET /api/v1/history` serves scan history with bounded search, filters, sorting, paging, and exact scan UUID lookup. `GET /api/v1/executions` serves update execution history and links to claimed update/preview/verify/confirmation jobs. Exports contain private local inventory metadata and should not be shared casually. Raw snapshots, registry paths, credentials, and database URLs are not returned.

## Validation

```powershell
npm run typecheck
npm test
node --import tsx scripts/smoke-agent.mjs
node --import tsx scripts/smoke-dashboard.mjs
```

The test suite covers scan/preview/verify contracts, execution evidence and status mapping, update gating, catalog/history queries, and security CPE matching. Smoke scripts require a configured database; the agent smoke test also needs a built .NET agent and WinGet. Application updates are not executed by the tests.
