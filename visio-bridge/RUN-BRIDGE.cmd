@echo off
REM ============================================================
REM WireFlow -> Visio bridge: one-click demo runner (ASCII only)
REM Draws the WireFlow sample spec into the house Visio template
REM and saves the result on the Desktop. Requires Visio.
REM ============================================================
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0visio_bridge.ps1" -Spec "%~dp0..\..\WireFlow-sample-spec.json" -Template "C:\Users\admin\Downloads\WXWork\1688854952628581\Cache\File\2026-10\111.vsdx" -Out "%USERPROFILE%\Desktop\DWG2468-00 WireFlow Demo.vsdx" -Visible
echo.
echo Bridge finished. The generated drawing is on your Desktop.
pause
endlocal
