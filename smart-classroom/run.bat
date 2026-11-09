@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org and then open a new terminal.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env
node backend\server.js
pause
