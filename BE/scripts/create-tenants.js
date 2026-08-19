const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.CORE_DB_PATH || path.join('data', 'core.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open database', dbPath, err.message);
    process.exit(1);
  }
});

const sql = `
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'anonymous',
  auth_type TEXT NOT NULL DEFAULT 'local',
  auth_key TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
`;

db.serialize(() => {
  db.run(sql, function (err) {
    if (err) {
      console.error('Error creating tenants table:', err.message);
      process.exit(1);
    }
    console.log(`Ensured tenants table exists in ${dbPath}`);
    db.close();
  });
});
