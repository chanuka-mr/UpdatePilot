# UpdatePilot Windows agent — read-only inventory

## Update metadata previews

The listening agent also accepts the fixed `preview` job operation. It runs the bundled `Get-UpdatePreview.ps1` with a locally written JSON request, validates the package identifier before launching PowerShell, queries exact WinGet identities, and uploads a read-only metadata result. Heartbeats continue during resolution. No install, download, custom executable, or shell command operation is supported. Unknown architecture, signature/applicability, and release metadata keep installation disabled. Exact product-code matches may resolve installation scope; display names and registry views are not used to guess identity or architecture.

After updating the source, stop an old listener with Ctrl+C, rebuild, and restart `--listen`. Pairing remains valid unless explicitly revoked. Preview uploads use the existing DPAPI-protected pending envelope and lease checks.

## Installer verification

The agent also accepts the fixed `verify` job operation. It runs `Get-InstallerVerification.ps1`, which downloads the exact version-pinned installer selected by the preview into a temporary job folder using `winget download`. The download must produce exactly one file whose SHA-256 matches the preview hash. The script then checks the Authenticode signature, inspects the PE header for `.exe` files or the MSI summary template for `.msi` files, and compares the architecture with the current OS. It deletes the temporary download in a `finally` block and never launches the installer.

The verification result records architecture compatibility, signature status, signer subject and thumbprint, timestamp presence, and publisher-match evidence. The backend re-binds the result to the preview and recomputes publisher matching. A non-valid signature or incompatible/unknown architecture keeps the update safety gate blocked. `UPDATE_EXECUTION_ENABLED` remains `false`, so no update job can run even after successful verification.

The verification job uses a longer lease than scan/preview jobs because installer downloads can take several minutes. Keep the listener open; heartbeats continue during the download.

## Pair and listen for real scan jobs

Start the local backend and frontend. Open Settings in the dashboard and generate a pairing code. In **Command Prompt**, from the `agent` directory, run:

```cmd
"C:\Program Files\dotnet\dotnet.exe" run --project .\UpdatePilot.Agent -- --pair
```

Enter the short-lived code at the prompt (not on the command line). Then run:

```cmd
"C:\Program Files\dotnet\dotnet.exe" run --project .\UpdatePilot.Agent -- --listen
```

In PowerShell, put `&` before the quoted executable path. Keep the listening terminal open and click **Scan Now** on Overview or Settings. The agent executes only the fixed registry/WinGet scanner, uploads its snapshot, and the backend imports it atomically. No manual JSON import is needed for these jobs. A completed job means a snapshot was saved; a partial WinGet scan remains labelled as such inside that snapshot.

Credentials and pending upload envelopes are encrypted with Windows DPAPI for the current user in `%LOCALAPPDATA%\UpdatePilot`. Do not share that directory. Only one listener can use a state directory at once. Stop with Ctrl+C; a running scan is stopped, and an unfinished job eventually becomes interrupted. The agent runs in your user session, not as a Windows service, and requires no elevation for scanning.

For nondefault local ports, set `UPDATEPILOT_API_URL` before pairing/listening. Only HTTP loopback (`localhost` or `127.0.0.1`) is supported. Heartbeats are sent approximately every 10 seconds; the UI treats a heartbeat older than 45 seconds as offline. Server restarts preserve queued/running jobs. Scan and preview jobs expire after ten minutes; verification jobs allow a longer download window. Jobs are never automatically rerun. Pending results are retried after reconnect and deduplicated by job, lease, and result hash. Revoked or expired results are rejected. Generating a new pairing code invalidates older unused codes; successfully pairing replaces prior credentials. Use **Revoke Agent** to revoke credentials and interrupt pending jobs.

This is a local single-user development flow. The existing server-only dashboard token is the local control authority; internet hosting, multi-user authentication, unattended installation, and agent self-update are not enabled.

Prerequisite: .NET 10 SDK on Windows. Run from this directory in a normal, non-administrator PowerShell:

```powershell
dotnet run --project .\UpdatePilot.Agent
```

The scanner reads machine and current-user uninstall registry entries in both registry views, prints a preview, and saves `data/inventory.json` relative to the working directory. It reads the registry without modifying it and performs no installs, updates, network requests, or service registration. Inventory files are ignored by Git.

This is a desktop application registration inventory, not a complete list of every executable. Portable applications without registrations, Store/MSIX discovery, and other users' private installations are outside this milestone. Registry view is recorded as discovery evidence, not as confirmed processor architecture. Hidden system components are excluded; duplicate-looking registrations may represent different installations. Package matches remain `unmatched` until the WinGet adapter is added.

Exit codes: 0 = scan and snapshot complete; 1 = snapshot could not be saved; 2 = snapshot saved with partial scan warnings. Review warnings before interpreting a zero application count.

## WinGet discovery

Install `Microsoft.WinGet.Client` for the current user in Windows PowerShell. Then, from this directory:

```powershell
dotnet run --project .\UpdatePilot.Agent -- --with-winget
```

This launches the bundled fixed script in Windows PowerShell, queries the `winget` source, and adds a `winget` result to `data/inventory.json`. This operation can contact WinGet sources but never executes an application update. It respects PowerShell execution policy. The module must be available to the same Windows user running the agent. Module import errors, source failures, invalid responses, and a two-minute timeout produce a failed WinGet result and exit code 2, while preserving the registry scan in the new snapshot. A failed scan does not reuse previous WinGet results as fresh data.

The result preserves package IDs, installed versions, WinGet's update-availability judgment, available catalog versions, module version, and scan timestamp. Available versions may include older releases; no target version is automatically selected. Registry entries remain unmatched: the two discovery sources must not be joined by display-name similarity. Counts refer to different sets of registrations and packages and must not be added together.

WinGet may return installed ARP and MSIX entries with an empty source even when querying `-Source winget`. These are retained with `matchStatus: "unmatched"`; source-matched entries have `matchStatus: "matched"`. An unmatched entry with `isUpdateAvailable: false` means no update is known through the queried catalog, not that the application is up to date. Unexpected nonempty sources and update claims without a source are still rejected. WinGet's package count can include Store/MSIX registrations beyond the separate desktop registry scan.

Inspect update candidates in PowerShell:

```powershell
$inventory = Get-Content .\data\inventory.json -Raw | ConvertFrom-Json
$inventory.winget.status
$inventory.winget.inventory.packages |
    Where-Object isUpdateAvailable |
    Select-Object name, id, installedVersion, availableVersions |
    Format-Table -AutoSize
```

Run dependency-free JSON contract checks:

```powershell
dotnet run --project .\UpdatePilot.Agent.Tests
```

The next milestone will persist these real scan results behind authenticated backend APIs. An update preview must separately resolve the applicable target, scope, and installer before execution is enabled.
