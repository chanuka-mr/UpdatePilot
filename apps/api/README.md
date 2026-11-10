# UpdatePilot PostgreSQL backend

## Read-only update previews

`POST /api/v1/control/preview` takes only `{ "recordId": "<WinGet row UUID>" }`. The record must belong to the configured device's latest scan, be source-matched, report an update, and have a known installed version. Scans older than 24 hours are rejected. A recent paired-agent heartbeat is required. A preview shares the existing device job lease and concurrency lock with scans, and uses `operation: preview`. The migration adds nullable request/result JSON and a default scan operation to the existing job table.

The first **Generate Pairing Code** request securely bootstraps the configured local device record if it does not yet exist. It does not import inventory, start a scan, or authorize an update; the paired agent must still explicitly receive a scan job before any read-only inventory is stored.

The updated agent independently queries `Get-WinGetPackage` and `Find-WinGetPackage` using exact package IDs and the fixed winget source. It verifies the installed version has not changed, obtains the catalog's candidate version and publisher, and uses exact catalog product identifiers to locate uninstall registry scope. Ambiguous/missing identities block the result. Scope remains unknown when exact product identifiers do not resolve a single scope. Registry view is never treated as architecture.

The agent also runs a fixed, exact-ID, version-pinned `winget show` query. If its current-device selection exposes both installer type and a 64-character SHA-256, those values are saved as selection evidence; otherwise they remain unconfirmed. No installer is downloaded, signature-verified, or executed. Architecture, installed-to-selected scope compatibility, reboot needs, release date, and release notes are therefore not asserted. Catalog versions are candidates, not approved installation targets; results are `incomplete`, `blocked`, or `no-update`, never installation-ready. Preview schemas require `installationEnabled: false` and `signatureVerified: false` (meaning not verified). The browser cannot supply target versions, arbitrary commands, installer URLs, or execution arguments.

Results are persisted on the leased job, fingerprinted for duplicate upload handling, and available through the existing local control status route. A preview completion does not create an inventory snapshot or update-history entry. Run a fresh scan after metadata says the installed version changed. Restart an already-running agent after updating so it recognizes preview jobs. Existing pairing credentials can be retained.

## Agent pairing and scan jobs

Additive migrations introduce `AgentCredential`, `PairingTicket`, and `ScanJob`. Run `npm run db:generate` and `npm run db:migrate` when updating an existing checkout. Partial unique indexes enforce one active credential, pending pairing ticket, and queued/running scan per device. Existing imported scans are preserved.

The private control API provides GET `/api/v1/control/status` and POST `/api/v1/control/pairing`, `/scan`, and `/revoke`, restricted to backend `DEVICE_KEY` and the existing server-only control token. Next.js proxies require local same-origin POST requests. Settings displays a cryptographically random, single-use pairing code that expires after five minutes. Only SHA-256 hashes of pairing codes, device tokens, and job leases are stored. No raw agent credential is returned to the browser.

The loopback agent API provides POST `/api/v1/agent/pair`, `/heartbeat`, `/claim`, and `/result`. Pairing exchanges the code for a device-scoped credential. Result uploads validate the current credential, device ownership, claimed job, lease, state, expiry, and snapshot schema. Snapshot persistence and job completion share a transaction. Identical repeated result uploads are idempotent; altered results, expired jobs, revoked credentials, and mismatched leases are rejected. Claims use conditional updates, and scan requests serialize duplicate queue attempts. Only `scan` operations are issued—no arbitrary command, path, installer URL, or shell arguments are accepted.

Running/queued jobs expire after ten minutes, lazily reconciled by status and agent requests. No automatic scan retries occur. A successful upload of a partial snapshot completes the transport job; WinGet errors and warnings remain visible in the imported inventory/history. Pending uploads are encrypted on the agent and retried on reconnect. This is not a public remote management service or multi-user authorization implementation.

`node --import tsx scripts/smoke-agent.mjs` checks pairing replay, job deduplication, leases, idempotent results, expiry, revocation, DPAPI credential storage, the real C# scanner/upload path, and frontend origin rejection using a temporary device. It needs a built .NET agent, local database access, and the WinGet module. Temporary rows and state files are removed after the test. Application updates are not executed.

## Imported scan history

`GET /api/v1/history` provides device-scoped scan history only. Parameters: `q` (device name or exact full scan UUID), `status` (`all`, `completed`, `failed`, `not-requested`), `direction` (`asc`/`desc` by scan time), `page`, `pageSize` (max 100), and optional exact scan `id`. Unknown/duplicate parameters are rejected. Scan ID lookups still require the configured device key. Totals, paging, and counts run in one repeatable-read transaction. Lists expose warning counts; exact ID lookups additionally return recorded warnings. Raw snapshot payloads, registry paths, and credentials are not returned.

Completed WinGet results with registry/source warnings are labelled Completed with Warnings. Failed WinGet results retain the successful registry count and unknown catalog/update counts. Registry-only scans are distinct from fully completed scans. History contains imported snapshots, not every scan ever run: failed imports, agent jobs, and update executions are not recorded by this milestone.

## Inventory list APIs

The same authenticated local server now provides `GET /api/v1/applications` and `GET /api/v1/updates`. Both are pinned to backend `DEVICE_KEY` and the latest scan by scan timestamp. No request can select another device. Supported query parameters are `q` (up to 200 characters), `page` (1–100000), `pageSize` (1–100), `source` (`registry` or `winget`), `status` (`all`, `update`, `matched`, `unmatched`), `sort` (`name` or `installedVersion`), and `direction` (`asc` or `desc`). Unknown or duplicate query parameters are rejected. Installed version sorting is textual, not semantic version ordering.

Applications defaults to desktop registry entries; these remain unmatched. WinGet inventory is a separate view. Updates always queries matched WinGet update candidates regardless of the supplied source/status. Source-specific counts, rows, and latest-scan selection run in a repeatable-read transaction, with a stable ID sort tiebreaker. Out-of-range pages clamp to the last available page. Failed/unrequested WinGet scans return `state: unavailable` and `total: null`, not zero updates. Only the selected page's records are returned. The API never returns registry paths, raw snapshots, or database credentials.

Run `node --import tsx scripts/smoke-dashboard.mjs` with your local database configured to check live counts, pagination, search, invalid parameters, authentication, and the frontend proxies. No database writes or installations occur.

## Read-only dashboard API

The overview now reads the latest imported scan through `GET /api/v1/dashboard`. This local development API binds to `127.0.0.1:4010` and requires a bearer token. It serves only the device selected by backend `DEVICE_KEY` (default `local-pc`). It is not a multi-user authentication or pairing system and must not be exposed publicly.

From `backend`, run `node scripts/configure-local-api.mjs` once. It generates matching private API tokens in backend `.env` and frontend `.env.local` without printing them or changing database credentials. Then start `npm run dev` in backend and `npm run dev` in frontend in separate terminals. Restart both after configuration changes. The frontend server proxies `/api/dashboard`; the browser never receives the backend credential or database URL.

The overview handles loading, unavailable backend/database, missing scans, failed catalog scans, and scans older than 24 hours. No scan jobs or installations are executed. Other frontend pages remain labelled samples for now. Update counts are unknown for failed/unrequested WinGet scans. Preview rows do not infer approved target versions from available catalog versions.

Verify the overview against `npm run db:summary -- --device-key local-pc`. A different device key requires changing backend `DEVICE_KEY`, not passing arbitrary device identifiers from a browser.

This milestone stores the agent's JSON snapshot in a local PostgreSQL database using TypeScript and Prisma ORM 7. It includes a local command-line importer and a loopback authenticated HTTP API. The browser and agent do not receive database credentials. Paired agents can upload scan-job results; update execution remains disabled.

## 1. Create a dedicated local database

Open SQL Shell (psql) or pgAdmin using your PostgreSQL administrator account. In pgAdmin, run the role and database statements separately with auto-commit enabled; `CREATE DATABASE` cannot run inside a transaction block. Use your own strong password instead of the placeholder:

```sql
CREATE ROLE updatepilot LOGIN PASSWORD 'REPLACE_WITH_YOUR_PASSWORD';
```

```sql
CREATE DATABASE updatepilot OWNER updatepilot;
```

Do this once. If either already exists, inspect it instead of recreating it. The role does not need superuser or permission to create other databases. Keep this as a dedicated development database; migrations create new tables here.

## 2. Configure the backend

In PowerShell:

```powershell
cd "C:\Users\jchan\OneDrive\Desktop\D\Gamage\New folder\UpdatePilot\apps\api"
npm install
Copy-Item .env.example .env
notepad .env
```

Run the copy only when `.env` does not exist. Set `DATABASE_URL` using the role, password, database, and port from your installation. The default example uses `localhost:5432`. URL-encode reserved characters in the username/password, for example `@` as `%40` and `#` as `%23`. Edit credentials locally; do not send them in chat or commit `.env`. The repository ignores `.env` files.

## 3. Verify connectivity and create the tables

```powershell
npm run db:generate
npm run db:check
npm run db:migrate
```

`db:check` verifies database login without requiring application tables. `db:migrate` applies checked-in migrations; it does not run a reset or require a shadow database. Do not apply this development schema to an unrelated existing database.

## 4. Import the agent scan

Run a fresh agent scan first if desired. Then, from `backend`:

```powershell
npm run db:import -- --file "../windows-agent/data/inventory.json" --device-key "local-pc" --device-name "My Windows PC"
npm run db:summary -- --device-key "local-pc"
```

Keep the same device key on later imports. It is a local import label, not a pairing credential or proof of device identity. The name is set when the device is first created.

The importer validates the file before connecting and writes an entire snapshot in a single transaction. Importing the same normalized file again is a no-op; changing a snapshot with the same device and scan timestamp is rejected. Fresh scans retain history, and summary selects the latest scan by its scan time, not import order. Simultaneous imports can result in a uniqueness conflict; rerun after the other import completes. Duplicate WinGet package IDs are allowed because distinct installed registrations can correlate to the same package.

Tables:

- `Device`: stable local device key and display name.
- `InventorySnapshot`: scan timestamp, import timestamp, warnings, WinGet state, fingerprint, and original validated evidence.
- `RegistryApplication`: per-scan desktop registry inventory.
- `WinGetPackage`: per-scan package identities, versions, source, matching state, and update-availability flag.

Registry and WinGet counts refer to different sets and must not be added together. Failed or unrequested WinGet scans have unknown update counts, represented as `null`, rather than zero. Unmatched packages must not be described as up to date. Available catalog versions are retained as evidence, not treated as approved installation targets.

View data locally with `npm run db:studio`, or use pgAdmin. For example:

```sql
SELECT d."name", s."scannedAt", s."wingetStatus"
FROM "InventorySnapshot" s
JOIN "Device" d ON d."id" = s."deviceId"
ORDER BY s."scannedAt" DESC;
```

## Validation

```powershell
npm run typecheck
npm test
```

Automated checks cover the snapshot contract and fingerprint behavior. Live database validation requires your configured local credentials: check connectivity, apply migrations, import a snapshot twice, confirm the second is a no-op, then inspect the summary. No application updates are executed.

If connection is refused, verify that the PostgreSQL Windows service is running and that the configured port is correct. Authentication errors require checking the local role/password. A missing-table error means the migrations have not been applied to the same database URL. Store inventory and database backups privately; they contain the installed software list.
