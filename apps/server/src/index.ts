import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { setupSocketHandlers } from './socket';
import { setupApiRoutes } from './api';
import { initDatabase, query } from './db';
import { deleteAllUserSessions, initRedis } from './redis';
import { deleteSessionWithArtifacts } from './utils/deleteSession';
import { ensureTestProUser, ensureDemoOwnerUser } from './dev/seedTestUser';
import { installConsoleErrorCapture, recordServerError } from './monitoring/errors';

dotenv.config();
installConsoleErrorCapture();

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

const app = express();
const httpServer = createServer(app);
const isDevelopment = process.env.NODE_ENV !== 'production';
const configuredFrontendOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  if (configuredFrontendOrigins.includes(origin)) return true;

  if (!isDevelopment) return false;

  // Allow local/LAN origins in development (phone/tablet on same network).
  return /^https?:\/\/(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(:\d+)?$/i.test(origin);
}

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Socket CORS blocked for origin: ${origin || 'unknown'}`));
    },
    credentials: true,
  },
});

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`HTTP CORS blocked for origin: ${origin || 'unknown'}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
setupApiRoutes(app);

// Socket.IO handlers
setupSocketHandlers(io);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  recordServerError('express.error', err, {
    path: req.path,
    method: req.method,
  });
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// Initialize connections
async function start() {
  try {
    // Initialize database
    await initDatabase();
    console.log('Database connected');

    // Initialize Redis
    await initRedis();
    console.log('Redis connected');

    // Ensure test user for local development
    await ensureTestProUser();

    // Ensure demo system user (always)
    await ensureDemoOwnerUser();

    // Clean up expired demo data
    setInterval(async () => {
      try {
        const nowIso = new Date().toISOString();

        const expiredDemoSessions = query<{ id: string }>(
          'SELECT id FROM sessions WHERE is_demo = 1 AND demo_expires_at < $1',
          [nowIso]
        );

        for (const row of expiredDemoSessions) {
          await deleteSessionWithArtifacts(row.id);
        }

        const expiredDemoUsers = query<{ id: string }>(
          'SELECT id FROM users WHERE is_demo_user = 1 AND demo_expires_at < $1',
          [nowIso]
        );

        for (const user of expiredDemoUsers) {
          const ownedSessions = query<{ id: string }>(
            'SELECT id FROM sessions WHERE owner_id = $1',
            [user.id]
          );

          for (const session of ownedSessions) {
            await deleteSessionWithArtifacts(session.id);
          }

          await deleteAllUserSessions(user.id);
          query('DELETE FROM users WHERE id = $1', [user.id]);
        }
      } catch (err) {
        console.error('Demo cleanup error:', err);
      }
    }, 15 * 1000);

    // Start server
    const PORT = process.env.PORT || 3001;
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log('Socket.IO listening');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  recordServerError('process.unhandledRejection', reason);
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  recordServerError('process.uncaughtException', error);
  console.error('Uncaught exception:', error);
});
