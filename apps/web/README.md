# UpdatePilot frontend

Next.js 16 App Router dashboard for the local UpdatePilot API. It uses server-only proxies so the browser never receives the backend token or PostgreSQL credentials. All screens use live data; the old demo-data screens and progress simulator have been removed.

## Routes

- `/`: live overview, scan control, agent status, and recent update activity.
- `/applications`: paginated registry/WinGet inventory with live detail links.
- `/applications/[id]`: stored application/package detail.
- `/updates`: update candidates and live update preview.
- `/updates/[id]`: update candidate detail with preview/verification entry points.
- `/updates/[id]/confirm`: preview/verification evidence, acknowledgement, and update start.
- `/updates/executions/[id]`: queued/running/terminal execution progress, job evidence, cancellation for queued jobs, and restart-confirmation scan.
- `/history`: scan history plus update execution history and links to execution details.
- `/security`: curated-package NVD findings for the latest WinGet inventory.
- `/settings`: pairing, revocation, heartbeat status, and scan controls.

## Update flow

The browser submits only `{ recordId }` to preview, verification, update, cancel, and scan controls. The backend resolves and re-binds the exact package, version, installer type, hash, architecture, scope, and execution profile.

Starting an update requires passing verification evidence and the backend execution gate. `UPDATE_EXECUTION_ENABLED=false` is the default. If disabled or blocked, the confirmation screen shows the returned reason; verification alone never enables installation. Machine-scope installers also require an elevated agent process.

The execution screen polls the live backend. Queued jobs can be cancelled; running jobs cannot. Successful execution enters `confirming` and runs a fresh scan, while exit codes 3010/1641 enter `awaiting_restart` until the user confirms the reboot and a confirmation scan runs. Failed, blocked, interrupted, and expired jobs are terminal.

## Security findings

`/security` requests the live local API and displays CVEs matched against a small curated WinGet-to-NVD mapping. Unmapped, unparseable, unavailable, or no-finding packages are labelled explicitly; nothing is guessed.

The backend caches NVD product data for six hours in memory. First checks for large products such as Chrome or Firefox can take minutes without `NVD_API_KEY`; NVD results may lag vendor advisories. This is advisory context, not an update authorization signal.

## Validation

```sh
npm run typecheck
npm run build
npm start
```

In this Windows environment the production build currently succeeds with the standard Next.js compiler. Browser visual verification has not been performed. Start the backend first; routes proxy to the loopback API configured in `.env.local`.
