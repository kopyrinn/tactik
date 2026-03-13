# Pundit - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Node.js 18+
- pnpm 8+ (`npm install -g pnpm`)
- PostgreSQL (or Supabase account)
- Redis (or Upstash account)

### Option 1: Cloud Setup (Recommended)

#### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → Sign up
2. Create new project
3. Go to SQL Editor → Paste contents of `apps/server/db/schema.sql` → Run
4. Go to Settings → Database → Copy connection string

#### 2. Create Upstash Redis
1. Go to [upstash.com](https://upstash.com) → Sign up
2. Create new Redis database
3. Copy connection string

#### 3. Install & Configure

```bash
# Clone/download the project
cd pundit

# Install all dependencies
pnpm install

# Configure backend
cd apps/server
cp .env.example .env

# Edit .env with your credentials:
# DATABASE_URL=your-supabase-connection-string
# REDIS_URL=your-upstash-connection-string
# JWT_SECRET=generate-a-random-string-here

# Configure frontend
cd ../web
cp .env.local.example .env.local

# .env.local should have:
# NEXT_PUBLIC_API_URL=http://localhost:3001
```

#### 4. Start Development

```bash
# From project root
pnpm dev

# This starts BOTH:
# - Backend: http://localhost:3001
# - Frontend: http://localhost:3000
```

#### 5. Test It Out

1. Open http://localhost:3000
2. Click "Sign Up Free"
3. Create account
4. Create your first session!

---

### Option 2: Local Setup

#### 1. Install PostgreSQL
```bash
# macOS
brew install postgresql@14
brew services start postgresql@14

# Ubuntu
sudo apt install postgresql-14
sudo systemctl start postgresql

# Create database
createdb pundit
psql pundit < apps/server/db/schema.sql
```

#### 2. Install Redis
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu
sudo apt install redis-server
sudo systemctl start redis

# Or use Docker
docker run -d -p 6379:6379 redis:7-alpine
```

#### 3. Follow steps 3-5 from Option 1

---

## 📦 What's Included

**Backend (Node.js):**
- ✅ Authentication (register/login/logout)
- ✅ Session management
- ✅ Real-time Socket.IO
- ✅ PostgreSQL database
- ✅ Redis sessions
- ✅ JWT auth

**Frontend (Next.js):**
- ✅ Landing page
- ✅ Login/Register pages
- ✅ Dashboard with sessions
- ✅ Create session modal
- ✅ Responsive design
- ✅ Tailwind CSS

**TODO:**
- ⏳ Drawing canvas
- ⏳ YouTube player
- ⏳ Real-time sync
- ⏳ Payment integration

---

## 🧪 Testing the API

### Register User
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123","name":"Test"}' \
  -c cookies.txt
```

### Create Session
```bash
curl -X POST http://localhost:3001/api/sessions \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"Test Session","youtubeUrl":"https://youtube.com/watch?v=abc123"}'
```

### List Sessions
```bash
curl http://localhost:3001/api/sessions -b cookies.txt
```

---

## 📁 Project Structure

```
pundit/
├── apps/
│   ├── web/              # Next.js frontend
│   │   ├── app/          # Pages & routes
│   │   ├── components/   # React components
│   │   └── lib/          # API client & stores
│   │
│   └── server/           # Node.js backend
│       ├── src/
│       │   ├── api/      # REST endpoints
│       │   ├── socket/   # Socket.IO handlers
│       │   ├── db/       # Database queries
│       │   └── redis/    # Redis operations
│       └── db/schema.sql # Database schema
│
└── packages/
    └── types/            # Shared TypeScript types
```

---

## 🐛 Troubleshooting

### "Port 3001 already in use"
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9
```

### "Cannot connect to database"
- Check DATABASE_URL in .env
- Test connection: `psql "your-database-url"`
- Make sure PostgreSQL is running

### "Cannot connect to Redis"
- Check REDIS_URL in .env
- Test connection: `redis-cli ping`
- Make sure Redis is running

### Frontend can't reach backend
- Check NEXT_PUBLIC_API_URL in .env.local
- Make sure backend is running on port 3001
- Try: curl http://localhost:3001/health

---

## 📚 Next Steps

1. **Complete MVP:**
   - Implement drawing canvas
   - Add YouTube player
   - Connect Socket.IO for real-time

2. **Add Features:**
   - QR code joining
   - Drawing tools (arrows, circles, lines)
   - Session replay

3. **Production Ready:**
   - Deploy backend to Railway
   - Deploy frontend to Vercel
   - Add payment integration

---

## 🆘 Need Help?

- 📖 Read full documentation in README.md
- 🔧 Check ARCHITECTURE.md for technical details
- 💬 Create an issue on GitHub

---

## 🎯 Current Status

**✅ Phase 1 Complete:**
- Full authentication system
- Session CRUD operations
- Dashboard UI
- Database schema
- Real-time architecture

**🚧 Phase 2 In Progress:**
- Drawing canvas
- YouTube integration
- Socket.IO client connection

**📋 Phase 3 Planned:**
- Payment integration
- Advanced features
- Mobile optimization

---

Built with ❤️ for coaches, creators, and studios.
