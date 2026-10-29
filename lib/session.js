import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getDb } from './db.js';
import { HttpError } from './fields.js';
import { cookie, hashToken, newId, readCookie } from './http.js';
import { PLAN_SCOPE, refreshTokens } from './openai-auth.js';

export const SESSION_COOKIE = '__Host-vp_session';
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
const REFRESH_MARGIN_MS = 60 * 1000;

// AES-256-GCM key for OpenAI tokens at rest. Production must set SESSION_SECRET;
// local dev gets a random key persisted under data/ (git-ignored).
let key;
function encryptionKey() {
  if (key) return key;
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.VERCEL) throw new Error('SESSION_SECRET is not configured');
    mkdirSync('data', { recursive: true });
    try {
      secret = readFileSync('data/.session-secret', 'utf8');
    } catch {
      secret = randomBytes(32).toString('base64url');
      writeFileSync('data/.session-secret', secret, { mode: 0o600 });
    }
  }
  key = createHash('sha256').update(secret).digest();
  return key;
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

function decrypt(blob) {
  const raw = Buffer.from(blob, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
}

function tokenSet(tokens, previous = {}) {
  return {
    access_token: tokens.access_token || '',
    refresh_token: tokens.refresh_token || previous.refresh_token || '',
    id_token: tokens.id_token || previous.id_token || '',
  };
}

export async function createSession({ identity, clientId, tokens }) {
  const id = newId(32);
  const now = Date.now();
  const scopes = String(tokens.scope || '');
  const planUsage = scopes.split(' ').includes(PLAN_SCOPE) && !!tokens.access_token;
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO sessions (id_hash, subject, email, name, client_id, sid, scopes, tokens,
            access_expires_at, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      hashToken(id), identity.sub, String(identity.email || ''), String(identity.name || ''), clientId,
      identity.sid ?? null, scopes,
      planUsage ? encrypt(tokenSet(tokens)) : null,
      planUsage ? now + Number(tokens.expires_in || 3600) * 1000 : null,
      now, now + SESSION_TTL_SECONDS * 1000,
    ],
  });
  return cookie(SESSION_COOKIE, id, SESSION_TTL_SECONDS);
}

export function clearSessionCookie() {
  return cookie(SESSION_COOKIE, '', 0);
}

export async function getSession(request) {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id) return null;
  const db = await getDb();
  const { rows } = await db.execute({ sql: 'SELECT * FROM sessions WHERE id_hash = ?', args: [hashToken(id)] });
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await db.execute({ sql: 'DELETE FROM sessions WHERE id_hash = ?', args: [row.id_hash] });
    return null;
  }
  return { ...row, planUsage: row.scopes.split(' ').includes(PLAN_SCOPE) && !!row.tokens };
}

export async function deleteSession(session) {
  const db = await getDb();
  await db.execute({ sql: 'DELETE FROM sessions WHERE id_hash = ?', args: [session.id_hash] });
}

export function sessionTokens(session) {
  return session.tokens ? decrypt(session.tokens) : null;
}

export async function saveSessionModel(session, model) {
  const db = await getDb();
  await db.execute({ sql: 'UPDATE sessions SET model = ? WHERE id_hash = ?', args: [model, session.id_hash] });
}

const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
  'refresh_token_invalidated', 'refresh_token_reused',
]);

// Returns a valid access token, refreshing it near expiry. Refresh tokens rotate, so the
// write only lands if no concurrent request refreshed first; otherwise use theirs.
export async function getAccessToken(session, cfg) {
  const tokens = sessionTokens(session);
  if (!tokens?.access_token) throw new HttpError(403, 'ChatGPT plan usage is not enabled', 'plan_usage_disabled');
  if (session.access_expires_at - REFRESH_MARGIN_MS > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) throw reauth();

  let fresh;
  try {
    fresh = await refreshTokens(cfg, tokens.refresh_token);
  } catch (err) {
    if (TERMINAL_REFRESH_ERRORS.has(err.oauthError)) {
      await deleteSession(session);
      throw reauth();
    }
    throw err;
  }

  const db = await getDb();
  const next = encrypt(tokenSet(fresh, tokens));
  const result = await db.execute({
    sql: 'UPDATE sessions SET tokens = ?, access_expires_at = ? WHERE id_hash = ? AND tokens = ?',
    args: [next, Date.now() + Number(fresh.expires_in || 3600) * 1000, session.id_hash, session.tokens],
  });
  if (result.rowsAffected === 0) {
    const { rows } = await db.execute({ sql: 'SELECT tokens FROM sessions WHERE id_hash = ?', args: [session.id_hash] });
    if (!rows[0]?.tokens) throw reauth();
    return decrypt(rows[0].tokens).access_token;
  }
  return fresh.access_token;
}

function reauth() {
  return new HttpError(401, 'Your ChatGPT session expired. Please sign in again.', 'reauth');
}
