const crypto = require('crypto');
const pw = crypto.randomBytes(18).toString('base64url');
const salt = crypto.randomBytes(16);
const N = 32768, R = 8, P = 1, KEYLEN = 64, MAXMEM = 64 * 1024 * 1024;
const digest = crypto.scryptSync(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
const hash = ['scrypt', N, R, P, salt.toString('base64url'), digest.toString('base64url')].join('$');
console.log(JSON.stringify({ password: pw, hash }));
