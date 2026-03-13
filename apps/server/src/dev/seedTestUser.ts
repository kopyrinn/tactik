import bcrypt from 'bcrypt';
import { generateId, getDb } from '../db';

export const DEMO_OWNER_EMAIL = 'demo-owner@system.local';

export async function ensureDemoOwnerUser(): Promise<string> {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_OWNER_EMAIL) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = generateId();
  const passwordHash = await bcrypt.hash(`demo-${id}`, 12);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, plan, subscription_status)
     VALUES (?, ?, ?, ?, 'pro', 'active')`
  ).run(id, DEMO_OWNER_EMAIL, passwordHash, 'Demo System');
  console.log('[seed] Created demo owner user');
  return id;
}

type ExistingUser = {
  id: string;
};

const DEFAULT_EMAIL = 'pro@test.local';
const DEFAULT_PASSWORD = 'PunditPro123!';
const DEFAULT_NAME = 'Pro Test User';
const DEFAULT_EMAIL_2 = 'pro2@test.local';
const DEFAULT_PASSWORD_2 = 'PunditPro456!';
const DEFAULT_NAME_2 = 'Pro Test User 2';

function getFutureIsoDate(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

export async function ensureTestProUser() {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  if (process.env.SEED_TEST_USER === 'false') {
    return;
  }

  const db = getDb();

  const upsertProUser = async (opts: {
    email: string;
    password: string;
    name: string;
    subscriptionEndDate: string;
  }) => {
    const passwordHash = await bcrypt.hash(opts.password, 12);
    const existing = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(opts.email) as ExistingUser | undefined;

    if (existing) {
      db.prepare(
        `UPDATE users
         SET password_hash = ?,
             name = ?,
             plan = 'pro',
             subscription_status = 'active',
             subscription_end_date = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(passwordHash, opts.name, opts.subscriptionEndDate, existing.id);

      console.log(`[seed] Updated test PRO user: ${opts.email}`);
      return;
    }

    db.prepare(
      `INSERT INTO users (
        id,
        email,
        password_hash,
        name,
        plan,
        subscription_status,
        subscription_end_date
      ) VALUES (?, ?, ?, ?, 'pro', 'active', ?)`
    ).run(generateId(), opts.email, passwordHash, opts.name, opts.subscriptionEndDate);

    console.log(`[seed] Created test PRO user: ${opts.email}`);
  };

  await upsertProUser({
    email: process.env.DEV_TEST_USER_EMAIL || DEFAULT_EMAIL,
    password: process.env.DEV_TEST_USER_PASSWORD || DEFAULT_PASSWORD,
    name: process.env.DEV_TEST_USER_NAME || DEFAULT_NAME,
    subscriptionEndDate: process.env.DEV_TEST_USER_SUBSCRIPTION_END || getFutureIsoDate(3650),
  });

  if (process.env.SEED_SECOND_TEST_USER !== 'false') {
    await upsertProUser({
      email: process.env.DEV_TEST_USER_2_EMAIL || DEFAULT_EMAIL_2,
      password: process.env.DEV_TEST_USER_2_PASSWORD || DEFAULT_PASSWORD_2,
      name: process.env.DEV_TEST_USER_2_NAME || DEFAULT_NAME_2,
      subscriptionEndDate: process.env.DEV_TEST_USER_2_SUBSCRIPTION_END || getFutureIsoDate(3650),
    });
  }
}
