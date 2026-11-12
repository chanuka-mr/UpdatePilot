param(
    [Parameter(Mandatory=$true)][string]$RequestPath,
    [Parameter(Mandatory=$true)][string]$ProgressPath
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$utf8=New-Object System.Text.UTF8Encoding($false)

function Write-Stage([string]$Stage,[int]$Percent,[string]$Message) {
    $value=[ordered]@{stage=$Stage;percent=$Percent;message=$Message}
    try {[System.IO.File]::WriteAllText($ProgressPath,(ConvertTo-Json -InputObject $value -Compress),$utf8)} catch {}
}

function Get-PeArchitecture([string]$Path) {
    $stream=[System.IO.File]::OpenRead($Path)
    try {
        $reader=[System.IO.BinaryReader]::new($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D) { return 'unknown' }
        $stream.Position=0x3C
        $offset=$reader.ReadInt32()
        if ($offset -lt 0 -or $offset -gt $stream.Length - 6) { return 'unknown' }
        $stream.Position=$offset
        if ($reader.ReadUInt32() -ne 0x00004550) { return 'unknown' }
        $machine=$reader.ReadUInt16()
        switch ($machine) {
            0x014C { return 'x86' }
            0x8664 { return 'x64' }
            0xAA64 { return 'arm64' }
            default { return 'unknown' }
        }
    } finally { $stream.Dispose() }
}

function Get-MsiArchitecture([string]$Path) {
    try {
        $installer=New-Object -ComObject WindowsInstaller.Installer
        $database=$installer.OpenDatabase($Path,0)
        $summary=$database.SummaryInformation(0)
        $template=[string]$summary.Property(7)
        if ($template -match '^(x64|Intel64|AMD64)') { return 'x64' }
        if ($template -match '^(Arm64|ARM64)') { return 'arm64' }
        if ($template -match '^(Intel|x86)') { return 'x86' }
        return 'unknown'
    } catch { return 'unknown' }
}

function Test-ArchitectureCompatible([string]$Installer,[string]$Os) {
    if ($Installer -eq 'unknown' -or $Os -eq 'unknown') { return $false }
    if ($Installer -eq 'neutral' -or $Installer -eq $Os) { return $true }
    if ($Os -eq 'x64' -and $Installer -eq 'x86') { return $true }
    if ($Os -eq 'arm64' -and ($Installer -eq 'x86' -or $Installer -eq 'x64')) { return $true }
    return $false
}

$startedAt=[DateTimeOffset]::UtcNow
$directory=$null
$installerStarted=$false
$result=[ordered]@{
    schemaVersion=1;status='blocked';profile='';installerType='';installerSha256='';
    hashMatched=$false;architecture='unknown';architectureCompatible=$false;
    signature=[ordered]@{status='Unknown';signerSubject=$null;signerThumbprint=$null;timestamped=$false};
    exitCode=$null;rebootRequired=$false;reason='Update execution did not start.';
    startedAt=$startedAt.ToString('o');finishedAt=$null
}
try {
    $request=Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
    if ($request.packageId -notmatch '^[A-Za-z0-9][A-Za-z0-9.+_-]{0,199}$') { throw 'Invalid package identity' }
    if ([string]::IsNullOrWhiteSpace([string]$request.targetVersion)) { throw 'Invalid target version' }
    if ([string]$request.installerSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid installer hash' }
    if ([string]$request.installerType -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw 'Invalid installer type' }
    if ($request.scope -notin @('user','machine')) { throw 'Invalid installation scope' }
    $result.profile=[string]$request.profile
    $result.installerType=[string]$request.installerType
    $result.installerSha256=([string]$request.installerSha256).ToLowerInvariant()

    $family=switch (([string]$request.installerType).ToLowerInvariant()) {
        'msi' { 'msi' }
        'wix' { 'msi' }
        'inno' { 'inno' }
        'nullsoft' { 'nsis' }
        'nsis' { 'nsis' }
        'burn' { 'burn' }
        default { $null }
    }
    $expectedProfile=if ($family) {"$family-$($request.scope)"} else {$null}
    if (-not $expectedProfile -or [string]$request.profile -ne $expectedProfile) { throw 'Execution profile is not allowlisted for this installer type.' }

    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($request.scope -eq 'machine' -and -not $isAdmin) {
        $result.status='blocked'
        $result.reason='Administrator elevation is required for this machine-scope installer. Start the agent from an elevated terminal, then request a fresh update.'
    } else {
        Write-Stage 'preparing' 5 'Preparing the verified installer workspace.'
        $directory=Join-Path (Split-Path -Parent $RequestPath) 'update-download'
        if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
        New-Item -ItemType Directory -Path $directory | Out-Null

        Write-Stage 'downloading' 20 'Downloading the exact target version with WinGet.'
        $winget=(Get-Command winget.exe -ErrorAction Stop).Source
        $wingetArgs=@('download','--id',$request.packageId,'--exact','--version',$request.targetVersion,'--source','winget','--download-directory',$directory,'--accept-source-agreements','--accept-package-agreements','--disable-interactivity','--skip-dependencies')
        & $winget @wingetArgs *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Installer download failed.' }

        Write-Stage 'verifying' 50 'Rechecking SHA-256, signature, architecture, and execution profile.'
        $expected=([string]$request.installerSha256).ToLowerInvariant()
        $hashMatches=@()
        foreach ($file in Get-ChildItem -LiteralPath $directory -Recurse -File) {
            $hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hash -ceq $expected) { $hashMatches += $file }
        }
        if ($hashMatches.Count -ne 1) { throw 'Downloaded installer hash did not match exactly one file.' }
        $installer=$hashMatches[0]
        $result.hashMatched=$true
        if ($family -eq 'msi' -and $installer.Extension -ne '.msi') { throw 'Downloaded installer type does not match the allowlisted MSI profile.' }
        if ($family -ne 'msi' -and $installer.Extension -eq '.msi') { throw 'Downloaded installer type does not match the allowlisted executable profile.' }

        $signature=Get-AuthenticodeSignature -LiteralPath $installer.FullName
        $signatureStatus=switch ([string]$signature.Status) {
            'Valid' { 'Valid' }
            'NotSigned' { 'NotSigned' }
            'HashMismatch' { 'HashMismatch' }
            'NotTrusted' { 'NotTrusted' }
            default { 'Unknown' }
        }
        $signerSubject=if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null }
        $signerThumbprint=if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { $null }
        $timestamped=($null -ne $signature.TimeStamperCertificate)
        $result.signature=[ordered]@{status=$signatureStatus;signerSubject=$signerSubject;signerThumbprint=$signerThumbprint;timestamped=$timestamped}

        $extension=$installer.Extension.ToLowerInvariant()
        $architecture=if ($extension -eq '.msi') { Get-MsiArchitecture $installer.FullName } else { Get-PeArchitecture $installer.FullName }
        $osArchitecture=switch ($(if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE })) {
            'AMD64' { 'x64' }
            'ARM64' { 'arm64' }
            'x86' { 'x86' }
            default { 'unknown' }
        }
        $architectureCompatible=Test-ArchitectureCompatible $architecture $osArchitecture
        $result.architecture=$architecture
        $result.architectureCompatible=$architectureCompatible

        if ($signatureStatus -ne 'Valid' -or -not $architectureCompatible) {
            $result.status='blocked'
            $result.reason=if ($signatureStatus -ne 'Valid') {'The downloaded installer signature is not valid.'} else {'The downloaded installer architecture is not compatible with this device.'}
        } else {
            Write-Stage 'installing' 75 'Running the allowlisted silent installer profile.'
            $installerStarted=$true
            if ($family -eq 'msi') {
                & msiexec.exe /i $installer.FullName /qn /norestart
            } elseif ($family -eq 'inno') {
                & $installer.FullName /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-
            } elseif ($family -eq 'nsis') {
                & $installer.FullName /S
            } else {
                & $installer.FullName /quiet /norestart
            }
            $exitCode=$LASTEXITCODE
            $result.exitCode=$exitCode
            $result.rebootRequired=($exitCode -eq 3010 -or $exitCode -eq 1641)
            if ($exitCode -eq 0) {
                $result.status='succeeded'
                $result.reason='Installer completed successfully.'
            } elseif ($exitCode -eq 3010 -or $exitCode -eq 1641) {
                $result.status='restart_required'
                $result.reason="Installer completed and requires a restart (exit code $exitCode)."
            } else {
                $result.status='failed'
                $result.reason="Installer exited with code $exitCode."
            }
        }
    }
} catch {
    $result.status=if ($installerStarted) {'failed'} else {'blocked'}
    $result.reason=if ($installerStarted) {'The installer execution failed before a result could be confirmed.'} else {$_.Exception.Message}
} finally {
    if ($directory -and (Test-Path -LiteralPath $directory)) {
        try {Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue} catch {}
    }
}
$result.finishedAt=[DateTimeOffset]::UtcNow.ToString('o')
ConvertTo-Json -InputObject $result -Depth 4 -Compress
