# Verse Studio controls for this PC. Used by the desktop shortcuts.
#   studio.ps1 start | stop | restart | autostart-on | autostart-off | autostart-toggle | status | log
param([string]$Action = "status", [switch]$Quiet)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "studio-common.ps1")

function Say($text, $title = "Verse Studio") {
  if ($Quiet) { Write-Host $text; return }
  try { (New-Object -ComObject WScript.Shell).Popup($text, 0, $title, 64) | Out-Null } catch { Write-Host $text }
}

function Run-Watchdog {
  # Prefer the scheduled task so the worker runs the same way it does at sign-in.
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName $TaskName }
  else { & (Join-Path $PSScriptRoot "watchdog.ps1") }
}

function Stop-Worker {
  $l = Read-JsonFile $LauncherFile
  if ($l) { Stop-Tree $l.pid }
  $a = Read-JsonFile $AliveFile
  if ($a) { Stop-Tree $a.pid }
}

function Status-Text {
  $c = Get-Control
  $running = [bool](Get-Launcher)
  $a = Read-JsonFile $AliveFile
  $lines = @()
  $lines += "Worker: " + $(if ($running) { "running" } elseif (Test-Stopped) { "stopped (until Start or the next restart)" } else { "not running" })
  $lines += "Start automatically and restart if closed: " + $(if ($c.autostart) { "ON" } else { "OFF" })
  $lines += "Making videos: " + $(if ($c.paused) { "paused from the website" } else { "yes" })
  if ($a -and $a.at) { $lines += "Last sign of life: " + ([datetime]$a.at).ToLocalTime().ToString("g") }
  $lines += "Background task: " + $(if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { "installed" } else { "NOT installed - run 'Set up autostart (Windows).cmd'" })
  $lines -join "`n"
}

switch ($Action.ToLower()) {
  "start" {
    Remove-Item -Force $StopFlag -ErrorAction SilentlyContinue
    Set-Content -Path $StartFlag -Value (Now-Iso)
    Run-Watchdog
    Say "Starting Verse Studio. The website will show it as ready within a minute."
  }
  "stop" {
    Set-Content -Path $StopFlag -Value (Now-Iso)
    Stop-Worker
    Write-Log "Stopped from the desktop shortcut"
    Say "Verse Studio stopped. It stays off until you press Start or restart the PC$(if (-not (Get-Control).autostart) { '' } else { ' (autostart is on)' })."
  }
  "restart" {
    Stop-Worker
    Start-Sleep -Seconds 2
    Remove-Item -Force $StopFlag -ErrorAction SilentlyContinue
    Set-Content -Path $StartFlag -Value (Now-Iso)
    Run-Watchdog
    Say "Verse Studio restarted."
  }
  "autostart-on"  { Set-Control -Autostart $true | Out-Null; Run-Watchdog; Say "Autostart is ON.`nVerse Studio starts when you sign in and restarts by itself if it closes." }
  "autostart-off" { Set-Control -Autostart $false | Out-Null; Say "Autostart is OFF.`nVerse Studio keeps running for now, but won't start by itself after a restart or if it closes. Use the Start shortcut when you want it." }
  "autostart-toggle" {
    $c = Get-Control
    if ($c.autostart) { & $PSCommandPath autostart-off -Quiet:$Quiet } else { & $PSCommandPath autostart-on -Quiet:$Quiet }
  }
  "log" { Start-Process notepad.exe $ServiceLog }
  default { Say (Status-Text) "Verse Studio status" }
}
