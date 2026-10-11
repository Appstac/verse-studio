@echo off
rem Double-click once: Verse Studio then starts by itself and restarts if it closes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-autostart.ps1"
echo.
pause
