#Requires -Version 5.1
<#
.SYNOPSIS
    Downloads and installs the UpdatePilot Windows Agent package.
.DESCRIPTION
    Downloads the latest UpdatePilot Agent ZIP package,
    installs it to %LOCALAPPDATA%\UpdatePilot, and optionally launches
    the pairing flow if UPDATEPILOT_API_URL is set.
.EXAMPLE
    irm https://<your-vercel-domain>/install.ps1 | iex
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallDir = Join-Path $env:LOCALAPPDATA 'UpdatePilot'
$ExePath    = Join-Path $InstallDir 'UpdatePilot.Agent.exe'

# ── 1. Resolve the agent package URL ─────────────────────────────────────────
# Set UPDATEPILOT_AGENT_URL from the hosted dashboard. It must point to the full
# ZIP package produced from the publish folder, for example:
#   https://downloads.example.com/UpdatePilot-Agent-win-x64.zip
$DownloadUrl = if ($env:UPDATEPILOT_AGENT_URL) {
    $env:UPDATEPILOT_AGENT_URL
} else {
    throw 'No agent package URL was supplied. Return to the UpdatePilot Settings page and use its install command.'
}

Write-Host ''
Write-Host '  UpdatePilot Agent Installer' -ForegroundColor Cyan
Write-Host '  ───────────────────────────' -ForegroundColor DarkGray
Write-Host ''

# ── 2. Create install directory ──────────────────────────────────────────────
if (-not (Test-Path $InstallDir)) {
    Write-Host "  Creating $InstallDir ..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

# ── 3. Download and extract the complete agent package ───────────────────────
if (-not $DownloadUrl.EndsWith('.zip', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The agent package URL must point to a .zip file.'
}

$PackagePath = Join-Path $env:TEMP ("UpdatePilot-Agent-" + [guid]::NewGuid().ToString() + '.zip')
$StagePath = Join-Path $env:TEMP ("UpdatePilot-Agent-" + [guid]::NewGuid().ToString())

Write-Host "  Downloading agent package from:" -ForegroundColor Gray
Write-Host "  $DownloadUrl" -ForegroundColor Gray
Write-Host ''

try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $PackagePath -UseBasicParsing
    Expand-Archive -LiteralPath $PackagePath -DestinationPath $StagePath -Force
    $StagedExe = Join-Path $StagePath 'UpdatePilot.Agent.exe'
    if (-not (Test-Path -LiteralPath $StagedExe)) {
        throw 'The ZIP must contain UpdatePilot.Agent.exe at its top level.'
    }
    Copy-Item -Path (Join-Path $StagePath '*') -Destination $InstallDir -Recurse -Force
} catch {
    Write-Host "  ERROR: Agent installation failed. $_" -ForegroundColor Red
    Write-Host ''
    Write-Host '  Make sure the package URL is correct and try again.' -ForegroundColor Yellow
    exit 1
} finally {
    if (Test-Path -LiteralPath $PackagePath) { Remove-Item -LiteralPath $PackagePath -Force }
    if (Test-Path -LiteralPath $StagePath) { Remove-Item -LiteralPath $StagePath -Recurse -Force }
}

Write-Host "  Agent installed to: $ExePath" -ForegroundColor Green
Write-Host ''

# ── 4. Set the API URL env var if provided ────────────────────────────────────
if ($env:UPDATEPILOT_API_URL) {
    Write-Host "  API URL: $env:UPDATEPILOT_API_URL" -ForegroundColor Gray
    # Persist for the current user so --listen picks it up in future sessions
    [System.Environment]::SetEnvironmentVariable('UPDATEPILOT_API_URL', $env:UPDATEPILOT_API_URL, 'User')
    [System.Environment]::SetEnvironmentVariable('UPDATEPILOT_ALLOWED_HOST', ([System.Uri]$env:UPDATEPILOT_API_URL).Host, 'User')
}

# ── 5. Launch pairing if API URL is known ─────────────────────────────────────
if ($env:UPDATEPILOT_API_URL) {
    Write-Host '  Launching pairing wizard...' -ForegroundColor Cyan
    Write-Host ''
    & $ExePath --pair
} else {
    Write-Host '  Next steps:' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '    1. Open the UpdatePilot dashboard → Settings → Generate Pairing Code.'
    Write-Host '    2. Run the following in PowerShell:'
    Write-Host ''
    Write-Host '       $env:UPDATEPILOT_API_URL  = "https://<your-api-host>"' -ForegroundColor Yellow
    Write-Host '       $env:UPDATEPILOT_ALLOWED_HOST = "<your-api-host>"' -ForegroundColor Yellow
    Write-Host "       `"$ExePath`" --pair" -ForegroundColor Yellow
    Write-Host ''
    Write-Host '    3. After pairing, start the listener:'
    Write-Host ''
    Write-Host "       `"$ExePath`" --listen" -ForegroundColor Yellow
    Write-Host ''
}
