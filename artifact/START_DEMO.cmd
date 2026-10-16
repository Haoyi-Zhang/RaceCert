@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
set "NODE_BIN=%~dp0runtime\win-x64\node.exe"
if exist "%NODE_BIN%" goto found_node
set "NODE_BIN=node"
where node >nul 2>nul
if errorlevel 1 goto missing_node
:found_node
"%NODE_BIN%" launch.js
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
:missing_node
echo Node.js 20+ is required. Use the Windows portable package or install Node.js.
pause
exit /b 1
