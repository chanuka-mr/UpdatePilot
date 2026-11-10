param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
    $request=Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
    if ($request.packageId -notmatch '^[A-Za-z0-9][A-Za-z0-9.+_-]{0,199}$') { throw 'Invalid package identity' }
    Import-Module Microsoft.WinGet.Client -ErrorAction Stop -WarningAction Stop
    $result=[ordered]@{schemaVersion=1;packageId=[string]$request.packageId;source='winget';checkedAt=[DateTimeOffset]::UtcNow.ToString('o');installedVersion=[string]$request.installedVersion;targetVersion=$null;publisher=$null;scope='unknown';architecture='unknown';installerType=$null;installerSha256=$null;selectionValidated=$false;status='blocked';reason='Package identity could not be resolved unambiguously.';signatureVerified=$false;installationEnabled=$false}
    $installed=@(Get-WinGetPackage -Id $request.packageId -Source winget -MatchOption Equals | Where-Object { $_.Id -ceq $request.packageId -and $_.Source -eq 'winget' })
    if ($installed.Count -ne 1) { ConvertTo-Json -InputObject $result -Compress; exit 0 }
    $result.installedVersion=[string]$installed[0].InstalledVersion
    if ($result.installedVersion -cne $request.installedVersion) { $result.reason='Installed version changed since the selected scan. Run a fresh scan.';ConvertTo-Json -InputObject $result -Compress;exit 0 }
    if (-not $installed[0].IsUpdateAvailable) {$result.status='no-update';$result.reason='WinGet no longer reports an available update. Run a fresh scan.';ConvertTo-Json -InputObject $result -Compress;exit 0}
    $catalog=@(Find-WinGetPackage -Id $request.packageId -Source winget -MatchOption Equals | Where-Object {$_.Id -ceq $request.packageId -and $_.Source -eq 'winget'})
    if ($catalog.Count -ne 1) {ConvertTo-Json -InputObject $result -Compress;exit 0}
    $result.targetVersion=[string]$catalog[0].Version
    $versionInfo=$catalog[0].GetPackageVersionInfo($result.targetVersion)
    $result.publisher=[string]$versionInfo.Publisher
    # Exact catalog product identifiers only. Never correlate by display-name similarity.
    $scopes=@()
    $views=@([Microsoft.Win32.RegistryView]::Registry32)
    if ([Environment]::Is64BitOperatingSystem) {$views+= [Microsoft.Win32.RegistryView]::Registry64}
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($view in $views) {
            $root=$null;$uninstall=$null
            try {
                $root=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
                $uninstall=$root.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',$false)
                if ($null -eq $uninstall) {continue}
                foreach ($key in $uninstall.GetSubKeyNames()) {
                    if (@($versionInfo.ProductCodes) -contains $key) {
                        if ($hive -eq [Microsoft.Win32.RegistryHive]::LocalMachine) {$scopes+='machine'} else {$scopes+='user'}
                    }
                }
            } finally {if($uninstall){$uninstall.Dispose()};if($root){$root.Dispose()}}
        }
    }
    $unique=@($scopes | Sort-Object -Unique)
    if ($unique.Count -eq 1) {$result.scope=$unique[0]}
    # `winget show` chooses an installer for this device without downloading or
    # executing it. Only accept a version-pinned, exact-ID result with a declared
    # type and SHA-256. Text that cannot be parsed exactly is deliberately ignored.
    $winget=(Get-Command winget.exe -ErrorAction Stop).Source
    $show=& $winget show --id $request.packageId --exact --version $result.targetVersion --source winget --accept-source-agreements --disable-interactivity 2>$null | Out-String
    if ($LASTEXITCODE -eq 0) {
        $typeMatch=[regex]::Match($show,'(?im)^Installer Type:\s*(?<value>[^\r\n]+)\s*$')
        $hashMatch=[regex]::Match($show,'(?im)^Installer SHA256:\s*(?<value>[A-Fa-f0-9]{64})\s*$')
        if ($typeMatch.Success -and $hashMatch.Success) {
            $result.installerType=$typeMatch.Groups['value'].Value.Trim()
            $result.installerSha256=$hashMatch.Groups['value'].Value.ToLowerInvariant()
            $result.selectionValidated=$true
        }
    }
    $result.status='incomplete'
    if ($result.selectionValidated) {$result.reason='WinGet selected a version-pinned installer for this device and declared its type and SHA-256. Architecture, installed-to-selected scope compatibility, signature verification, reboot requirements, and release metadata are not verified. Installation remains disabled.'}
    else {$result.reason='Catalog candidate resolved, but an exact WinGet installer selection with a declared type and SHA-256 could not be confirmed. Installation remains disabled.'}
    ConvertTo-Json -InputObject $result -Depth 4 -Compress
} catch {[Console]::Error.WriteLine('Read-only WinGet preview failed. Check source availability and module compatibility.');exit 1}
