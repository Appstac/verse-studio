# Keeps the Verse Studio worker running. Started at log-on by the scheduled task.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$logDir = Join-Path $env:USERPROFILE ".verse-studio"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
while ($true) {
  "[$(Get-Date -Format s)] starting worker" | Out-File -Append (Join-Path $logDir "service.log")
  & npm.cmd run worker *>> (Join-Path $logDir "service.log")
  "[$(Get-Date -Format s)] worker exited ($LASTEXITCODE), restarting in 20s" | Out-File -Append (Join-Path $logDir "service.log")
  Start-Sleep -Seconds 20
}
