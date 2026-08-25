@echo off
REM Build (once) and launch LibRE Bayes on Windows.
REM
REM The heavy lifting lives in run.py (cross-platform); this just finds a
REM Python interpreter and hands off to it. Double-click this file to run it.

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

%PYCMD% run.py %*
if %errorlevel% neq 0 (
    echo.
    echo [libre-bayes] exited with an error ^(see above^).
    pause
    exit /b %errorlevel%
)
