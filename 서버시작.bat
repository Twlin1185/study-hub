@echo off
title Study Hub Server
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] backend\.venv not found.
    echo Run these in the backend folder first:
    echo    python -m venv .venv
    echo    .venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

rem Create DB schema if study.db is missing
if not exist "..\study.db" (
    echo study.db not found - creating schema...
    .venv\Scriptslembic.exe upgrade head
    if errorlevel 1 (
        echo [ERROR] schema creation failed. See messages above.
        pause
        exit /b 1
    )
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
echo   PC      :  http://localhost:8000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do echo   Phone   :  http://%%b:8000   [same Wi-Fi]
)
echo  ---------------------------------------------
echo   Manual   :  http://localhost:8000/manual
echo   Close this window or press Ctrl+C to stop the server.
echo   Browser will open automatically when the server is ready.
echo.

rem Open browser when the server starts responding (waits up to 60s)
start "" /min powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{$t=New-Object Net.Sockets.TcpClient('localhost',8000);$t.Close();Start-Process 'http://localhost:8000';break}catch{Start-Sleep -Seconds 1}}"

.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
echo.
echo Server stopped.
pause
