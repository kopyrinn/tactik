# ✅ ЧЕКЛИСТ ПЕРЕД ЗАПУСКОМ

## Проверь что у тебя установлено:

```bash
# 1. Node.js (версия 18+)
node --version
# Должно быть: v18.x.x или выше

# 2. npm (обычно идёт с Node.js)
npm --version
# Должно быть: 8.x.x или выше
```

Если Node.js нет или версия старая:
→ Скачай с [nodejs.org](https://nodejs.org) (LTS версию)

---

## Пошаговый запуск:

### Шаг 1: Открой папку проекта
```bash
cd pundit
```

### Шаг 2: Запусти setup
```bash
# macOS/Linux:
bash setup.sh

# Windows:
setup.bat
```

Что произойдёт:
- ✅ Установятся все зависимости
- ✅ Создадутся .env файлы

### Шаг 3: Запусти проект
```bash
npm run dev
```

Что произойдёт:
- ✅ Создастся SQLite база (apps/server/data/pundit.db)
- ✅ Запустится backend на порту 3001
- ✅ Запустится frontend на порту 3000

### Шаг 4: Проверь что работает

Открой браузер и зайди на:
```
http://localhost:3000
```

Должна открыться лендинг страница с:
- Кнопкой "Sign Up Free"
- Логотипом "PUNDIT"
- Фразой "DRAW ON LIVE VIDEO"

### Шаг 5: Создай аккаунт

1. Нажми "Sign Up Free"
2. Введи:
   - Email: test@test.com
   - Password: password123
   - Name: Test User
3. Нажми "Create Account"

Должен открыться Dashboard.

### Шаг 6: Создай сессию

1. Нажми "Create New Session"
2. Введи:
   - Session Name: Test Session
   - YouTube URL: https://www.youtube.com/watch?v=jNQXAC9IVRw
3. Нажми "Create Session"

Должна появиться карточка с сессией!

---

## ✅ Если всё работает:

Ты увидишь:
- ✅ Dashboard с одной сессией
- ✅ Карточку сессии с превью YouTube
- ✅ Badge "FREE" возле имени
- ✅ Кнопки "Open" и "Delete"

**🎉 ПОЗДРАВЛЯЮ! ВСЁ РАБОТАЕТ!**

---

## ❌ Если что-то не работает:

### Проблема 1: "npm: command not found"

Решение:
У тебя не установлен Node.js (npm идет вместе с ним).

Решение:
1. Скачай и установи LTS с [nodejs.org](https://nodejs.org)
2. Полностью закрой и открой терминал
3. Проверь:
```bash
node --version
npm --version
```

### Проблема 2: "Port 3000 already in use"

Решение:
```bash
# macOS/Linux:
lsof -ti:3000 | xargs kill -9

# Windows:
netstat -ano | findstr :3000
taskkill /PID <номер> /F
```

### Проблема 3: "Port 3001 already in use"

Решение:
```bash
# macOS/Linux:
lsof -ti:3001 | xargs kill -9

# Windows:
netstat -ano | findstr :3001
taskkill /PID <номер> /F
```

### Проблема 4: Ошибка при установке зависимостей

Решение:
```bash
# Очисти всё
rm -rf node_modules
rm -rf apps/web/node_modules
rm -rf apps/server/node_modules
rm -rf packages/types/node_modules

# Установи заново
npm run install:all
```

### Проблема 5: CORS ошибка в браузере

Проверь `apps/server/.env`:
```env
FRONTEND_URL=http://localhost:3000
```

### Проблема 6: "Cannot connect to database"

Решение:
```bash
# Удали старую базу
rm -rf apps/server/data

# Перезапусти
npm run dev
```

---

## 📝 Проверочный список:

- [ ] Node.js 18+ установлен
- [ ] npm установлен
- [ ] `npm run install:all` выполнен
- [ ] Файл `apps/server/.env` создан
- [ ] Файл `apps/web/.env.local` создан
- [ ] `npm run dev` запущен
- [ ] Backend работает на :3001
- [ ] Frontend работает на :3000
- [ ] Создан тестовый аккаунт
- [ ] Создана тестовая сессия

Если все пункты отмечены ✅ - всё работает идеально!

---

## 🎯 Что дальше?

После того как протестируешь базовый функционал:

1. Изучи код в `apps/web/app/` - там все страницы
2. Посмотри API в `apps/server/src/api/routes/` - там все endpoints
3. Читай PROJECT_STATUS.md - узнаешь что осталось сделать

Следующий шаг - добавить страницу рисования (`/session/[id]`).

Удачи! 🚀
