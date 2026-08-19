#!/usr/bin/env node
const crypto = require('crypto');
const { randomBytes, scryptSync } = crypto;
const sqlite3 = require('sqlite3').verbose();
const dbPath = process.env.CORE_DB_PATH || 'data/core.db';
const password = process.env.ADMIN_PASSWORD;
const username = process.env.ADMIN_USERNAME || 'sysadmin';
if(!password){ console.error('ADMIN_PASSWORD not set'); process.exit(2); }
const N = 32768, R = 8, P = 1, KEYLEN = 64, MAXMEM = 64*1024*1024;
const salt = randomBytes(16);
const digest = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
const hash = ['scrypt', N, R, P, salt.toString('base64url'), digest.toString('base64url')].join('$');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err)=>{ if(err){ console.error('DB open error', err); process.exit(3); }});
db.serialize(()=>{
  db.run(`CREATE TABLE IF NOT EXISTS admin_users (
      admin_id      TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    )`);
  const id = crypto.randomUUID();
  db.get('SELECT admin_id FROM admin_users WHERE username = ?', [username], function(err,row){
    if(err){ console.error('DB select error', err); process.exit(4); }
    if(row){
      db.run('UPDATE admin_users SET password_hash = ? WHERE admin_id = ?', [hash, row.admin_id], function(err2){
        if(err2){ console.error('DB update error', err2); process.exit(5); }
        console.log(`Password reset for admin "${username}" in ${dbPath}.`);
        process.exit(0);
      });
    } else {
      db.run('INSERT INTO admin_users (admin_id, username, password_hash) VALUES (?,?,?)',[id, username, hash], function(err3){
        if(err3){ console.error('DB insert error', err3); process.exit(6); }
        console.log(`Admin "${username}" created in ${dbPath}.`);
        process.exit(0);
      });
    }
  });
});
