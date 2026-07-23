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
    .venv\Scripts\alembic.exe upgrade head
    if errorlevel 1 (
        echo [ERROR] schema creation failed. See messages above.
        pause
        exit /b 1
    )
)

echo.
echo  ---------------------------------------------
echo   PC      :  http://localhost:8000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do echo   Phone   :  http://%%b:8000   [same Wi-Fi]
)
echo  ---------------------------------------------
echo   Close this window or press Ctrl+C to stop the server.
echo   Browser will open automatically when the server is ready.
echo.

rem Open browser when the server starts responding (waits up to 60s)
start "" /min powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{$t=New-Object Net.Sockets.TcpClient('localhost',8000);$t.Close();Start-Process 'http://localhost:8000';break}catch{Start-Sleep -Seconds 1}}"

.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
echo.
echo Server stopped.
pause
