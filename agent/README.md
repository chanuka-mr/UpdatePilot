# UpdatePilot Windows agent — read-only inventory

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
