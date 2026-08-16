@echo off
title Study Hub Server
cd /d "%~dp0backend"

rem This script is for the DEV PC (uses backend\.venv + npm build).
rem On a PC without .venv (e.g. a tester PC) hand over to the portable version.
if not exist ".venv\Scripts\python.exe" (
    echo [INFO] backend\.venv not found - this script is for the development PC.
    echo        Starting the portable version instead: 2_StartServer.bat
    echo.
    call "%~dp02_StartServer.bat"
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

rem ---------------------------------------------------------------
rem Frontend build freshness check
rem FastAPI serves frontend\dist as-is, so a stale dist means the
rem server is new but the SCREEN is old. Rebuild when dist is missing
rem or older than any file in frontend\src (or package.json / configs).
rem ---------------------------------------------------------------
cd /d "%~dp0frontend"
set NEED_BUILD=0
if not exist "dist\index.html" (
    set NEED_BUILD=1
    echo Frontend build not found - building...
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=(Get-Item 'dist\index.html').LastWriteTime; $n=[datetime]::MinValue; foreach($f in Get-ChildItem 'src','package.json','vite.config.ts','index.html' -Recurse -File -ErrorAction SilentlyContinue){ if($f.LastWriteTime -gt $n){$n=$f.LastWriteTime} }; if($n -gt $b){exit 1}else{exit 0}"
    if errorlevel 1 (
        set NEED_BUILD=1
        echo Frontend changed since last build - rebuilding...
    )
)

if "%NEED_BUILD%"=="1" (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [WARN] npm not found - skipping build. The screen may be outdated.
    ) else (
        rem Install dependencies first when package-lock.json is newer than the
        rem last install marker npm leaves in node_modules (or marker is missing).
        powershell -NoProfile -ExecutionPolicy Bypass -Command "if(-not (Test-Path 'node_modules\.package-lock.json')){exit 1}; if((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules\.package-lock.json').LastWriteTime){exit 1}else{exit 0}"
        if errorlevel 1 (
            echo Frontend dependencies changed - running npm install first...
            call npm install
            if errorlevel 1 (
                echo [ERROR] npm install failed. See messages above.
                pause
            )
        )
        call npm run build
        if errorlevel 1 (
            echo [ERROR] frontend build failed. See messages above.
            echo         Starting the server anyway with the previous build.
            pause
        ) else (
            echo Frontend build done.
        )
    )
) else (
    echo Frontend build is up to date.
)

cd /d "%~dp0backend"

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
