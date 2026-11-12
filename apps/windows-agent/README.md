# UpdatePilot Windows agent

The .NET 10 Windows agent performs read-only inventory scans, resolves update metadata, verifies installers, and executes approved updates requested by the local UpdatePilot backend.

## Pair and listen

Start the backend and frontend, open **Settings**, and generate a pairing code. Then from this directory in **Command Prompt**:

```cmd
"C:\Program Files\dotnet\dotnet.exe" run --project .\UpdatePilot.Agent -- --pair
```

Enter the short-lived code at the prompt. Start the listener in a terminal that stays open:

```cmd
"C:\Program Files\dotnet\dotnet.exe" run --project .\UpdatePilot.Agent -- --listen
```

Keep the listener open during scans, previews, verification, and updates. Credentials and pending envelopes are DPAPI-protected under `%LOCALAPPDATA%\UpdatePilot`; do not share that directory. Only one listener may use a state directory at a time.

For nondefault local ports, set `UPDATEPILOT_API_URL` before pairing/listening. Only HTTP loopback addresses are supported. Heartbeats are sent roughly every 10 seconds. Revoke the agent from Settings to invalidate its credential and interrupt queued/running jobs.

## Fixed operations

- `scan`: runs the bundled registry/WinGet inventory scanner and uploads a snapshot.
- `preview`: resolves exact WinGet package metadata for one record. No installer is downloaded.
- `verify`: downloads the version-pinned installer with `winget download`, requires an exact SHA-256 match, checks the Authenticode signature and architecture, then deletes the temporary download. It never launches the installer.
- `update`: re-downloads and re-verifies the exact installer, then launches it silently using an allowlisted profile.

The agent accepts no arbitrary shell command, executable path, installer URL, or browser-supplied hash. Preview, verification, and update requests are server-built and bound to the stored scan.

## Controlled update execution

`UpdateRunner.cs` validates the request, runs `Scripts/Invoke-InstallerUpdate.ps1`, streams fixed progress stages, sends heartbeats, and enforces a 30-minute timeout. The script:

- accepts only `msi-user`, `msi-machine`, `inno-user`, `inno-machine`, `nsis-user`, `nsis-machine`, `burn-user`, and `burn-machine` profiles;
- requires exactly one downloaded file matching the pinned SHA-256;
- rechecks extension, signature, and architecture compatibility;
- requires elevation for machine-scope profiles;
- runs a fixed silent installer invocation and captures the exit code;
- reports exit codes `3010`/`1641` as `restart_required`;
- removes temporary downloads in a `finally` block.

`UPDATE_EXECUTION_ENABLED=false` remains the backend hard gate by default. Do not enable it or test a real installer without explicit approval and a disposable machine or VM. Machine-scope installs require running the agent from an elevated terminal.

## Read-only scanner

```powershell
dotnet run --project .\UpdatePilot.Agent
```

The scanner reads machine and current-user uninstall registrations in both registry views and saves `data/inventory.json`. Run with `--with-winget` to add WinGet inventory; this needs `Microsoft.WinGet.Client` in Windows PowerShell. Registry view is discovery evidence, not confirmed architecture. Portable applications, other users' private installs, and some Store/MSIX entries may be absent. Registry and WinGet counts refer to different sets.

WinGet failures preserve the registry scan and produce exit code 2. Exit codes: `0` complete, `1` snapshot save failure, `2` partial scan warnings.

## Validation

```powershell
dotnet run --project .\UpdatePilot.Agent.Tests
```

The dependency-free checks cover scan contracts, preview selection parsing, installer verification, update-request validation, executed-update evidence, and command/URL rejection.
