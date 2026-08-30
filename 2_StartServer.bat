@echo off
title Study Hub Server
cd /d "%~dp0"

set "PYEXE=%~dp0python-embed\python.exe"

if not exist "%PYEXE%" (
    echo Portable Python not found - running initial setup first.
    echo.
    call "%~dp01_Setup.bat" auto
)
if not exist "%PYEXE%" (
    echo [ERROR] Setup did not complete. Fix the errors above and run this again.
    pause
    exit /b 1
)

rem Run DB migrations on EVERY start (idempotent - no-op when already at head).
rem Skipping this when study.db exists caused 500s after schema changes (S28).
if not exist "study.db" echo study.db not found - creating a fresh database ...
pushd backend
"%PYEXE%" -m alembic upgrade head
if errorlevel 1 (
    popd
    echo [ERROR] Database migration failed.
    pause
    exit /b 1
)
popd

rem Rebuild the screen files when the frontend source changed (needs Node.js; skipped otherwise).
rem Dev_StartServer.bat already ran this check when it hands over here - it passes "nobuild".
if /i not "%~1"=="nobuild" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-frontend-build.ps1"
    if errorlevel 1 echo [WARN] Frontend build failed - starting with the previous build.
)

if not exist "frontend\dist\index.html" (
    echo [ERROR] frontend\dist\index.html not found - this copy has no built screen files.
    echo         Get a package that includes the "frontend\dist" folder.
    pause
    exit /b 1
)

echo.
echo  ---------------------------------------------
echo   PC      :  http://localhost:8000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do echo   Phone   :  http://%%b:8000   [same Wi-Fi]
)
echo  ---------------------------------------------
echo   Manual  :  http://localhost:8000/manual
echo   Close this window or press Ctrl+C to stop the server.
echo   Browser will open automatically when the server is ready.
echo.

start "" /min powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{$t=New-Object Net.Sockets.TcpClient('localhost',8000);$t.Close();Start-Process 'http://localhost:8000';break}catch{Start-Sleep -Seconds 1}}"

cd /d "%~dp0backend"
"%PYEXE%" -m uvicorn main:app --host 0.0.0.0 --port 8000
echo.
echo Server stopped.
pause
