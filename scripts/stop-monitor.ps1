$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogDir = Join-Path $Root 'logs'
$PidFile = Join-Path $LogDir 'monitor.pid'
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
$stopped = @()

if (Test-Path $PidFile) {
  $pidValue = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pidValue -match '^\d+$') {
    $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $process.Id -Force
      $stopped += $process.Id
    }
  }
}

$listeners = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
  Stop-Process -Id $listener.OwningProcess -Force
  $stopped += $listener.OwningProcess
}

if ($stopped.Count -gt 0) {
  "Stopped BigModel usage monitor process(es): $($stopped -join ', ')."
} else {
  "BigModel usage monitor is not running on http://127.0.0.1:$Port."
}
