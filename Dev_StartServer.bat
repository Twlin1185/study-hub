@echo off
title Study Hub Server
cd /d "%~dp0backend"

rem This script is for the DEV PC (uses backend\.venv + npm build).
rem On a PC without .venv (e.g. a tester PC) hand over to the portable version.
rem ---------------------------------------------------------------
rem Frontend build freshness check - runs BEFORE the .venv hand-over so a dev PC that
rem uses the portable Python (no .venv) still gets a fresh build. Judged by a hash of
rem the frontend source vs dist\.source-hash (mtime was unreliable - git checkout
rem rewrites file times). Logic lives in scripts\ensure-frontend-build.ps1 (shared with
rem 1_Setup.bat / 2_StartServer.bat); the hash itself is frontend\scripts\source-hash.mjs.
rem ---------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-frontend-build.ps1"
if errorlevel 1 (
    echo [ERROR] frontend build failed. See messages above.
    echo         Starting the server anyway with the previous build.
    pause
)

if not exist ".venv\Scripts\python.exe" (
    echo [INFO] backend\.venv not found - this script is for the development PC.
    echo        Starting the portable version instead: 2_StartServer.bat
    echo.
    call "%~dp02_StartServer.bat" nobuild
    exit /b
)

rem Run DB migrations on EVERY start (idempotent - no-op when already at head).
rem Skipping this when study.db exists caused 500s after schema changes (S28).
if not exist "..\study.db" echo study.db not found - creating schema...
.venv\Scripts\python.exe -m alembic upgrade head
if errorlevel 1 (
    echo [ERROR] schema migration failed. See messages above.
    pause
    exit /b 1
)

echo.
echo  ---------------------------------------------
echo   MAIN  (existing app)  :  http://localhost:8000/
echo   NOTES (beta, dev)     :  http://localhost:8000/notes
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do echo   Phone                 :  http://%%b:8000   [same Wi-Fi]
)
echo  ---------------------------------------------
echo   Manual   :  http://localhost:8000/manual
echo   Close this window or press Ctrl+C to stop the server.
echo   TWO browser windows open when the server is ready:
echo     window 1 = MAIN (tab says "Study Hub")
echo     window 2 = NOTES beta (tab says "notes (beta)")
echo.

rem Open BOTH dev surfaces in separate windows once the server answers (waits up
rem to 60s). Kept in a .ps1 because default-browser detection does not fit on one
rem readable bat line -- see scripts\dev-open-browsers.ps1 for the why.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-open-browsers.ps1" -Port 8000

.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
echo.
echo Server stopped.
pause
