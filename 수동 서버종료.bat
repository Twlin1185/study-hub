@echo off
title Stop Study Hub Server
set KILLED=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%p >nul 2>&1
    echo Stopped server process %%p
    set KILLED=1
)
if "%KILLED%"=="0" (
    echo Server is not running.
) else (
    echo Server stopped.
)
ping -n 3 127.0.0.1 >nul
