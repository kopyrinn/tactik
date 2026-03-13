import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database;
const DEMO_METRIC_COLUMN_BY_KIND = {
  starts: 'starts',
  sessionsCreated: 'sessions_created',
  participantJoins: 'participant_joins',
} as const;

export type DemoMetricKind = keyof typeof DEMO_METRIC_COLUMN_BY_KIND;

function syncDemoLoginCounter(database: Database.Database) {
  const row = database.prepare(
    `SELECT MAX(CAST(SUBSTR(email, 5, INSTR(email, '@') - 5) AS INTEGER)) AS max_index
     FROM users
     WHERE email GLOB 'test[0-9]*@demo.local'`
  ).get() as { max_index: number | null };

  const maxIndex = Number(row?.max_index || 0);
  if (Number.isFinite(maxIndex) && maxIndex > 0) {
    database
      .prepare(
        `UPDATE demo_login_counter
         SET value = CASE WHEN value < ? THEN ? ELSE value END
         WHERE id = 1`
      )
      .run(maxIndex, maxIndex);
  }
}

function normalizeSqlParams(sql: string, params: any[]): { sql: string; params: any[] } {
  const indexes: number[] = [];
  const normalizedSql = sql.replace(/\$(\d+)/g, (_, index: string) => {
    indexes.push(Number(index) - 1);
    return '?';
  });

  if (indexes.length === 0) {
    return { sql, params };
  }

  return {
    sql: normalizedSql,
    params: indexes.map((i) => params[i]),
  };
}

// Generate UUID for SQLite
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function initDatabase() {
  const dbPath = path.join(__dirname, '../../data/pundit.db');
  
  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create tables
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT,
      avatar_url TEXT,
      plan TEXT DEFAULT 'free',
      coach_owner_id TEXT,
      subscription_status TEXT DEFAULT 'inactive',
      subscription_end_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      youtube_url TEXT NOT NULL,
      youtube_video_id TEXT NOT NULL,
      qr_code TEXT,
      board_piece_labels TEXT,
      board_state TEXT,
      max_participants INTEGER DEFAULT 2,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_participants (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      color TEXT NOT NULL,
      role TEXT DEFAULT 'drawer',
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drawings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT,
      video_timestamp REAL NOT NULL,
      tool TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS demo_login_counter (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      value INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS demo_metrics_daily (
      day TEXT PRIMARY KEY,
      starts INTEGER NOT NULL DEFAULT 0,
      sessions_created INTEGER NOT NULL DEFAULT 0,
      participant_joins INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);
    CREATE INDEX IF NOT EXISTS idx_participants_session ON session_participants(session_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_session_user ON session_participants(session_id, user_id);
  `;

  db.exec(schema);
  db.prepare('INSERT OR IGNORE INTO demo_login_counter (id, value) VALUES (1, 0)').run();

  // Lightweight migration for existing SQLite DB files.
  const sessionColumns = db
    .prepare("PRAGMA table_info('sessions')")
    .all() as Array<{ name: string }>;
  const hasBoardLabelsColumn = sessionColumns.some((column) => column.name === 'board_piece_labels');
  if (!hasBoardLabelsColumn) {
    db.prepare('ALTER TABLE sessions ADD COLUMN board_piece_labels TEXT').run();
  }
  const hasBoardStateColumn = sessionColumns.some((column) => column.name === 'board_state');
  if (!hasBoardStateColumn) {
    db.prepare('ALTER TABLE sessions ADD COLUMN board_state TEXT').run();
  }
  const hasJoinCodeColumn = sessionColumns.some((column) => column.name === 'join_code');
  if (!hasJoinCodeColumn) {
    db.prepare('ALTER TABLE sessions ADD COLUMN join_code TEXT').run();
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_join_code ON sessions(join_code)').run();
  }
  const hasIsDemoColumn = sessionColumns.some((column) => column.name === 'is_demo');
  if (!hasIsDemoColumn) {
    db.prepare('ALTER TABLE sessions ADD COLUMN is_demo INTEGER DEFAULT 0').run();
  }
  const hasDemoExpiresAtColumn = sessionColumns.some((column) => column.name === 'demo_expires_at');
  if (!hasDemoExpiresAtColumn) {
    db.prepare('ALTER TABLE sessions ADD COLUMN demo_expires_at TEXT').run();
  }
  const hasDemoRoomCodeColumn = sessionColumns.some((column) => column.name === 'demo_room_code');
  if (!hasDemoRoomCodeColumn) {
    db.prepare('ALTER TABLE sessions ADD COLUMN demo_room_code TEXT').run();
  }
  db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_demo_room_code ON sessions(demo_room_code)').run();

  // Override limits per user
  const userColumns = db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string }>;
  if (!userColumns.some((c) => c.name === 'max_devices_override')) {
    db.prepare('ALTER TABLE users ADD COLUMN max_devices_override INTEGER').run();
  }
  if (!userColumns.some((c) => c.name === 'max_sessions_override')) {
    db.prepare('ALTER TABLE users ADD COLUMN max_sessions_override INTEGER').run();
  }
  if (!userColumns.some((c) => c.name === 'max_participants_override')) {
    db.prepare('ALTER TABLE users ADD COLUMN max_participants_override INTEGER').run();
  }
  if (!userColumns.some((c) => c.name === 'is_demo_user')) {
    db.prepare('ALTER TABLE users ADD COLUMN is_demo_user INTEGER DEFAULT 0').run();
  }
  if (!userColumns.some((c) => c.name === 'demo_expires_at')) {
    db.prepare('ALTER TABLE users ADD COLUMN demo_expires_at TEXT').run();
  }
  if (!userColumns.some((c) => c.name === 'coach_owner_id')) {
    db.prepare('ALTER TABLE users ADD COLUMN coach_owner_id TEXT').run();
  }
  db.prepare('CREATE INDEX IF NOT EXISTS idx_users_coach_owner ON users(coach_owner_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_users_demo_expiry ON users(is_demo_user, demo_expires_at)').run();
  db.prepare('CREATE TABLE IF NOT EXISTS demo_login_counter (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL DEFAULT 0)').run();
  db.prepare('INSERT OR IGNORE INTO demo_login_counter (id, value) VALUES (1, 0)').run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS demo_metrics_daily (
      day TEXT PRIMARY KEY,
      starts INTEGER NOT NULL DEFAULT 0,
      sessions_created INTEGER NOT NULL DEFAULT 0,
      participant_joins INTEGER NOT NULL DEFAULT 0
    )`
  ).run();
  syncDemoLoginCounter(db);

  console.log('SQLite database initialized at:', dbPath);
  
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function query<T = any>(sql: string, params: any[] = []): T[] {
  const db = getDb();
  const normalized = normalizeSqlParams(sql, params);
  const stmt = db.prepare(normalized.sql);
  if (stmt.reader) {
    return stmt.all(...normalized.params) as T[];
  }

  stmt.run(...normalized.params);
  return [];
}

export function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  const db = getDb();
  
  // Handle INSERT with RETURNING
  if (sql.includes('INSERT') && sql.includes('RETURNING')) {
    const id = generateId();
    
    // Extract table name and columns
    const tableMatch = sql.match(/INSERT INTO (\w+)/i);
    const tableName = tableMatch ? tableMatch[1] : '';
    
    // Build INSERT without RETURNING
    const insertSql = sql.split('RETURNING')[0].replace('INSERT INTO', `INSERT INTO`);
    const normalizedInsert = normalizeSqlParams(insertSql, [id, ...params]);
    const stmt = db.prepare(normalizedInsert.sql);
    stmt.run(...normalizedInsert.params);
    
    // Get the inserted row
    const selectStmt = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`);
    return selectStmt.get(id) as T;
  }
  
  // Handle UPDATE with RETURNING
  if (sql.includes('UPDATE') && sql.includes('RETURNING')) {
    const updateSql = sql.split('RETURNING')[0];
    const normalizedUpdate = normalizeSqlParams(updateSql, params);
    const stmt = db.prepare(normalizedUpdate.sql);
    stmt.run(...normalizedUpdate.params);
    
    // Get the updated row - extract WHERE clause
    const whereMatch = sql.match(/WHERE (.+?) RETURNING/i);
    if (whereMatch) {
      const whereClause = whereMatch[1];
      const tableMatch = sql.match(/UPDATE (\w+)/i);
      const tableName = tableMatch ? tableMatch[1] : '';
      
      const selectSql = `SELECT * FROM ${tableName} WHERE ${whereClause}`;
      const normalizedSelect = normalizeSqlParams(selectSql, params);
      const selectStmt = db.prepare(normalizedSelect.sql);
      return (selectStmt.get(...normalizedSelect.params) as T) || null;
    }
  }
  
  // Regular SELECT
  const normalized = normalizeSqlParams(sql, params);
  const stmt = db.prepare(normalized.sql);
  return (stmt.get(...normalized.params) as T) || null;
}

export function incrementDemoMetric(kind: DemoMetricKind, amount = 1, at = new Date()) {
  if (!Number.isFinite(amount) || amount <= 0) return;

  try {
    const day = at.toISOString().slice(0, 10);
    const column = DEMO_METRIC_COLUMN_BY_KIND[kind];
    const db = getDb();

    db.prepare('INSERT OR IGNORE INTO demo_metrics_daily (day) VALUES (?)').run(day);
    db.prepare(`UPDATE demo_metrics_daily SET ${column} = ${column} + ? WHERE day = ?`).run(amount, day);
  } catch (error) {
    console.error('incrementDemoMetric error:', error);
  }
}
