@echo off
REM Launches the orb detached, so no console window lingers behind it.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
