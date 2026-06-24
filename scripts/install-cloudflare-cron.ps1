param(
  [switch]$Verify,
  [string]$WorkerUrl = "https://bigmodel-usage-refresh.zming061031.workers.dev"
)

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
  $refreshToken = [Convert]::ToBase64String($refreshBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

  $secretFile = Join-Path ([System.IO.Path]::GetTempPath()) ("bigmodel-cloudflare-secrets-" + [Guid]::NewGuid().ToString("N") + ".json")
  $refreshTokenFile = Join-Path ([System.IO.Path]::GetTempPath()) ("bigmodel-cloudflare-refresh-token-" + [Guid]::NewGuid().ToString("N") + ".txt")
  try {
    @{
      GITHUB_TOKEN = $githubToken
      REFRESH_TOKEN = $refreshToken
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath $secretFile -Encoding UTF8 -NoNewline

    npx wrangler secret bulk $secretFile

    Set-Content -LiteralPath $refreshTokenFile -Value $refreshToken -Encoding ASCII -NoNewline
    gh secret set CLOUDFLARE_REFRESH_TOKEN --repo "zming061031/bigmodel-usage-monitor" --body="$refreshToken"
  } finally {
    if (Test-Path -LiteralPath $secretFile) {
      Remove-Item -LiteralPath $secretFile -Force
    }
    if (Test-Path -LiteralPath $refreshTokenFile) {
      Remove-Item -LiteralPath $refreshTokenFile -Force
    }
  }

  npx wrangler deploy

  $storageStatePath = Join-Path $Root "data\bigmodel-storage-state.json.gz.b64"
  if (Test-Path -LiteralPath $storageStatePath) {
    Invoke-RestMethod `
      -Method Put `
      -Uri ([Uri]::new(([Uri]::new($WorkerUrl)), "/storage-state").AbsoluteUri) `
      -Headers @{ "x-refresh-token" = $refreshToken } `
      -InFile $storageStatePath `
      -ContentType "text/plain" | Out-Null

    "Seeded Cloudflare KV with BigModel login state."
  }

  if ($Verify) {
    $triggerUri = [Uri]::new(([Uri]::new($WorkerUrl)), "/trigger").AbsoluteUri
    $triggerResponse = $null
    $lastError = $null

    for ($attempt = 1; $attempt -le 6; $attempt++) {
      try {
        $triggerResponse = Invoke-RestMethod `
          -Method Post `
          -Uri $triggerUri `
          -Headers @{ "x-refresh-token" = $refreshToken }
        break
      } catch {
        $lastError = $_
        Start-Sleep -Seconds 10
      }
    }

    if (-not $triggerResponse) {
      throw $lastError
    }

    "Manual trigger verification:"
    $triggerResponse | ConvertTo-Json -Depth 10
  }

  "Cloudflare cron worker deployed."
  "It triggers GitHub Actions every hour at minute 7."
  "Refresh token was stored in Cloudflare REFRESH_TOKEN and GitHub CLOUDFLARE_REFRESH_TOKEN."
} finally {
  Pop-Location
}
