$ErrorActionPreference='Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'UpdatePilot.Agent\Scripts\Get-WinGetInstallerSelection.ps1')
$hash='979a295b6a68881c9ae7a70c7ba117c26316ecdf9d6afa9dd66b048225df5de9'
$sample="Installer:`r`n  Installer Type: exe`r`n  Installer Url: https://download.anydesk.com/AnyDesk.exe`r`n  Installer SHA256: $hash`r`n  Offline Distribution Supported: true`r`n"
$selection=Get-WinGetInstallerSelection -Show $sample
if ($null -eq $selection) { throw 'Indented installer selection was not parsed.' }
if ($selection.InstallerType -cne 'exe') { throw 'Installer type was not parsed exactly.' }
if ($selection.InstallerSha256 -cne $hash) { throw 'Installer hash was not parsed exactly.' }
if ($null -ne (Get-WinGetInstallerSelection -Show "  Installer Type: exe`r`n")) { throw 'Incomplete selection was accepted.' }
Write-Output 'Preview selection parser checks passed.'
