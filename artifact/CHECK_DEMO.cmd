@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
set "NODE_BIN=%~dp0runtime\win-x64\node.exe"
if exist "%NODE_BIN%" goto found_node
set "NODE_BIN=node"
where node >nul 2>nul
if errorlevel 1 goto missing_node
:found_node
"%NODE_BIN%" preflight.js
set "RESULT=%ERRORLEVEL%"
if "%RACECERT_CHECK_NO_PAUSE%"=="1" goto done
echo.
pause
:done
exit /b %RESULT%
:missing_node
echo CHECK FAILED: Node.js 20+ is unavailable. Use the Windows Full package.
if not "%RACECERT_CHECK_NO_PAUSE%"=="1" pause
exit /b 1
