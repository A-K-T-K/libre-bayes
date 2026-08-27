@echo off
REM Same as run.bat, but with verbose logging and devtools auto-opened --
REM use this when the app fails with a message that doesn't explain itself
REM (e.g. a bare "inference request failed"). Logs land in logs\app.log and
REM logs\backend.log next to the executable; devtools shows frontend/network
REM errors directly.

setlocal
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel% equ 0 (
    set "PYCMD=python"
) else (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set "PYCMD=py"
    ) else (
        echo [libre-bayes] ERROR: no python found on PATH. Install Python 3.10+ first.
        pause
        exit /b 1
    )
)

%PYCMD% run.py --debug %*
if %errorlevel% neq 0 (
    echo.
    echo [libre-bayes] exited with an error ^(see above, and logs\app.log / logs\backend.log^).
    pause
    exit /b %errorlevel%
)
