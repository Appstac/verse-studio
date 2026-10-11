# Runs every few minutes (and at sign-in) from the "Verse Studio" scheduled task.
# Starts the worker if it isn't running, and restarts it if it has frozen.
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "studio-common.ps1")

$manual = Test-Path $StartFlag
if ($manual) { Remove-Item -Force $StartFlag -ErrorAction SilentlyContinue; Remove-Item -Force $StopFlag -ErrorAction SilentlyContinue }
if (Test-Stopped) { exit 0 }

$launcher = Get-Launcher
if ($launcher) {
  # Running: check it's still alive. alive.json is refreshed every 30 s by the worker,
  # and loopAt at least every 10 min (more often while making videos).
  $a = Read-JsonFile $AliveFile
  if ($a -and $a.at) {
    $now = (Get-Date).ToUniversalTime()
    $at = ([datetime]$a.at).ToUniversalTime()
    $loop = if ($a.loopAt) { ([datetime]$a.loopAt).ToUniversalTime() } else { $at }
    if (($now - $at).TotalMinutes -gt 5 -or ($now - $loop).TotalMinutes -gt 30) {
      Write-Log "Watchdog: worker looks frozen (last sign of life $at, last loop $loop); restarting it"
      Stop-Tree $a.pid
    }
  }
  exit 0
}

if ($manual -or (Get-Control).autostart) {
  Write-Log ("Watchdog: worker not running, starting it" + $(if ($manual) { " (Start pressed)" } else { "" }))
  Start-Launcher
}
