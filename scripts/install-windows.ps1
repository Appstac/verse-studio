# Verse Studio worker setup for Windows 10/11.
# Run from the repo folder in PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
function Step($m) { Write-Host "`n== $m" -ForegroundColor Yellow }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") + ";$env:USERPROFILE\.local\bin" }

Step "Node.js"
if (-not (Have node)) {
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  RefreshPath
}
node --version

Step "Claude Code"
if (-not (Have claude) -and -not (Test-Path "$env:USERPROFILE\.local\bin\claude.exe")) {
  irm https://claude.ai/install.ps1 | iex
  RefreshPath
}
$exe = "$env:USERPROFILE\.local\bin\claude.exe"
if (Test-Path $exe) { & $exe --version } else { claude --version }

Step "Installing packages (a few minutes the first time)"
npm.cmd install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Step "Google credentials"
$envFile = Join-Path $repo "apps\worker\.env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $repo "apps\worker\.env.example") $envFile
  Write-Host "Paste the Desktop client ID and secret into the file that opens, save it, then close Notepad."
  Start-Process notepad.exe $envFile -Wait
}

Step "Log in to Claude (use HER Claude Pro or Max account)"
Write-Host "A Claude window will open. Type /login if it asks, finish in the browser, then type /exit."
Read-Host "Press Enter to open Claude"
claude
Step "Sign in to Google Drive (same Google account as the website)"
npm.cmd run login
if ($LASTEXITCODE -ne 0) { throw "Google sign-in failed" }

Step "Check-up"
npm.cmd run doctor

Step "Start automatically when you log in"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$repo\scripts\run-worker.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "Verse Studio Worker" -Action $action -Trigger $trigger -Settings $settings -Description "Makes Verse Studio videos" -Force | Out-Null
Start-ScheduledTask -TaskName "Verse Studio Worker"
Write-Host "Worker started in the background. Log: $env:USERPROFILE\.verse-studio\worker.log"

$ans = Read-Host "Stop this PC from sleeping while plugged in, so auto mode always runs? (y/n)"
if ($ans -eq "y") { powercfg /change standby-timeout-ac 0; powercfg /change hibernate-timeout-ac 0; Write-Host "Sleep turned off on AC power." }
Write-Host "`nAll set. Open the website: the studio computer should show as ready within a minute." -ForegroundColor Green
