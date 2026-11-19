// Event mode: attendees reach the owner's laptop through a tunnel and use the coach on an API key.
// This module owns every event rule (eng review D3): who the owner is, the attendee cookie,
// concurrency caps, session bindings and the spend log. Nothing here trusts the Host header alone.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cookie, readCookie } from './http.js';

// ------------------------------------------------------------ owner (D4: one listener + checks)

// dev-server records each Request's socket address here; never derived from a header.
const sockets = new WeakMap();
export function tagRequest(request, remoteAddress) {
  sockets.set(request, remoteAddress || '');
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// Any of these means the request came through a proxy or tunnel, even if the socket is loopback.
const FORWARDING = ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-real-ip', 'cf-connecting-ip', 'cf-ray'];

export function isOwner(request) {
  if (process.env.VERCEL) return false;
  if (!LOOPBACK.has(sockets.get(request))) return false;
  if (FORWARDING.some((h) => request.headers.has(h))) return false;
  return /^127\.0\.0\.1(:\d+)?$/.test(request.headers.get('host') || '');
}

// ------------------------------------------------------------ attendees (D5: code exchanged once for a cookie)

export const EVENT_COOKIE = 'vp_event';
const COOKIE_MAX_AGE = 7 * 24 * 3600;

// The owner asked for event mode (EVENT_CODE set on a local server). Access rules key off this, so
// a missing ANTHROPIC_API_KEY locks attendees out instead of opening writes to everyone.
export function eventRequested() {
  return !process.env.VERCEL && !!process.env.EVENT_CODE;
}

// Event mode is actually running: requested and the coach has an API key to spend.
export function eventEnabled() {
  return eventRequested() && !!process.env.ANTHROPIC_API_KEY;
}

function sha(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function codeMatches(code) {
  if (!eventEnabled() || typeof code !== 'string' || !code) return false;
  return timingSafeEqual(sha(code), sha(process.env.EVENT_CODE));
}

// Stable, non-secret label for this event's rows in the database (never the code itself).
export function eventTag() {
  return eventEnabled() ? sha(`event:${process.env.EVENT_CODE}`).toString('hex').slice(0, 12) : null;
}

// The cookie key mixes a server-only secret (kept in data/event-state.json) with the code: attendees
// know the code but not the secret, so they cannot forge ids. It survives a restart, and changing
// the code still revokes everyone.
function cookieKey() {
  const s = load();
  if (!s.secret) {
    s.secret = randomBytes(32).toString('base64url');
    persist();
  }
  return createHmac('sha256', s.secret).update(process.env.EVENT_CODE).digest();
}

function sign(id) {
  return createHmac('sha256', cookieKey()).update(id).digest('base64url');
}

// Set-Cookie value for a new attendee.
export function attendeeCookie(request) {
  const id = randomBytes(12).toString('base64url');
  return cookie(request, EVENT_COOKIE, `${id}.${sign(id)}`, COOKIE_MAX_AGE);
}

export function attendeeId(request) {
  if (!eventEnabled()) return null;
  const [id, mac] = readCookie(request, EVENT_COOKIE).split('.');
  if (!id || !mac) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export function isEventVisitor(request) {
  return eventEnabled() && !isOwner(request) && !!attendeeId(request);
}

// Workbook writes and exports while event mode is requested: the owner, or an attendee with the
// cookie. Fails closed when EVENT_CODE is set but event mode cannot run (no API key): attendeeId()
// is then null, so non-owners are refused.
// Returns the tags for a saved row ({ event, attendee } or nulls), or null when the caller is refused.
export function writeAccess(request) {
  if (!eventRequested() || isOwner(request)) return { event: null, attendee: null };
  const attendee = attendeeId(request);
  return attendee ? { event: eventTag(), attendee } : null;
}

// ------------------------------------------------------------ caps (D9: 10 at once, 1 per attendee)

export const MAX_ACTIVE = 10;
const active = new Set();

// Returns a release function, or null when the coach is full or this attendee already has a turn.
export function acquireSlot(attendee) {
  if (active.size >= MAX_ACTIVE || active.has(attendee)) return null;
  active.add(attendee);
  let released = false;
  return () => {
    if (!released) active.delete(attendee);
    released = true;
  };
}

// ------------------------------------------------------------ persisted state (D7, D12)

// data/event-state.json: { sessions: {sessionId: attendeeId}, spend: {sessionId: lastTotalUsd} }
const STATE_FILE = 'data/event-state.json';
let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    state = {};
  }
  state.sessions ??= {};
  state.spend ??= {};
  return state;
}

function persist() {
  mkdirSync('data', { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, STATE_FILE);
}

export function bindSession(sessionId, attendee) {
  const s = load();
  if (s.sessions[sessionId] === attendee) return;
  s.sessions[sessionId] = attendee;
  persist();
}

export function sessionAttendee(sessionId) {
  return load().sessions[sessionId];
}

// The SDK's total_cost_usd is cumulative for a session across resumed turns: keep the latest value
// per session and report the change, never sum the results.
export function recordCost(sessionId, totalUsd) {
  const s = load();
  const prev = s.spend[sessionId] || 0;
  const next = Math.max(prev, Number(totalUsd) || 0);
  s.spend[sessionId] = next;
  persist();
  const total = Object.values(s.spend).reduce((a, b) => a + b, 0);
  return { delta: next - prev, total };
}

// Test-only reset of in-process state (the file on disk is the test's own temp dir).
export function _resetForTests() {
  state = null;
  active.clear();
}
