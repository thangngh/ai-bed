const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

function ensure(dbPath, sql, cb) {
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) return cb(err);
    db.serialize(() => {
      db.run('PRAGMA busy_timeout = 10000');
      db.exec(`BEGIN IMMEDIATE;\n${sql}\nCOMMIT;`, function (execError) {
        if (!execError) {
          db.close((closeError) => cb(closeError));
          return;
        }

        db.run('ROLLBACK', () => db.close(() => cb(execError)));
      });
    });
  });
}

const coreDb = process.env.CORE_DB_PATH || path.join('data', 'core.db');
const localDb = process.env.LOCAL_DB_PATH || path.join('data', 'local.db');

const coreSql = `
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'anonymous',
  auth_type TEXT NOT NULL DEFAULT 'local',
  auth_key TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS child_profiles (
  child_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  child_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  interests TEXT,
  preferred_characters TEXT,
  bedtime_goal TEXT,
  gender TEXT,
  language TEXT NOT NULL DEFAULT 'vi',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedbacks (
  feedback_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  story_id TEXT NOT NULL,
  child_id TEXT,
  listened_complete INTEGER,
  wants_more INTEGER,
  suitable INTEGER,
  rating INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  admin_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
`;

const localSql = `
CREATE TABLE IF NOT EXISTS stories (
  story_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  child_id TEXT,
  request_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  structure_json TEXT,
  theme TEXT NOT NULL,
  goal TEXT,
  mood TEXT,
  language TEXT NOT NULL DEFAULT 'vi',
  safety_status TEXT NOT NULL DEFAULT 'PENDING',
  llm_calls INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  total_latency_ms INTEGER,
  word_count INTEGER,
  is_fallback INTEGER NOT NULL DEFAULT 0,
  is_saved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS story_sections (
  section_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  section_type TEXT NOT NULL,
  content TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  interaction_prompt TEXT,
  interaction_options TEXT
);

CREATE TABLE IF NOT EXISTS memory_items (
  memory_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  child_id TEXT,
  story_id TEXT,
  memory_type TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_text TEXT,
  source TEXT,
  last_reinforced_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

console.log('Ensuring core tables in', coreDb);
ensure(coreDb, coreSql, (err) => {
  if (err) {
    console.error('Failed to ensure core tables:', err.message || err);
    process.exit(1);
  }
  console.log('Core tables ensured.');

  console.log('Ensuring local tables in', localDb);
  ensure(localDb, localSql, (err2) => {
    if (err2) {
      console.error('Failed to ensure local tables:', err2.message || err2);
      process.exit(1);
    }
    console.log('Local tables ensured.');
  });
});
