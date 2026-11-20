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
  echo [OK] port 8765 already listening - opening browser
  start "" "http://127.0.0.1:8765/"
  exit /b 0
)
set PY=py -3
where py >nul 2>&1
if errorlevel 1 set PY=python
echo.
echo   Local : http://127.0.0.1:8765/
echo   Phone : http://LAN-IP:8765/   same WiFi only
echo   Stop  : close the QuantServer window
echo.
echo Starting server, waiting for port 8765 ...
cd /d "%~dp0workbench-v2"
start "QuantServer" /min %PY% serve.py 8765
set /a n=0
:waitport
timeout /t 1 >nul
set /a n+=1
netstat -ano | findstr ":8765" | findstr LISTENING >nul 2>&1
if errorlevel 1 if !n! lss 20 goto waitport
netstat -ano | findstr ":8765" | findstr LISTENING >nul 2>&1
if errorlevel 1 (
  echo [ERROR] server did not start
  echo Run manually:  %PY% "%~dp0workbench-v2\serve.py" 8765
  pause
  exit /b 1
)
echo [OK] server ready on 8765
start "" "http://127.0.0.1:8765/"
timeout /t 3 >nul
