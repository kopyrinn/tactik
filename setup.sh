#!/bin/bash

echo "🚀 Setting up Pundit for local development..."
echo ""

# Install dependencies
echo "📦 Installing dependencies (this may take a few minutes)..."
npm install
echo ""

# Create .env files
echo "⚙️  Creating .env files..."

# Backend .env
if [ ! -f apps/server/.env ]; then
    cp apps/server/.env.example apps/server/.env
    echo "✅ Created apps/server/.env"
else
    echo "⚠️  apps/server/.env already exists, skipping"
fi

# Frontend .env
if [ ! -f apps/web/.env.local ]; then
    cp apps/web/.env.local.example apps/web/.env.local
    echo "✅ Created apps/web/.env.local"
else
    echo "⚠️  apps/web/.env.local already exists, skipping"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Run: npm run dev"
echo "2. Open: http://localhost:3000"
echo "3. Create an account and start testing!"
echo ""
echo "🎯 The database (SQLite) will be created automatically on first run"
echo "📁 Database location: apps/server/data/pundit.db"
echo ""
