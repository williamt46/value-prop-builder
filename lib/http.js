import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './fields.js';

const MAX_BODY_BYTES = 512 * 1024;

export function json(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Workbook is too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

// Wrap a handler so validation errors become 4xx and everything else a generic 500.
export function route(handler) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(err.status, err.code ? { error: err.message, code: err.code } : { error: err.message });
      }
      console.error(err);
      return json(500, { error: 'Something went wrong. Please try again.' });
    }
  };
}

export function newId(bytes = 9) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatches(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sha256Base64url(value) {
  return createHash('sha256').update(value).digest('base64url');
}

// --- Cookies (HttpOnly, Secure, SameSite=Lax; browsers treat localhost as secure) ---
export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function cookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

// A same-origin path: one leading "/", never "//" or "/\" (browsers read both as another host).
export function isLocalPath(path) {
  return /^\/(?![\/\\])/.test(path) && !/[\r\n]/.test(path);
}

// Relative locations must be local paths; absolute ones are only built server-side (OpenAI authorize URL).
export function redirect(location, cookies = []) {
  if (!/^https?:\/\//.test(location) && !isLocalPath(location)) location = '/';
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

// Reject cross-site state-changing requests (SameSite=Lax already withholds the cookie).
export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, 'Cross-site request rejected');
  }
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
