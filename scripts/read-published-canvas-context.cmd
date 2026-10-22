@echo off
setlocal
set "PACKAGE_ROOT=%~dp0.."
set "NODE=%PACKAGE_ROOT%\runtime\node-v22.23.2-win-x64\node.exe"
if not exist "%NODE%" (
  echo Portable Node runtime missing: "%NODE%" 1>&2
  exit /b 20
)
"%NODE%" "%PACKAGE_ROOT%\app\read-published-canvas-context.mjs"
exit /b %ERRORLEVEL%
