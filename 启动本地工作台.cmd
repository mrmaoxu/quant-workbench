@echo off
setlocal enabledelayedexpansion
if not exist "%~dp0workbench-v2\index.html" (
  echo [ERROR] workbench-v2\index.html not found
  echo Put this cmd file in the same folder as workbench-v2
  pause
  exit /b 1
)
netstat -ano | findstr ":8765" | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
  echo [OK] already running in background - opening browser
  start "" "http://127.0.0.1:8765/"
  exit /b 0
)
if not exist "%~dp0backend.vbs" (
  echo [ERROR] missing backend.vbs
  pause
  exit /b 1
)
echo.
echo   Local : http://127.0.0.1:8765/
echo   Phone : http://LAN-IP:8765/   same WiFi only
echo   Stop  : run stop-backend.cmd
echo.
echo Starting background service (no window, survives closing this cmd) ...
wscript "%~dp0backend.vbs"
set /a n=0
:waitport
timeout /t 1 >nul
set /a n+=1
netstat -ano | findstr ":8765" | findstr LISTENING >nul 2>&1
if errorlevel 1 if !n! lss 20 goto waitport
netstat -ano | findstr ":8765" | findstr LISTENING >nul 2>&1
if errorlevel 1 (
  echo [ERROR] service did not start
  echo Run manually:  "C:\Windows\pyw.exe" "%~dp0workbench-v2\serve.py" 8765
  pause
  exit /b 1
)
echo [OK] running in background on 8765 - you can close this window
start "" "http://127.0.0.1:8765/"
timeout /t 3 >nul
