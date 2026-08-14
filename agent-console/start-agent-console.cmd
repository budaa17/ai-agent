@echo off
setlocal
cd /d "%~dp0"
pnpm.cmd dev
if errorlevel 1 pause
