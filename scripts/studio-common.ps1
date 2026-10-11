# Shared helpers for the Verse Studio Windows service scripts.
$Repo      = Split-Path -Parent $PSScriptRoot
$DataDir   = Join-Path $env:USERPROFILE ".verse-studio"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$ServiceLog   = Join-Path $DataDir "service.log"
$ControlFile  = Join-Path $DataDir "control.json"
$AliveFile    = Join-Path $DataDir "alive.json"
$LauncherFile = Join-Path $DataDir "launcher.json"
$StopFlag     = Join-Path $DataDir "stop.flag"
$StartFlag    = Join-Path $DataDir "start.flag"
$UpdateFlag   = Join-Path $DataDir "update.flag"
$UpdateResult = Join-Path $DataDir "update-result.json"
$TaskName     = "Verse Studio"

function Now-Iso { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }

function Write-Log($m) {
  try {
    if ((Test-Path $ServiceLog) -and (Get-Item $ServiceLog).Length -gt 5MB) {
      Move-Item -Force $ServiceLog "$ServiceLog.old"
    }
    "[$(Get-Date -Format s)] $m" | Out-File -Append -Encoding utf8 $ServiceLog
  } catch {}
}

function Read-JsonFile($path) {
  try { if (Test-Path $path) { return (Get-Content -Raw $path | ConvertFrom-Json) } } catch {}
  return $null
}

# Written without a BOM so Node can read it as-is.
function Write-JsonFile($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-Control {
  $c = Read-JsonFile $ControlFile
  [pscustomobject]@{
    autostart = -not ($c -and $c.autostart -eq $false)
    paused    = [bool]($c -and $c.paused -eq $true)
    appliedAt = if ($c -and $c.appliedAt -is [datetime]) { $c.appliedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
                elseif ($c -and $c.appliedAt) { [string]$c.appliedAt } else { $null }
  }
}

function Set-Control([Nullable[bool]]$Autostart, [Nullable[bool]]$Paused) {
  $c = Get-Control
  if ($Autostart -ne $null) { $c.autostart = [bool]$Autostart }
  if ($Paused -ne $null) { $c.paused = [bool]$Paused }
  # A change made on this PC wins over any older request from the website.
  $c.appliedAt = Now-Iso
  Write-JsonFile $ControlFile $c
  return $c
}

function Get-ProcessIfAlive($procId, $startTicks) {
  if (-not $procId) { return $null }
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  if ($startTicks) {
    try { if ($p.StartTime.ToUniversalTime().Ticks -ne [int64]$startTicks) { return $null } } catch {}
  }
  return $p
}

# The launcher (run-worker.ps1) records its own process id and start time.
function Get-Launcher {
  $l = Read-JsonFile $LauncherFile
  if (-not $l) { return $null }
  return Get-ProcessIfAlive $l.pid $l.startTicks
}

function Test-Stopped {
  if (-not (Test-Path $StopFlag)) { return $false }
  # "Stop" lasts until the next restart of the PC (or until Start is pressed).
  try {
    $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
    if ((Get-Item $StopFlag).LastWriteTime -lt $boot) { Remove-Item -Force $StopFlag; return $false }
  } catch {}
  return $true
}

function Stop-Tree($procId) {
  if ($procId) { & taskkill.exe /PID $procId /T /F 2>&1 | Out-Null }
}

function Start-Launcher {
  $vbs = Join-Path $PSScriptRoot "hidden.vbs"
  $ps1 = Join-Path $PSScriptRoot "run-worker.ps1"
  if (Test-Path "$env:WINDIR\System32\wscript.exe") {
    Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList "`"$vbs`" `"$ps1`""
  } else {
    Start-Process -WindowStyle Hidden -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`""
  }
}
