$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$monitorUrl = $env:BIGMODEL_MONITOR_URL
if (-not $monitorUrl) {
  $monitorUrl = "http://127.0.0.1:5179"
}

function Test-HttpOk {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

if (-not (Test-HttpOk "$monitorUrl/api/health")) {
  Write-Host "Local monitor is not running. Starting service..."
  Push-Location $projectRoot
  try {
    npm run service:start | Out-Null
  } finally {
    Pop-Location
  }

  $healthy = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-HttpOk "$monitorUrl/api/health") {
      $healthy = $true
      break
    }
  }

  if (-not $healthy) {
    throw "Local monitor did not start at $monitorUrl."
  }
}

$browserCandidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)

$browserExe = $browserCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browserExe) {
  throw "Cannot find Microsoft Edge or Google Chrome."
}

function Test-PortOpen {
  param([int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $connected = $result.AsyncWaitHandle.WaitOne(120)
    if ($connected) {
      $client.EndConnect($result)
      return $true
    }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

$port = 9337
while (Test-PortOpen $port) {
  $port++
}

$profileDir = $env:BIGMODEL_CAPTURE_PROFILE_DIR
if (-not $profileDir) {
  $profileDir = Join-Path $env:LOCALAPPDATA "bigmodel-usage-monitor\browser-profile"
}
New-Item -ItemType Directory -Force $profileDir | Out-Null

$profilePattern = [regex]::Escape($profileDir)
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -in @("msedge.exe", "chrome.exe", "node.exe")) -and
    (($_.CommandLine -match $profilePattern) -or ($_.CommandLine -match "capture-web-session"))
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

$arguments = @(
  "--remote-debugging-port=$port",
  "--remote-allow-origins=*",
  "--user-data-dir=$profileDir",
  "--no-first-run",
  "--new-window",
  "about:blank"
)

Write-Host "Opening browser for BigModel login..."
Write-Host "Use the browser window to log in and open the usage page. No token or cookie will be printed."
Write-Host "Browser profile: $profileDir"

$browserProcess = Start-Process -FilePath $browserExe -ArgumentList $arguments -PassThru

$env:CAPTURE_CDP_PORT = [string]$port
$env:CAPTURE_MONITOR_URL = $monitorUrl
$env:CAPTURE_BROWSER_PID = [string]$browserProcess.Id
$env:CAPTURE_PROFILE_DIR = $profileDir

$captureSucceeded = $false
try {
  node (Join-Path $projectRoot "scripts\capture-web-session.mjs")
  if ($LASTEXITCODE -eq 0) {
    $captureSucceeded = $true
  } else {
    throw "Capture script exited with code $LASTEXITCODE."
  }
} finally {
  if ($captureSucceeded) {
    Write-Host "Capture completed. The browser window is left open for you to check the monitor page."
  } else {
    Write-Host "Closing capture browser..."
    try {
      if (-not $browserProcess.HasExited) {
        $browserProcess.CloseMainWindow() | Out-Null
        Start-Sleep -Seconds 2
        if (-not $browserProcess.HasExited) {
          $browserProcess.Kill()
        }
      }
    } catch {
    }
  }

  Write-Host "The browser profile is kept so you do not need to log in again next time."
}
