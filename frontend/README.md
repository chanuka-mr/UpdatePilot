# UpdatePilot frontend

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
