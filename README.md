# 🎯 PUNDIT - Ready to Run Locally!

## ⚡ Быстрый запуск (3 команды)

```bash
./setup.sh          # macOS/Linux (или setup.bat для Windows)
npm run dev
```

Открывай **http://localhost:3000** - готово! 🎉

---

## ✅ Что уже работает БЕЗ установки баз данных:

- ✅ SQLite вместо PostgreSQL (автосоздание)
- ✅ In-memory вместо Redis (автозапуск)
- ✅ Регистрация/Логин
- ✅ Dashboard с сессиями
- ✅ Создание/удаление сессий
- ✅ JWT авторизация
- ✅ Plan system (FREE/COACH/PRO)

**Всё запускается ОДНОЙ командой `npm run dev`!**

---

## 📖 Документация

1. **LOCAL_SETUP.md** ← НАЧНИ С ЭТОГО (подробная инструкция)
2. **PROJECT_STATUS.md** - что сделано, что осталось
3. **ARCHITECTURE.md** - техническая архитектура

---

## 🚀 Что нужно для запуска

**Необходимо:**
- Node.js 18+ ([скачать](https://nodejs.org))

**НЕ нужно:**
- ❌ PostgreSQL
- ❌ Redis  
- ❌ Docker

Всё встроено!

---

## 🧪 Быстрый тест

```bash
# 1. Setup
./setup.sh

# 2. Start
npm run dev

# 3. Тестируй:
# - http://localhost:3000 (фронт)
# - http://localhost:3001/health (бэкенд)

# 4. Создай аккаунт и первую сессию!
```

---

## 🎉 Удачи!

Всё готово к запуску. Просто введи:
```bash
npm run dev
```

И начинай тестировать! 🚀
