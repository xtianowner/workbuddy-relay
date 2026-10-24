@echo off
chcp 65001 >nul
REM Double-click: WorkBuddy relay import (local only, downloads no code)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0workbuddy\setup.ps1" %*
echo.
pause
