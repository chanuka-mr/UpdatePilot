function Get-WinGetInstallerSelection {
    param([string]$Show)
    $typeMatch=[regex]::Match($Show,'(?im)^[ \t]*Installer Type:[ \t]*(?<value>[^\r\n]+?)[ \t]*\r?$')
    $hashMatch=[regex]::Match($Show,'(?im)^[ \t]*Installer SHA256:[ \t]*(?<value>[A-Fa-f0-9]{64})[ \t]*\r?$')
    if (-not ($typeMatch.Success -and $hashMatch.Success)) { return $null }
    [pscustomobject]@{
        InstallerType=$typeMatch.Groups['value'].Value.Trim()
        InstallerSha256=$hashMatch.Groups['value'].Value.ToLowerInvariant()
    }
}
