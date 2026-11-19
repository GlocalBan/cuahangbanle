'use strict';
const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const DEFAULT_SECRET = process.env.JWT_SECRET || 'retailflow-ood-841111-jwt-secret-key';
const DEFAULT_TTL_SEC = Number(process.env.JWT_EXPIRES_SECONDS || 28800); // 8 hours

function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length < 6) {
    throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plainPassword, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plainPassword, storedHash) {
  if (typeof plainPassword !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexHash] = parts;
  try {
    const derived = crypto.scryptSync(plainPassword, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signToken(payload, secret = DEFAULT_SECRET, ttlSeconds = DEFAULT_TTL_SEC) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    jti: crypto.randomUUID(),
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(body));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return {
    token: `${signingInput}.${signature}`,
    jti: body.jti,
    exp: body.exp,
  };
}

function verifyToken(token, secret = DEFAULT_SECRET) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
};
