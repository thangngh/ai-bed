#!/usr/bin/env python3
import secrets, hashlib, base64, subprocess, sys
pw = secrets.token_urlsafe(18)
salt = secrets.token_bytes(16)
N=32768; r=8; p=1; dklen=64
key = hashlib.scrypt(pw.encode(), salt=salt, n=N, r=r, p=p, dklen=dklen)
# base64url without padding
s_salt = base64.urlsafe_b64encode(salt).decode().rstrip('=')
s_key = base64.urlsafe_b64encode(key).decode().rstrip('=')
hash_val = f"scrypt${N}${r}${p}${s_salt}${s_key}"
print('Password:', pw)
print('Hash prefix:', hash_val[:60]+"...")
sql = f"""
BEGIN;
CREATE TABLE IF NOT EXISTS admin_users (
  admin_id      TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
UPDATE admin_users SET password_hash = '{hash_val}' WHERE username = 'admin';
INSERT INTO admin_users(admin_id, username, password_hash)
  SELECT lower(hex(randomblob(16))), 'admin', '{hash_val}' WHERE (SELECT changes() = 0);
COMMIT;
"""
# Run sqlite in a temporary alpine container that mounts the volume
cmd = ['docker','run','--rm','-v','ai-bed_be-data:/data','alpine','sh','-lc',"apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/core.db \""+sql.replace('"','\\\"')+"\""]
print('Running sqlite insert...')
try:
    subprocess.check_call(cmd)
except subprocess.CalledProcessError as e:
    print('sqlite command failed', e, file=sys.stderr)
    sys.exit(1)
# save credentials
with open('test-results/sysadmin_credentials.txt','w') as f:
    f.write(f"username: admin\npassword: {pw}\n")
print('Saved credentials to test-results/sysadmin_credentials.txt')
