# Keeps the Verse Studio worker running: restarts it when it stops, applies updates
# requested from the website, and respects the Start/Stop and autostart switches.
# Started (hidden) by watchdog.ps1. Only one copy runs at a time.
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "studio-common.ps1")

if (Get-Launcher) { exit 0 }
$me = Get-Process -Id $PID
Write-JsonFile $LauncherFile @{ pid = $PID; startTicks = $me.StartTime.ToUniversalTime().Ticks; at = (Now-Iso) }

Set-Location $Repo
$env:VERSE_STUDIO_SUPERVISOR = "windows"
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") + ";$env:USERPROFILE\.local\bin"

function Update-Code {
  Write-Log "Updating Verse Studio"
  $ok = $true; $msg = ""
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $ok = $false; $msg = "Git isn't installed on the studio computer. Run Setup autostart again (it installs Git), then try Update."
  } else {
    $before = (& git rev-parse --short HEAD) 2>$null
    & git fetch --quiet origin 2>&1 | Out-File -Append -Encoding utf8 $ServiceLog
    & git -c core.autocrlf=true merge --ff-only "@{u}" 2>&1 | Out-File -Append -Encoding utf8 $ServiceLog
    if ($LASTEXITCODE -ne 0) {
      # Usually only line-ending noise in the code files. Your keys (.env) are never touched.
      Write-Log "Fast-forward failed; resetting code files to the published version"
      & git reset --hard "@{u}" 2>&1 | Out-File -Append -Encoding utf8 $ServiceLog
    }
    if ($LASTEXITCODE -ne 0) { $ok = $false; $msg = "Couldn't download the update (see service.log)." }
    else {
      $after = (& git rev-parse --short HEAD) 2>$null
      & npm.cmd install --no-audit --no-fund 2>&1 | Out-File -Append -Encoding utf8 $ServiceLog
      if ($LASTEXITCODE -ne 0) { $ok = $false; $msg = "Downloaded $after but installing packages failed (see service.log)." }
      elseif ($before -eq $after) { $msg = "Already up to date ($after)." }
      else { $msg = "Updated $before -> $after." }
    }
  }
  Write-Log $msg
  Write-JsonFile $UpdateResult @{ at = (Now-Iso); ok = $ok; message = $msg }
  Remove-Item -Force $UpdateFlag -ErrorAction SilentlyContinue
}

try {
  while ($true) {
    if (Test-Stopped) { Write-Log "Stopped by the Stop shortcut"; break }
    if (Test-Path $UpdateFlag) { Update-Code }
    Write-Log "Starting worker"
    # cmd does the redirect so the log stays plain UTF-8 text.
    & cmd.exe /d /c "npm.cmd run worker >> `"$ServiceLog`" 2>&1"
    $code = $LASTEXITCODE
    Write-Log "Worker exited with code $code"
    if (Test-Stopped) { break }
    if ($code -eq 3) { Write-Log "Another worker is already running; this one steps aside"; break }
    if ($code -eq 75 -or $code -eq 0 -or (Test-Path $UpdateFlag)) { Start-Sleep -Seconds 3; continue }   # update / restart requested
    if (-not (Get-Control).autostart) { Write-Log "Autostart is off, so not restarting after a stop"; break }
    Start-Sleep -Seconds 20
  }
} finally {
  $l = Read-JsonFile $LauncherFile
  if ($l -and $l.pid -eq $PID) { Remove-Item -Force $LauncherFile -ErrorAction SilentlyContinue }
}
