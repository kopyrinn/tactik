-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  name VARCHAR(255),
  avatar_url TEXT,
  plan VARCHAR(20) DEFAULT 'free' CHECK (plan IN ('free', 'coach', 'pro')),
  subscription_status VARCHAR(20) DEFAULT 'inactive' CHECK (subscription_status IN ('inactive', 'active', 'cancelled', 'expired')),
  subscription_end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  youtube_url TEXT NOT NULL,
  youtube_video_id VARCHAR(20) NOT NULL,
  qr_code TEXT,
  board_piece_labels JSONB,
  board_state JSONB,
  max_participants INT DEFAULT 2,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Session participants table
CREATE TABLE session_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  color VARCHAR(7) NOT NULL,
  role VARCHAR(20) DEFAULT 'drawer' CHECK (role IN ('owner', 'drawer', 'viewer')),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(session_id, user_id)
);

-- Drawings table
CREATE TABLE drawings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  video_timestamp FLOAT NOT NULL,
  tool VARCHAR(20) NOT NULL CHECK (tool IN ('arrow', 'circle', 'line', 'freehand', 'text')),
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Subscriptions table
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan VARCHAR(20) NOT NULL CHECK (plan IN ('free', 'coach', 'pro')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  payment_provider VARCHAR(20) CHECK (payment_provider IN ('kaspi', 'cloudpayments', 'stripe')),
  external_subscription_id VARCHAR(255),
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Usage logs table
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_sessions_owner ON sessions(owner_id);
CREATE INDEX idx_sessions_active ON sessions(is_active);
CREATE INDEX idx_participants_session ON session_participants(session_id);
CREATE INDEX idx_drawings_session ON drawings(session_id);
CREATE INDEX idx_drawings_timestamp ON drawings(video_timestamp);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_usage_user ON usage_logs(user_id);
CREATE INDEX idx_usage_created ON usage_logs(created_at);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
