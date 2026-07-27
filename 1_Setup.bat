@echo off
setlocal
title Study Hub Setup
cd /d "%~dp0"

set "PYVER=3.12.10"
set "PYDIR=%~dp0python-embed"
set "PYEXE=%PYDIR%\python.exe"

echo ================================================
echo  Study Hub - Initial Setup
echo  Internet connection is required (first run only)
echo ================================================
echo.

if exist "%PYEXE%" (
    echo [1/4] Portable Python already installed - skipping download.
    goto :PIP
)

echo [1/4] Downloading portable Python %PYVER% - about 11 MB ...
set "PYZIP=%TEMP%\studyhub-python-embed.zip"
call :DOWNLOAD "https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-embed-amd64.zip" "%PYZIP%"
if errorlevel 1 (
    echo [ERROR] Download failed. Check your internet connection and run this again.
    pause
    exit /b 1
)

echo [2/4] Extracting to python-embed ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%PYZIP%' '%PYDIR%'"
if errorlevel 1 (
    echo [ERROR] Failed to extract the Python archive.
    pause
    exit /b 1
)
del "%PYZIP%" >nul 2>&1

rem Allow the embedded Python to load Lib\site-packages (default _pth blocks it)
powershell -NoProfile -Command "[IO.File]::WriteAllText('%PYDIR%\python312._pth', (@('python312.zip','.','Lib\site-packages','import site') -join [Environment]::NewLine), [Text.Encoding]::ASCII)"
if errorlevel 1 (
    echo [ERROR] Failed to configure the embedded Python.
    pause
    exit /b 1
)

:PIP
if exist "%PYDIR%\Scripts\pip.exe" (
    echo [3/4] pip already installed - skipping.
) else (
    echo [3/4] Installing pip ...
    call :DOWNLOAD "https://bootstrap.pypa.io/get-pip.py" "%PYDIR%\get-pip.py"
    if errorlevel 1 (
        echo [ERROR] Failed to download get-pip.py.
        pause
        exit /b 1
    )
    "%PYEXE%" "%PYDIR%\get-pip.py" --no-warn-script-location
    if errorlevel 1 (
        echo [ERROR] pip installation failed.
        pause
        exit /b 1
    )
    del "%PYDIR%\get-pip.py" >nul 2>&1
)

echo [4/4] Installing packages - first run can take a few minutes ...
"%PYEXE%" -m pip install --no-warn-script-location -r "backend\requirements.txt"
if errorlevel 1 (
    echo [ERROR] Package installation failed. Check the messages above.
    pause
    exit /b 1
)

"%PYEXE%" -c "import fastapi, uvicorn, sqlalchemy, alembic, anthropic"
if errorlevel 1 (
    echo [ERROR] Packages did not install correctly.
    pause
    exit /b 1
)

if exist "study.db" (
    echo Database already exists - keeping it.
) else (
    echo Creating a fresh database ...
    pushd backend
    "%PYEXE%" -m alembic upgrade head
    if errorlevel 1 (
        popd
        echo [ERROR] Database creation failed.
        pause
        exit /b 1
    )
    popd
)

echo.
echo ================================================
echo  Setup complete.
echo  Run "2_StartServer.bat" to start Study Hub.
echo ================================================
echo.
if /i "%~1"=="auto" exit /b 0
pause
exit /b 0

:DOWNLOAD
where curl.exe >nul 2>&1
if errorlevel 1 goto :DL_PS
curl.exe -L --fail -o %2 %1
exit /b %errorlevel%
:DL_PS
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest '%~1' -OutFile '%~2'"
exit /b %errorlevel%
