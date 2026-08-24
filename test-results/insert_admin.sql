BEGIN;
CREATE TABLE IF NOT EXISTS admin_users (
  admin_id      TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
UPDATE admin_users SET password_hash = 'scrypt$32768$8$1$c5GBg9nXnHcqpJsiH7PQCA$DQ85Bnk1bVtVziWuRKeqJ4p_ul2fsCknWBZHcZbhiirhq7XGQOqkd5BlYzzIMPjwHWYVz-kWU-oNm1n3NpJqrQ' WHERE username = 'admin';
INSERT INTO admin_users(admin_id, username, password_hash)
  SELECT lower(hex(randomblob(16))), 'admin', 'scrypt$32768$8$1$c5GBg9nXnHcqpJsiH7PQCA$DQ85Bnk1bVtVziWuRKeqJ4p_ul2fsCknWBZHcZbhiirhq7XGQOqkd5BlYzzIMPjwHWYVz-kWU-oNm1n3NpJqrQ' WHERE (SELECT changes() = 0);
COMMIT;
