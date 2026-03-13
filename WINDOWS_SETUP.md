# 🚀 БЫСТРЫЙ СТАРТ ДЛЯ WINDOWS

## Вариант 1: Автоматическая установка (рекомендуется)

```cmd
setup.bat
npm run dev
```

Готово! Открывай http://localhost:3000

---

## Вариант 2: Ручная установка (если setup.bat не работает)

### Шаг 1: Установи зависимости
```cmd
npm install
```

Это займёт 2-3 минуты. Подожди пока установится.

### Шаг 2: Создай .env файлы

**Backend:**
```cmd
cd apps\server
copy .env.example .env
cd ..\..
```

Отредактируй `apps\server\.env` (можно в Блокноте):
```
PORT=3001
NODE_ENV=development
JWT_SECRET=измени-на-любую-длинную-строку-минимум-32-символа
FRONTEND_URL=http://localhost:3000
```

**Frontend:**
```cmd
cd apps\web
copy .env.local.example .env.local
cd ..\..
```

Файл `apps\web\.env.local` должен содержать:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Шаг 3: Запусти проект
```cmd
npm run dev
```

Подожди 10-20 секунд пока запустится...

Увидишь:
```
✅ SQLite database initialized
🚀 Server running on port 3001
▲ Next.js 14.x.x
- Local:   http://localhost:3000
```

### Шаг 4: Открой браузер
```
http://localhost:3000
```

---

## 🧪 Тестирование

1. Нажми **"Sign Up Free"**
2. Создай аккаунт:
   - Email: test@test.com
   - Password: password123
   - Name: Test User
3. Нажми **"Create Account"**
4. Ты попадёшь в Dashboard
5. Нажми **"Create New Session"**
6. Введи:
   - Session Name: Test Session
   - YouTube URL: https://www.youtube.com/watch?v=jNQXAC9IVRw
7. Нажми **"Create Session"**

Сессия должна появиться в списке! ✅

---

## ❌ Проблемы?

### "npm: command not found"
Установи Node.js с [nodejs.org](https://nodejs.org) (версия LTS)

### Порт 3000 занят
```cmd
netstat -ano | findstr :3000
taskkill /PID <номер> /F
```

### Порт 3001 занят
```cmd
netstat -ano | findstr :3001
taskkill /PID <номер> /F
```

### Ошибки при установке
```cmd
rmdir /s /q node_modules
rmdir /s /q apps\web\node_modules
rmdir /s /q apps\server\node_modules
npm install
```

### База данных не создаётся
```cmd
rmdir /s /q apps\server\data
npm run dev
```

---

## 📁 Где что находится

**База данных:**
```
apps\server\data\pundit.db
```

Открыть в:
- [DB Browser for SQLite](https://sqlitebrowser.org/)
- VSCode extension "SQLite"

**Логи сервера:**
В PowerShell где запущен `npm run dev`

**Код:**
- Фронтенд: `apps\web\app\`
- API: `apps\server\src\api\routes\`

---

## 🎯 Что работает

- ✅ Регистрация
- ✅ Логин
- ✅ Dashboard
- ✅ Создание сессий
- ✅ Удаление сессий
- ✅ Plan badges (FREE/COACH/PRO)
- ✅ SQLite автосоздание

---

## 💡 Следующий шаг

После того как всё работает, можешь:

1. Посмотреть код страниц в `apps\web\app\`
2. Посмотреть API в `apps\server\src\api\routes\`
3. Поэкспериментировать с дизайном
4. Добавить новые фичи

Удачи! 🚀
