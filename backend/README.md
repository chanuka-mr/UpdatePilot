# UpdatePilot PostgreSQL backend

## Read-only dashboard API

The overview now reads the latest imported scan through `GET /api/v1/dashboard`. This local development API binds to `127.0.0.1:4010` and requires a bearer token. It serves only the device selected by backend `DEVICE_KEY` (default `local-pc`). It is not a multi-user authentication or pairing system and must not be exposed publicly.

From `backend`, run `node scripts/configure-local-api.mjs` once. It generates matching private API tokens in backend `.env` and frontend `.env.local` without printing them or changing database credentials. Then start `npm run dev` in backend and `npm run dev` in frontend in separate terminals. Restart both after configuration changes. The frontend server proxies `/api/dashboard`; the browser never receives the backend credential or database URL.

The overview handles loading, unavailable backend/database, missing scans, failed catalog scans, and scans older than 24 hours. No scan jobs or installations are executed. Other frontend pages remain labelled samples for now. Update counts are unknown for failed/unrequested WinGet scans. Preview rows do not infer approved target versions from available catalog versions.

Verify the overview against `npm run db:summary -- --device-key local-pc`. A different device key requires changing backend `DEVICE_KEY`, not passing arbitrary device identifiers from a browser.

This milestone stores the agent's JSON snapshot in a local PostgreSQL database using TypeScript and Prisma ORM 7. It has a local command-line importer, not an HTTP server. The browser and agent do not receive database credentials. Automatic uploads, pairing, and frontend APIs are later milestones.

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
cd "C:\Users\jchan\OneDrive\Desktop\D\Gamage\New folder\UpdatePilot\backend"
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
npm run db:import -- --file "../agent/data/inventory.json" --device-key "local-pc" --device-name "My Windows PC"
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
