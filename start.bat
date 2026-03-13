@echo off
setlocal

echo.
echo Starting Pundit...
echo.

echo Starting backend server (port 3001)...
start "Pundit Backend" cmd /k "cd /d %~dp0apps\server && npm run dev"

timeout /t 2 /nobreak >nul

echo Starting frontend (port 3000)...
start "Pundit Frontend" cmd /k "cd /d %~dp0apps\web && npm run dev"

echo.
echo Pundit is starting.
echo Open http://localhost:3000 in 10-20 seconds.
echo.
echo You can close this window. Backend and frontend keep running.
pause >nul