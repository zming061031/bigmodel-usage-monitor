$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TaskName = 'BigModelUsageMonitor'
$ShortcutName = 'BigModel Usage Monitor.lnk'
$StartScript = Join-Path $PSScriptRoot 'start-monitor.ps1'
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`" -Foreground"

$Command = "`"$PowerShell`" $Arguments"
$createArgs = @(
  '/Create',
  '/TN', $TaskName,
  '/TR', $Command,
  '/SC', 'ONLOGON',
  '/RL', 'LIMITED',
  '/F'
)

$installedTask = $false

try {
  & schtasks.exe @createArgs 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks.exe exit code: $LASTEXITCODE"
  }
  $installedTask = $true
  "Installed scheduled task: $TaskName."
}
catch {
  $startupDir = [Environment]::GetFolderPath('Startup')
  if (-not $startupDir) {
    throw "Could not locate the current user's Startup folder."
  }

  $shortcutPath = Join-Path $startupDir $ShortcutName
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $PowerShell
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $Root
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Run the local BigModel usage monitor after Windows logon.'
  $shortcut.Save()

  "Scheduled task was unavailable, installed Startup shortcut instead: $shortcutPath"
}

if ($installedTask) {
  Start-ScheduledTask -TaskName $TaskName
} else {
  & (Join-Path $PSScriptRoot 'start-monitor.ps1')
}

Start-Sleep -Seconds 3

& (Join-Path $PSScriptRoot 'status-monitor.ps1')
