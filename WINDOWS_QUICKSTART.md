# 🚀 БЫСТРЫЙ СТАРТ (WINDOWS)

## Шаг 1: Setup (один раз)

Кликни 2 раза на `setup.bat` и подожди 2-3 минуты.

Увидишь:
```
✅ Setup complete!
```

## Шаг 2: Запуск

Кликни 2 раза на `start.bat`

Откроются 2 окна PowerShell:
- **Pundit Backend** (порт 3001)
- **Pundit Frontend** (порт 3000)

Подожди 10-20 секунд пока запустится.

## Шаг 3: Открой браузер

```
http://localhost:3000
```

## Шаг 4: Тестируй!

1. Нажми **"Sign Up Free"**
2. Создай аккаунт
3. Создай сессию
4. Готово! 🎉

---

## ⚠️ Если setup.bat не работает

Открой PowerShell и запусти вручную:

```powershell
cd apps\server
npm install
cd ..\..

cd apps\web
npm install
cd ..\..
```

---

## ⚠️ Если start.bat не работает

Открой 2 PowerShell окна и в каждом:

**Окно 1 (Backend):**
```powershell
cd apps\server
npm run dev
```

**Окно 2 (Frontend):**
```powershell
cd apps\web
npm run dev
```

---

## 🛑 Как остановить

Просто закрой оба окна PowerShell.

Или нажми `Ctrl+C` в каждом окне.

---

## 📁 Где база данных

```
apps\server\data\pundit.db
```

Открыть в [DB Browser for SQLite](https://sqlitebrowser.org/)

---

## 🎯 Готово!

Всё работает! Открывай http://localhost:3000 и тестируй! 🚀
