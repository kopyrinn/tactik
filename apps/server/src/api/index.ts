import { Express } from 'express';
import authRoutes from './routes/auth';
import sessionRoutes from './routes/sessions';
import userRoutes from './routes/user';
import adminRoutes from './routes/admin';
import demoRoutes from './routes/demo';

export function setupApiRoutes(app: Express) {
  app.use('/api/auth', authRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/demo', demoRoutes);
}
