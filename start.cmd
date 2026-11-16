@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Ban can cai Node.js de chay may chu cuc bo.
  pause
  exit /b 1
)
echo Mo trinh duyet va truy cap http://127.0.0.1:4173
node server.js
pause
