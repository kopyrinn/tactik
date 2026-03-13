# 🚀 ЗАПУСК ЛОКАЛЬНО - ПОШАГОВАЯ ИНСТРУКЦИЯ

## ✅ Что НЕ нужно устанавливать:
- ❌ PostgreSQL - используем SQLite (встроенная база)
- ❌ Redis - используем in-memory хранилище
- ❌ Docker - не требуется

## ✅ Что нужно установить:
- ✅ Node.js 18+ ([nodejs.org](https://nodejs.org))
- ✅ pnpm (установится автоматически)

---

## 🎯 БЫСТРЫЙ СТАРТ (3 минуты)

### Вариант 1: Автоматический (рекомендуется)

**macOS/Linux:**
```bash
cd pundit
chmod +x setup.sh
./setup.sh
pnpm dev
```

**Windows:**
```cmd
cd pundit
setup.bat
pnpm dev
```

**Готово!** Открывай http://localhost:3000

---

### Вариант 2: Ручная установка

#### 1. Установи pnpm (если нет)
```bash
npm install -g pnpm
```

#### 2. Установи зависимости
```bash
cd pundit
pnpm install
```

#### 3. Создай .env файлы

**Backend:**
```bash
cd apps/server
cp .env.example .env
```

Отредактируй `apps/server/.env`:
```env
PORT=3001
NODE_ENV=development
JWT_SECRET=измени-на-любую-случайную-строку-минимум-32-символа
FRONTEND_URL=http://localhost:3000
```

**Frontend:**
```bash
cd apps/web
cp .env.local.example .env.local
```

Файл `apps/web/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

#### 4. Запусти проект
```bash
# Из корня проекта
pnpm dev
```

Это запустит:
- ✅ Backend на http://localhost:3001
- ✅ Frontend на http://localhost:3000

---

## 🧪 ТЕСТИРОВАНИЕ

### 1. Открой браузер
```
http://localhost:3000
```

### 2. Создай аккаунт
- Нажми "Sign Up Free"
- Введи email и пароль
- Создай аккаунт

### 3. Создай сессию
- В Dashboard нажми "Create New Session"
- Введи название: "Test Session"
- Вставь YouTube URL: https://www.youtube.com/watch?v=jNQXAC9IVRw
- Нажми "Create Session"

### 4. Проверь что работает
- ✅ Регистрация
- ✅ Логин
- ✅ Dashboard
- ✅ Создание сессии
- ✅ Удаление сессии

---

## 📁 Где хранятся данные?

**База данных SQLite:**
```
apps/server/data/pundit.db
```

Можешь открыть в любом SQLite браузере:
- [DB Browser for SQLite](https://sqlitebrowser.org/)
- VSCode extension: "SQLite"
- [https://sqliteviewer.app/](https://sqliteviewer.app/)

**Сессии (в памяти):**
- Хранятся в оперативной памяти
- Сбрасываются при перезапуске сервера
- Для прода используем Redis

---

## 🔧 Полезные команды

```bash
# Запустить всё
pnpm dev

# Только backend
pnpm dev:server

# Только frontend
pnpm dev:web

# Build для продакшена
pnpm build

# Проверить типы
pnpm type-check

# Очистить всё и переустановить
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

---

## 🐛 Решение проблем

### Порт 3001 занят
```bash
# macOS/Linux
lsof -ti:3001 | xargs kill -9

# Windows
netstat -ano | findstr :3001
taskkill /PID <номер> /F
```

### Порт 3000 занят
```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <номер> /F
```

### "Cannot find module 'better-sqlite3'"
```bash
cd apps/server
pnpm install
```

### "pnpm: command not found"
```bash
npm install -g pnpm
```

### База данных не создаётся
Удали старую и перезапусти:
```bash
rm -rf apps/server/data
pnpm dev:server
```

### CORS ошибки в браузере
Проверь что в `apps/server/.env`:
```
FRONTEND_URL=http://localhost:3000
```

---

## 🧪 Тестирование API напрямую

### Регистрация
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123","name":"Test User"}' \
  -c cookies.txt
```

### Логин
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}' \
  -c cookies.txt
```

### Создать сессию
```bash
curl -X POST http://localhost:3001/api/sessions \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"Test Session","youtubeUrl":"https://youtube.com/watch?v=abc123"}'
```

### Получить сессии
```bash
curl http://localhost:3001/api/sessions -b cookies.txt
```

---

## 📊 Что работает сейчас

### ✅ Полностью функционально:
1. **Регистрация** - создание аккаунта
2. **Логин** - вход в систему
3. **Dashboard** - список сессий
4. **Создание сессии** - с YouTube URL
5. **Удаление сессии**
6. **JWT авторизация**
7. **Plan badges** (FREE/COACH/PRO)
8. **SQLite база** - автоматическое создание
9. **In-memory sessions** - работает без Redis

### ⏳ TODO (следующие фичи):
1. Страница сессии `/session/[id]`
2. YouTube player
3. Canvas для рисования
4. Real-time синхронизация
5. Инструменты рисования

---

## 🎨 Архитектура

**Backend:**
- Express.js REST API
- Socket.IO для real-time
- SQLite база (better-sqlite3)
- In-memory session store
- JWT аутентификация
- bcrypt для паролей

**Frontend:**
- Next.js 14 (App Router)
- React 18
- Tailwind CSS
- Zustand для state
- Axios для API

**Monorepo:**
- pnpm workspaces
- Shared TypeScript types
- Единый package.json

---

## 🚀 Production Deploy (когда будет готово)

### Backend → Railway
```bash
cd apps/server
railway login
railway init
railway up
```

В Railway добавь:
- PostgreSQL (вместо SQLite)
- Redis (вместо in-memory)

### Frontend → Vercel
```bash
cd apps/web
vercel --prod
```

---

## 📞 Помощь

Если что-то не работает:

1. Проверь что Node.js 18+:
   ```bash
   node --version
   ```

2. Проверь что pnpm установлен:
   ```bash
   pnpm --version
   ```

3. Проверь .env файлы:
   ```bash
   cat apps/server/.env
   cat apps/web/.env.local
   ```

4. Перезапусти всё:
   ```bash
   # Останови (Ctrl+C)
   pnpm dev
   ```

5. Очисти и переустанови:
   ```bash
   rm -rf node_modules apps/*/node_modules
   rm -rf apps/server/data
   pnpm install
   pnpm dev
   ```

---

## 🎉 Успешного тестирования!

Теперь у тебя есть полностью рабочая платформа:
- ✅ Без установки PostgreSQL
- ✅ Без установки Redis
- ✅ Запуск одной командой
- ✅ Всё работает из коробки

Просто запусти `pnpm dev` и тестируй! 🚀
