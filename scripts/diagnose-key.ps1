$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host 'Paste the API key locally. It will not be printed or saved.'
$secure = Read-Host 'API key' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if (-not $plain) {
    throw 'No API key was entered.'
  }

  $apiUri = Read-Host 'API URI (Enter for https://open.bigmodel.cn/api/anthropic)'
  if (-not $apiUri) {
    $apiUri = 'https://open.bigmodel.cn/api/anthropic'
  }

  $env:BIGMODEL_DIAG_KEY = $plain
  $env:BIGMODEL_DIAG_URI = $apiUri
  node (Join-Path $PSScriptRoot 'diagnose-key.mjs')
}
finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  Remove-Item Env:\BIGMODEL_DIAG_KEY,Env:\BIGMODEL_DIAG_URI -ErrorAction SilentlyContinue
}
