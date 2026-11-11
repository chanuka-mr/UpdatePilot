param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)

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

$directory=$null
try {
    $request=Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
    if ($request.packageId -notmatch '^[A-Za-z0-9][A-Za-z0-9.+_-]{0,199}$') { throw 'Invalid package identity' }
    if ([string]::IsNullOrWhiteSpace([string]$request.targetVersion)) { throw 'Invalid target version' }
    if ([string]$request.installerSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid installer hash' }
    if ([string]$request.installerType -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw 'Invalid installer type' }
    if ($request.scope -notin @('user','machine')) { throw 'Invalid installation scope' }

    $directory=Join-Path (Split-Path -Parent $RequestPath) 'download'
    if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
    New-Item -ItemType Directory -Path $directory | Out-Null

    $winget=(Get-Command winget.exe -ErrorAction Stop).Source
    # Let WinGet choose the same device-appropriate installer as an install would.
    # The preview SHA-256, not scope/type flags, is the binding that must match.
    $arguments=@('download','--id',$request.packageId,'--exact','--version',$request.targetVersion,'--source','winget','--download-directory',$directory,'--accept-source-agreements','--accept-package-agreements','--disable-interactivity','--skip-dependencies')
    & $winget @arguments *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Installer download failed' }

    $expected=[string]$request.installerSha256
    $hashMatches=@()
    foreach ($file in Get-ChildItem -LiteralPath $directory -Recurse -File) {
        $hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -ceq $expected.ToLowerInvariant()) { $hashMatches += $file }
    }
    if ($hashMatches.Count -ne 1) { throw 'Downloaded installer hash did not match exactly one file' }
    $installer=$hashMatches[0]

    $signature=Get-AuthenticodeSignature -LiteralPath $installer.FullName
    $status=switch ([string]$signature.Status) {
        'Valid' { 'Valid' }
        'NotSigned' { 'NotSigned' }
        'HashMismatch' { 'HashMismatch' }
        'NotTrusted' { 'NotTrusted' }
        default { 'Unknown' }
    }
    $signerSubject=if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null }
    $signerThumbprint=if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { $null }
    $timestamped=($null -ne $signature.TimeStamperCertificate)

    $extension=$installer.Extension.ToLowerInvariant()
    $architecture=if ($extension -eq '.msi') { Get-MsiArchitecture $installer.FullName } else { Get-PeArchitecture $installer.FullName }
    $osArchitecture=switch ($(if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE })) {
        'AMD64' { 'x64' }
        'ARM64' { 'arm64' }
        'x86' { 'x86' }
        default { 'unknown' }
    }

    $result=[ordered]@{
        schemaVersion=1
        packageId=[string]$request.packageId
        targetVersion=[string]$request.targetVersion
        installerType=[string]$request.installerType
        installerSha256=$expected.ToLowerInvariant()
        architecture=$architecture
        architectureCompatible=(Test-ArchitectureCompatible $architecture $osArchitecture)
        hashMatched=$true
        signature=[ordered]@{status=$status;signerSubject=$signerSubject;signerThumbprint=$signerThumbprint;timestamped=$timestamped}
        publisherMatch='unverified'
        verifiedAt=[DateTimeOffset]::UtcNow.ToString('o')
        installationEnabled=$false
    }
    ConvertTo-Json -InputObject $result -Depth 4 -Compress
} catch {
    [Console]::Error.WriteLine('Installer verification failed. The installer was not executed.')
    exit 1
} finally {
    if ($directory -and (Test-Path -LiteralPath $directory)) { Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue }
}
