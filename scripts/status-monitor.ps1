$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'BigModel Usage Monitor.lnk'
$Port = 5179

function Get-EnvPort {
  $envFile = Join-Path $Root '.env'
  if (-not (Test-Path $envFile)) {
    return $Port
  }

  $match = Get-Content $envFile |
    Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)\s*$' } |
    Select-Object -First 1

  if ($match -match '^\s*PORT\s*=\s*(\d+)\s*$') {
    return [int]$Matches[1]
  }

  return $Port
}

$Port = Get-EnvPort
$task = Get-ScheduledTask -TaskName 'BigModelUsageMonitor' -ErrorAction SilentlyContinue
$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($task) {
  "Task: $($task.TaskName) / $($task.State)"
} else {
  "Task: not installed"
}

if (Test-Path $ShortcutPath) {
  "Startup shortcut: installed"
} else {
  "Startup shortcut: not installed"
}

if ($listener) {
  "Server: running at http://127.0.0.1:$Port (PID $($listener.OwningProcess))"
} else {
  "Server: not running on http://127.0.0.1:$Port"
}
