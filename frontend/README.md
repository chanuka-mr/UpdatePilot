# UpdatePilot frontend

## Connected application and update lists

`/applications` and `/updates` now use the local backend and PostgreSQL through server-only proxies. Applications provides separate Desktop registry and WinGet inventory tabs. Search, filters, textual sorting, and ten-row pagination execute on the backend. An inline native dialog displays the selected stored registration/package without linking to the illustrative update installer. Available catalog versions may be historical releases and are not approved update targets. All lists handle loading, errors, no scan, no matches, unavailable WinGet data, and stale scans. Refresh reloads stored data only.

Standalone `/applications/[id]`, `/updates/[id]`, progress, and history routes remain labelled demo screens. They are not used as destinations from real inventory records. Both backend and frontend must be running; no additional migration is required for this milestone.

## PostgreSQL overview

The `/` overview now loads the latest imported scan through the private local backend API. Other screens still use labelled demo data. From `backend`, run `node scripts/configure-local-api.mjs` once, then `npm run dev`. In a separate terminal start this frontend with `npm run dev` and open `http://localhost:3000`. The API uses the backend `DEVICE_KEY` (default `local-pc`). No browser database connection is required.

The overview's refresh button reloads stored database data; it does not run the Windows agent. Import a fresh scan using the backend CLI to update the data. Counts from a failed or unrequested WinGet scan are shown as unknown. Catalog version arrays are not treated as approved installation targets. The live agent status remains unknown until pairing and heartbeat support exists.

The API secret is server-only in `.env.local`; never use a `NEXT_PUBLIC_` prefix. Both servers bind to loopback for this local development milestone. Multi-user authorization and remote deployment are not implemented. Restart servers after changing environment files.

## Screen routes and source structure

- `/`: overview.
- `/applications`: searchable and paginated installed applications.
- `/applications/google-chrome`: application details (other demo IDs are supported).
- `/updates`: searchable available updates.
- `/updates/google-chrome`: update preview and confirmation.
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
