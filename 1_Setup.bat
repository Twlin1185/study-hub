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

rem Windows MAX_PATH(260) guard - pip fails with "No such file or directory" when this folder is
rem deep (site-packagesnthropic	ypeseta\... alone is ~140 chars). Measured 2026-08-29 on a
rem fresh clone in a long temp path. Refuse early with guidance instead of a confusing pip error.
for /f %%L in ('powershell -NoProfile -Command "('%~dp0').Length"') do set "PLEN=%%L"
if %PLEN% GTR 110 (
    echo [ERROR] This folder path is too long ^(%PLEN% chars^). Windows limits paths to 260 chars and
    echo         the Python packages need about 150 more. Move this folder to a short path such as
    echo         C:\StudyHub  and run this again.
    pause
    exit /b 1
)

if exist "%PYEXE%" (
    echo [1/5] Portable Python already installed - skipping download.
    goto :PIP
)

echo [1/5] Downloading portable Python %PYVER% - about 11 MB ...
set "PYZIP=%TEMP%\studyhub-python-embed.zip"
call :DOWNLOAD "https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-embed-amd64.zip" "%PYZIP%"
if errorlevel 1 (
    echo [ERROR] Download failed. Check your internet connection and run this again.
    pause
    exit /b 1
)

echo [2/5] Extracting to python-embed ...
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
    echo [3/5] pip already installed - skipping.
) else (
    echo [3/5] Installing pip ...
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

echo [4/5] Installing packages - first run can take a few minutes ...
"%PYEXE%" -m pip install --no-warn-script-location -r "backend\requirements.txt"
if errorlevel 1 (
    echo [ERROR] Package installation failed. Check the messages above.
    pause
    exit /b 1
)

"%PYEXE%" -c "import fastapi, uvicorn, sqlalchemy, alembic, anthropic, certifi"
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

rem Build the screen files if the frontend source is newer than frontend\dist (needs Node.js;
rem silently skipped on a PC without it - the dist included in this copy is used as-is).
echo [5/5] Checking the frontend build ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-frontend-build.ps1"
if errorlevel 1 (
    echo [WARN] Frontend build failed - the screen files in this copy will be used as they are.
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
