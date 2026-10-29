$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
    Import-Module Microsoft.WinGet.Client -ErrorAction Stop -WarningAction Stop
    $module = Get-Module Microsoft.WinGet.Client
    $packages = @(Get-WinGetPackage -Source winget -ErrorAction Stop | ForEach-Object {
        [pscustomobject]@{
            name = [string]$_.Name
            id = [string]$_.Id
            installedVersion = [string]$_.InstalledVersion
            source = [string]$_.Source
            isUpdateAvailable = [bool]$_.IsUpdateAvailable
            availableVersions = @($_.AvailableVersions | ForEach-Object { [string]$_ })
        }
    })

    $result = [pscustomobject]@{
        schemaVersion = 1
        scannedAt = [DateTimeOffset]::UtcNow.ToString('o')
        moduleVersion = $module.Version.ToString()
        packages = $packages
    }
    ConvertTo-Json -InputObject $result -Depth 6 -Compress
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
