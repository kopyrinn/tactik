@echo off
echo.
echo 🚀 Setting up Pundit for local development...
echo.

REM Install server dependencies
echo 📦 Installing server dependencies...
cd apps\server
call npm install
cd ..\..
echo.

REM Install web dependencies
echo 📦 Installing web dependencies...
cd apps\web
call npm install
cd ..\..
echo.

REM Create .env files
echo ⚙️  Creating .env files...

REM Backend .env
if not exist apps\server\.env (
    copy apps\server\.env.example apps\server\.env >nul
    echo ✅ Created apps\server\.env
) else (
    echo ⚠️  apps\server\.env already exists, skipping
)

REM Frontend .env
if not exist apps\web\.env.local (
    copy apps\web\.env.local.example apps\web\.env.local >nul
    echo ✅ Created apps\web\.env.local
) else (
    echo ⚠️  apps\web\.env.local already exists, skipping
)

echo.
echo ✅ Setup complete!
echo.
echo 📝 Next steps:
echo 1. Run: npm run dev
echo 2. Open: http://localhost:3000
echo 3. Create an account and start testing!
echo.
echo 🎯 The database (SQLite) will be created automatically on first run
echo 📁 Database location: apps\server\data\pundit.db
echo.
pause
