param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
    $request=Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
    if ($request.packageId -notmatch '^[A-Za-z0-9][A-Za-z0-9.+_-]{0,199}$') { throw 'Invalid package identity' }
    Import-Module Microsoft.WinGet.Client -ErrorAction Stop -WarningAction Stop
    $result=[ordered]@{schemaVersion=1;packageId=[string]$request.packageId;source='winget';checkedAt=[DateTimeOffset]::UtcNow.ToString('o');installedVersion=[string]$request.installedVersion;targetVersion=$null;publisher=$null;scope='unknown';architecture='unknown';status='blocked';reason='Package identity could not be resolved unambiguously.';signatureVerified=$false;installationEnabled=$false}
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
    $result.status='incomplete'
    $result.reason='Catalog candidate resolved. Installer applicability, architecture, signature, reboot requirements, and release metadata are not verified. Installation remains disabled.'
    ConvertTo-Json -InputObject $result -Depth 4 -Compress
} catch {[Console]::Error.WriteLine('Read-only WinGet preview failed. Check source availability and module compatibility.');exit 1}
