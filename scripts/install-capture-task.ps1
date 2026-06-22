$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TaskName = $env:BIGMODEL_CAPTURE_TASK_NAME
if (-not $TaskName) {
  $TaskName = 'BigModelUsageCapture'
}

$CaptureScript = Join-Path $PSScriptRoot 'capture-web-session.ps1'
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$CaptureScript`""

$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Root
$StartAt = (Get-Date).AddMinutes(2)
$Trigger = New-ScheduledTaskTrigger `
  -Once `
  -At $StartAt `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Force | Out-Null

"Installed hourly capture task: $TaskName"
"The task runs only while this Windows user is logged on, because browser login/cookies are user-profile state."
"Run once now with: npm run capture:web-session"
