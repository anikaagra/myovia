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

/**
 * Small in-memory limiter: `max` hits per key per window. Only expired entries are ever evicted; when the table
 * is full of live entries it fails closed, so flooding it can't reset someone else's count.
 */
export function limiter({ max = 8, windowMs = 15 * 60 * 1000, capacity = 20000 } = {}) {
  const hits = new Map();
  const sweep = (now) => { for (const [k, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(k); };
  return {
    hit(key, now = Date.now()) {
      let list = hits.get(key);
      if (!list && hits.size >= capacity) { sweep(now); if (hits.size >= capacity) return false; }
      list = (list ?? []).filter((t) => now - t < windowMs);
      list.push(now);
      hits.set(key, list);
      return list.length <= max;
    },
    reset(key) { hits.delete(key); },
  };
}

// Secrets at rest (clinic AI keys): AES-256-GCM with a key derived from RISE_SECRET. Without RISE_SECRET they are
// stored as plain text and the server logs a warning at start-up.
import { createCipheriv, createDecipheriv } from 'node:crypto';
const secretKey = () => (process.env.RISE_SECRET ? createHash('sha256').update(process.env.RISE_SECRET).digest() : null);
export function sealSecret(plain) {
  const k = secretKey();
  if (!k) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `gcm$${iv.toString('base64url')}$${c.getAuthTag().toString('base64url')}$${enc.toString('base64url')}`;
}
export function openSecret(stored) {
  if (!stored || !stored.startsWith('gcm$')) return stored ?? null;
  const k = secretKey();
  if (!k) return null;
  const [, iv, tag, enc] = stored.split('$');
  try {
    const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}
