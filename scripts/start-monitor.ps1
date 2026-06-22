param(
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogDir = Join-Path $Root 'logs'
$OutLog = Join-Path $LogDir 'service.out.log'
$ErrLog = Join-Path $LogDir 'service.err.log'
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

function Get-Listener {
  param([int]$ListenPort)

  Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Port = Get-EnvPort
$listener = Get-Listener -ListenPort $Port

if ($listener) {
  "BigModel usage monitor already listens on http://127.0.0.1:$Port (PID $($listener.OwningProcess))."
  exit 0
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$serverScript = Join-Path $Root 'server\index.js'

if ($Foreground) {
  Push-Location $Root
  try {
    "[$(Get-Date -Format o)] Starting foreground monitor on port $Port" | Add-Content $OutLog
    & $node $serverScript 1>> $OutLog 2>> $ErrLog
    exit $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
}

$process = Start-Process `
  -FilePath $node `
  -ArgumentList @($serverScript) `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -PassThru

$process.Id | Set-Content -Path $PidFile -Encoding ascii
Start-Sleep -Seconds 2

$listener = Get-Listener -ListenPort $Port
if ($listener) {
  "BigModel usage monitor started on http://127.0.0.1:$Port (PID $($listener.OwningProcess))."
  exit 0
}

"BigModel usage monitor was started, but port $Port is not listening yet. Check $ErrLog."
exit 1
