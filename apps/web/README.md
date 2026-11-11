# UpdatePilot frontend

## Agent-resolved update preview

Real update candidates on `/updates` (and the WinGet application inventory view) now provide **Resolve update preview**. Start the updated paired agent, run a fresh scan, and select a candidate. The dialog queues a read-only agent job and polls its result. It displays live installed/catalog candidate versions, catalog publisher, source, exact-identifier scope when available, and query time. Changed/ambiguous installations and unavailable metadata are explicit states. Unknown installer architecture, signature, applicability, reboot needs, release dates, and notes remain labelled as unknown/not verified. **Installation disabled** is intentional. No real candidate links into the standalone demo installer routes. A resolved preview exposes **Review and confirm**, which opens `/updates/<record-id>/confirm` with the installed/target versions, installer type, SHA-256, scope, and agent warnings. Confirmation requires an explicit checkbox acknowledgement and does not download, execute, or install anything.

Preview jobs and scan jobs share one per-device execution slot. The dialog follows its requested latest job; if another job supersedes status, request a fresh preview after it finishes. Closing a dialog does not cancel a queued job. Results remain stored in PostgreSQL but are not scan-history or install-history events. Existing servers started with `npm start` and old agent listeners must be restarted after updating; the additive preview migration must be applied.

## Hard-blocked update execution foundation

The backend now recognizes a server-built `update` job operation, and the Windows agent acknowledges it with a safe `update_blocked` result. A browser request to `/api/v1/control/update` may supply only `{recordId}`; the backend re-derives the exact package ID, installed version, target version, installer type, and SHA-256 from the latest stored scan and the latest completed preview. No commands, installer URLs, or browser-provided hashes are accepted.

Update job creation is gated by `UPDATE_EXECUTION_ENABLED` (default `false`), known scope, a matching verification job, a known compatible architecture, and a valid installer signature. The agent never runs `winget upgrade` or arbitrary PowerShell in this milestone. Post-update re-scanning, version verification, and install history remain future work.

## Installer verification

The confirmation page offers **Verify installer**. It posts only `{recordId}` to `/api/agent/verify`, which queues a separate read-only `verify` job. The agent downloads the exact version-pinned installer with `winget download` into a temporary job folder, requires exactly one downloaded file to match the preview SHA-256, checks the Authenticode signature, and inspects PE or MSI architecture. It deletes the temporary files and uploads evidence; it never executes the installer.

The backend re-binds the evidence to the stored preview and scan, recomputes publisher-match evidence, and stores it on the verify job. Execution remains disabled: verification only populates architecture and signature evidence, and the safety gate still returns a structured blocked response for any update request. Apply the additive verification migration and restart the backend and agent listener before using this screen.

## Real Scan Now and agent settings

Settings now provides pairing, revocation, heartbeat status, and scan-job controls. Generate a pairing code, run the agent with `--pair` and then `--listen` as described in `../windows-agent/README.md`, and keep its terminal open. Overview includes the same real Scan Now control. Pairing codes expire after five minutes. Status polls every five seconds; a scan initiated in that page refreshes it when the job completes. Reloading the page still shows the latest persisted job, but may require Refresh stored data after completion. The UI never receives the device credential or database password.

Scan Now requires a recent agent heartbeat and queues only a read-only scan. It does not install applications. Revoke Agent invalidates the credential and interrupts queued/running jobs. Refresh stored data continues to reload PostgreSQL without starting a scan. This local control flow requires the additive agent-job migrations and a running backend.

## Connected scan history

`/history` now uses PostgreSQL through `/api/history`. Search accepts a device name or full scan UUID; filters target WinGet state. Ten-row pages can be ordered by scan time. Details show the real scan/import times, separate inventory counts, unknown catalog counts for incomplete scans, and recorded warnings. Export this page downloads only the currently visible filtered page; Export scan details includes one record and its diagnostics. Exports contain private local inventory metadata. No fabricated update events, hashes, or traces appear on the live history screen. No migration is required.

## Connected application and update lists

`/applications` and `/updates` now use the local backend and PostgreSQL through server-only proxies. Applications provides separate Desktop registry and WinGet inventory tabs. Search, filters, textual sorting, and ten-row pagination execute on the backend. An inline native dialog displays the selected stored registration/package without linking to the illustrative update installer. Available catalog versions may be historical releases and are not approved update targets. All lists handle loading, errors, no scan, no matches, unavailable WinGet data, and stale scans. Refresh reloads stored data only.

Standalone `/applications/[id]`, `/updates/[id]`, and progress routes remain labelled demo screens. They are not used as destinations from real inventory records. Both backend and frontend must be running; no additional migration is required for this milestone.

## PostgreSQL overview

The `/` overview now loads the latest imported scan through the private local backend API. Standalone detail, preview, and progress screens still use labelled demo data. From `backend`, run `node scripts/configure-local-api.mjs` once, then `npm run dev`. In a separate terminal start this frontend with `npm run dev` and open `http://localhost:3000`. The API uses the backend `DEVICE_KEY` (default `local-pc`). No browser database connection is required.

The overview's refresh button reloads stored database data; it does not run the Windows agent. Import a fresh scan using the backend CLI to update the data. Counts from a failed or unrequested WinGet scan are shown as unknown. Catalog version arrays are not treated as approved installation targets. The live agent status remains unknown until pairing and heartbeat support exists.

The API secret is server-only in `.env.local`; never use a `NEXT_PUBLIC_` prefix. Both servers bind to loopback for this local development milestone. Multi-user authorization and remote deployment are not implemented. Restart servers after changing environment files.

## Screen routes and source structure

- `/`: overview.
- `/applications`: searchable and paginated installed applications.
- `/applications/google-chrome`: application details (other demo IDs are supported).
- `/updates`: searchable available updates.
- `/updates/google-chrome`: update preview and confirmation.
- `/updates/<record-id>/confirm`: live agent-resolved confirmation. Shows installer identity metadata and warnings; acknowledgement only, no installation.
- `/updates/google-chrome/progress`: installation and result-state previews.
- `/history`: activity filters, event detail dialog, and sample JSON exports.
- `/security` and `/settings`: supporting preview pages.

`app/` contains route entry points. `components/layout/` owns the shared responsive navigation shell, `components/ui/` contains reusable display controls, `features/` owns inventory, updates, and history behavior, and `lib/demo-data.ts` holds illustrative records. Browser navigation and deep links are supported. Unknown application IDs return 404.

All screens are labelled as sample data. Scan previews and update flows do not call the agent or backend, and the progress outcome selector does not run an installer. History exports contain illustrative records. Database/API wiring is intentionally deferred for this UI milestone. Filters and preview preferences are local page state.

Next.js App Router, TypeScript, and Tailwind CSS implementation of `../example`.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000.

```sh
npm run typecheck
npm run build
npm start
```

The responsive dashboard includes application search, security filters, simulated scanning, release detail dialogs, staging history, notifications, and agent connection previews in Settings. Data and staging are local demo state and reset on refresh. No Windows agent or deployment backend is connected. The four application records reproduce the provided example; the summary totals are its illustrative fleet totals.

## Validation in this Windows environment

TypeScript validation passed. The production build passed using the matching WebAssembly compiler and webpack because the native Windows SWC binary failed to load in this environment. The fallback was invoked in PowerShell with:

```powershell
$env:NEXT_TEST_WASM = '1'
$env:NEXT_TEST_WASM_DIR = Join-Path (Get-Location) 'node_modules/@next/swc-wasm-nodejs'
npm run build -- --webpack
```

These environment variables apply only to the current terminal session. Normal development and build scripts use the standard Next.js compiler. Browser visual verification has not been performed.
