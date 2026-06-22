$ErrorActionPreference = 'Stop'

$TaskName = 'BigModelUsageMonitor'
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'BigModel Usage Monitor.lnk'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($task) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  "Removed scheduled task: $TaskName."
} else {
  "Scheduled task is not installed: $TaskName."
}

if (Test-Path $ShortcutPath) {
  Remove-Item -LiteralPath $ShortcutPath -Force
  "Removed Startup shortcut: $ShortcutPath."
} else {
  "Startup shortcut is not installed."
}
