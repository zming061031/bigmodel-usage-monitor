$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkerDir = Join-Path $Root "cloudflare-refresh-worker"

Push-Location $WorkerDir
try {
  npx wrangler whoami
  if ($LASTEXITCODE -ne 0) {
    throw "Please run: npx wrangler login"
  }

  $githubToken = gh auth token
  if (-not $githubToken) {
    throw "GitHub CLI is not logged in."
  }

  $refreshBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($refreshBytes)
  $refreshToken = [Convert]::ToBase64String($refreshBytes)

  $githubToken | npx wrangler secret put GITHUB_TOKEN
  $refreshToken | npx wrangler secret put REFRESH_TOKEN
  npx wrangler deploy

  "Cloudflare cron worker deployed."
  "It triggers GitHub Actions every hour at minute 7."
  "Manual trigger token was generated and stored as REFRESH_TOKEN."
} finally {
  Pop-Location
}
