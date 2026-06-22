param(
  [string]$DashboardUser = "admin",
  [string]$DashboardPassword = $env:DASHBOARD_PASSWORD,
  [int]$Port = 5179,
  [string]$AllowedOrigins = $env:ALLOWED_ORIGINS,
  [switch]$OpenFirewall
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if (-not $DashboardPassword) {
  $securePassword = Read-Host "Dashboard write password" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $DashboardPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if (-not $DashboardPassword) {
  throw "DASHBOARD_PASSWORD is required for permanent cloud mode."
}

$envPath = Join-Path $Root ".env"
$statePath = ".\data\usage-state.json"
$envLines = @(
  "HOST=0.0.0.0",
  "PORT=$Port",
  "PUBLIC_QUERY_ONLY=true",
  "PUBLIC_USAGE_READ=true",
  "DASHBOARD_USER=$DashboardUser",
  "DASHBOARD_PASSWORD=$DashboardPassword",
  "USAGE_STATE_FILE=$statePath",
  "LIVE_POLL_MS=3600000"
)

if ($AllowedOrigins) {
  $envLines += "ALLOWED_ORIGINS=$AllowedOrigins"
}

Set-Content -LiteralPath $envPath -Value ($envLines -join [Environment]::NewLine) -Encoding ascii
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data"), (Join-Path $Root "logs") | Out-Null

Push-Location $Root
try {
  npm ci
  npm run build
  npm run service:install

  [Environment]::SetEnvironmentVariable("BIGMODEL_MONITOR_URL", "http://127.0.0.1:$Port", "User")
  [Environment]::SetEnvironmentVariable("CAPTURE_MONITOR_AUTH", "$DashboardUser`:$DashboardPassword", "User")
  $env:BIGMODEL_MONITOR_URL = "http://127.0.0.1:$Port"
  $env:CAPTURE_MONITOR_AUTH = "$DashboardUser`:$DashboardPassword"

  npm run capture:install
} finally {
  Pop-Location
}

if ($OpenFirewall) {
  $ruleName = "BigModel Usage Monitor $Port"
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-NetFirewallRule `
      -DisplayName $ruleName `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $Port | Out-Null
  }
}

"Permanent cloud service installed."
"Website service: http://127.0.0.1:$Port"
"Public read endpoints: /api/usage and /api/config"
"Protected write/import endpoints use Basic Auth user '$DashboardUser'."
"Next: run npm run capture:web-session once in the cloud VM RDP session and log in to BigModel."
