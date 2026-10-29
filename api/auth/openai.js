import { getDb } from '../../lib/db.js';
import { cookie, isLocalPath, newId, redirect, route, sha256Base64url } from '../../lib/http.js';
import { authConfig, authorizationUrl } from '../../lib/openai-auth.js';

export const AUTH_COOKIE = '__Host-vp_auth';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;

// Only same-site relative paths, so the callback can't be turned into an open redirect.
// Checked after normalization: "/..//evil.com" normalizes to "//evil.com".
export function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  const url = new URL(value, 'http://local.invalid');
  const path = url.pathname + url.search;
  if (url.origin !== 'http://local.invalid' || !isLocalPath(path)) return '/';
  return path;
}

// GET /api/auth/openai?returnTo=/... — start Sign in with ChatGPT.
export const GET = route(async (request) => {
  const cfg = authConfig(request);
  const id = newId(24);
  const state = newId(24);
  const nonce = newId(24);
  const codeVerifier = newId(48);
  const now = Date.now();

  const db = await getDb();
  await db.batch(
    [
      { sql: 'DELETE FROM auth_transactions WHERE expires_at <= ?', args: [now] },
      {
        sql: `INSERT INTO auth_transactions (id, state, code_verifier, nonce, return_to, expires_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, state, codeVerifier, nonce, safeReturnTo(new URL(request.url).searchParams.get('returnTo')), now + TRANSACTION_TTL_MS],
      },
    ],
    'write',
  );

  const location = await authorizationUrl(cfg, { state, nonce, codeChallenge: sha256Base64url(codeVerifier) });
  return redirect(location, [cookie(AUTH_COOKIE, id, TRANSACTION_TTL_MS / 1000)]);
});
