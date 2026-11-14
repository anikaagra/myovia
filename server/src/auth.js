import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

// Passwords: scrypt with a per-user salt. Tokens: random 32 bytes, stored only as a SHA-256 hash,
// so a copy of the database can't be used to sign in.

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, key] = String(stored ?? '').split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const got = scryptSync(String(password), Buffer.from(salt, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, got);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('base64url');

/** Six-digit code for moving a patient to a new phone. */
export const newLinkCode = () => String(100000 + (randomBytes(4).readUInt32BE() % 900000));

export function bearer(req) {
  const h = req.get('authorization') ?? '';
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(h);
  return m ? m[1] : null;
}

/** Small in-memory limiter for sign-in attempts: `max` tries per key per window. */
export function limiter({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return {
    hit(key, now = Date.now()) {
      const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      list.push(now);
      hits.set(key, list);
      if (hits.size > 5000) for (const k of hits.keys()) { hits.delete(k); if (hits.size < 4000) break; }
      return list.length <= max;
    },
    reset(key) { hits.delete(key); },
  };
}
