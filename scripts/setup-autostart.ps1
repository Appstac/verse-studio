# One-time setup: makes Verse Studio start by itself and restart if it closes,
# and puts Start / Stop / Autostart / Status shortcuts on the desktop.
# Safe to run again any time (for example after moving the folder).
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "studio-common.ps1")
function Step($m) { Write-Host "`n== $m" -ForegroundColor Yellow }

Step "Stopping any copy of the worker that is already running"
foreach ($old in @("Verse Studio Worker", $TaskName)) {
  if (Get-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $old -Confirm:$false
  }
}
$skip = @($PID, (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId)
Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -notin $skip -and $_.CommandLine -and (
    $_.CommandLine -like "*run-worker.ps1*" -or
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*tsx*" -and $_.CommandLine -like "*verse-studio*")
  )
} | ForEach-Object { Write-Host "  stopping $($_.Name) ($($_.ProcessId))"; Stop-Tree $_.ProcessId }
Remove-Item -Force $LauncherFile, $AliveFile, $StopFlag -ErrorAction SilentlyContinue

Step "Git (lets the website update the studio computer for you)"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  try { winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements } catch { Write-Host "  Couldn't install Git automatically. Updates from the website will be unavailable until Git is installed." }
} else { Write-Host "  Git is installed." }

Step "Background task"
$wscript = "$env:WINDIR\System32\wscript.exe"
$watchdog = Join-Path $PSScriptRoot "watchdog.ps1"
if (Test-Path $wscript) {
  $action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$PSScriptRoot\hidden.vbs`" `"$watchdog`"" -WorkingDirectory $Repo
} else {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdog`"" -WorkingDirectory $Repo
}
$user = "$env:USERDOMAIN\$env:USERNAME"
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
try {
  $every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  if (-not $every.Repetition.Interval) { throw "no repetition" }
} catch {
  $every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -Hidden
$desc = "Keeps the Verse Studio worker running: starts it at sign-in, checks it every 5 minutes, restarts it if it closed or froze."

Write-Host "Normally the worker starts when you sign in to Windows."
Write-Host "It can also run when nobody is signed in (for example after Windows Update restarts the PC overnight)."
$always = Read-Host "Run even when nobody is signed in? This needs your Windows password once. (y/N)"
$registered = $false
if ($always -eq "y") {
  $cred = Get-Credential -UserName $user -Message "Your Windows password (stored by Windows Task Scheduler, not by Verse Studio)"
  $plain = $cred.GetNetworkCredential().Password
  foreach ($triggers in @(@((New-ScheduledTaskTrigger -AtStartup), $atLogon, $every), @($atLogon, $every))) {
    try {
      Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Description $desc `
        -User $user -Password $plain -RunLevel Limited -Force | Out-Null
      $registered = $true; break
    } catch { $err = $_ }
  }
  $plain = $null
  if ($registered) { Write-Host "  Runs whether or not anyone is signed in." -ForegroundColor Green }
  else { Write-Host "  That didn't work ($err). Falling back to starting at sign-in." -ForegroundColor DarkYellow }
}
if (-not $registered) {
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atLogon, $every) -Settings $settings -Principal $principal -Description $desc -Force | Out-Null
  Write-Host "  Starts at sign-in and is checked every 5 minutes." -ForegroundColor Green
}

Step "Desktop shortcuts"
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$folders = @((Join-Path $desktop "Verse Studio"), (Join-Path ([Environment]::GetFolderPath("Programs")) "Verse Studio"))
$studio = Join-Path $PSScriptRoot "studio.ps1"
$items = @(
  @{ name = "Start Verse Studio";            action = "start";            icon = "imageres.dll,101" },
  @{ name = "Stop Verse Studio";             action = "stop";             icon = "imageres.dll,100" },
  @{ name = "Restart Verse Studio";          action = "restart";          icon = "shell32.dll,238" },
  @{ name = "Autostart on-off";              action = "autostart-toggle"; icon = "shell32.dll,21" },
  @{ name = "Status";                        action = "status";           icon = "imageres.dll,76" },
  @{ name = "Worker log";                    action = "log";              icon = "shell32.dll,70" }
)
foreach ($dir in $folders) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  foreach ($it in $items) {
    $lnk = $ws.CreateShortcut((Join-Path $dir "$($it.name).lnk"))
    if (Test-Path $wscript) {
      $lnk.TargetPath = $wscript
      $lnk.Arguments = "`"$PSScriptRoot\hidden.vbs`" `"$studio`" $($it.action)"
    } else {
      $lnk.TargetPath = "powershell.exe"
      $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$studio`" $($it.action)"
    }
    $lnk.WorkingDirectory = $Repo
    $lnk.IconLocation = "$env:WINDIR\System32\$($it.icon)"
    $lnk.Save()
  }
  $url = $ws.CreateShortcut((Join-Path $dir "Verse Studio website.url"))
  $url.TargetPath = "https://verse-studio-six.vercel.app"
  $url.Save()
}
Write-Host "  Shortcuts are in the 'Verse Studio' folder on the desktop and in the Start menu."

Step "Starting"
Set-Control -Autostart $true | Out-Null
Set-Content -Path $StartFlag -Value (Now-Iso)
Start-ScheduledTask -TaskName $TaskName
$ok = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  if (Read-JsonFile $AliveFile) { $ok = $true; break }
}
if ($ok) {
  Write-Host "`nVerse Studio is running in the background." -ForegroundColor Green
  Write-Host "It starts by itself, restarts if it closes, and sends its status to the website every 20 seconds or so."
  Write-Host "Turn autostart off any time from the website (Settings > Studio computer) or the 'Autostart on-off' shortcut."
} else {
  Write-Host "`nThe background task is installed but the worker hasn't reported in yet." -ForegroundColor DarkYellow
  Write-Host "Give it a minute, then check the website. If it still shows offline, open 'Worker log' in the Verse Studio desktop folder."
}
