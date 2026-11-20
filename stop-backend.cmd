@echo off
setlocal
netstat -ano | findstr ":8765" | findstr LISTENING >nul 2>&1
if errorlevel 1 (
  echo [OK] not running
  exit /b 0
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765" ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>&1
)
echo [OK] background service stopped
timeout /t 2 >nul
