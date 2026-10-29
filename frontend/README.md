# UpdatePilot frontend

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
