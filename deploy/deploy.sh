#!/bin/bash
# Скрипт деплоя tactik.kz
# Использование: ./deploy/deploy.sh
# Первый деплой: ./deploy/deploy.sh --fresh

set -euo pipefail

APP_DIR="/app"
FRESH=${1:-""}

echo "[deploy] Начало деплоя..."

cd "$APP_DIR"

# Получаем свежий код
echo "[deploy] Обновляем код..."
git pull origin main

# Устанавливаем зависимости
echo "[deploy] Устанавливаем зависимости..."
npm install --prefix apps/server
npm install --prefix apps/web

# Собираем сервер (TypeScript → JS)
echo "[deploy] Собираем сервер..."
npm --prefix apps/server run build

# Собираем фронтенд
echo "[deploy] Собираем фронтенд..."
npm --prefix apps/web run build

# Перезапускаем процессы
echo "[deploy] Перезапускаем PM2..."
if pm2 list | grep -q "tactik-server"; then
    pm2 reload ecosystem.config.js --env production
else
    pm2 start ecosystem.config.js --env production
    pm2 save
fi

echo "[deploy] Готово!"
pm2 status
