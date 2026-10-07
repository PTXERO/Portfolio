@echo off
rem SEARCH//NET - double-click to set up (first time) and start.
rem Runs start.ps1 next to this file; PowerShell's script policy is bypassed for this one run only.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
