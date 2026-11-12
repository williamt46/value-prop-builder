import { getDb } from '../../lib/db.js';
import { cookie, isLocalPath, newId, redirect, route, sha256Base64url } from '../../lib/http.js';
import { authConfig, authorizationUrl } from '../../lib/openai-auth.js';
import { latestRegistration } from '../../lib/session.js';

export const AUTH_COOKIE = 'vp_auth';
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

// GET /api/auth/openai?returnTo=/...[&account=new][&consent=1] — start Sign in with ChatGPT.
// Local mode reuses the most recent account's issued client unless account=new.
export const GET = route(async (request) => {
  const cfg = authConfig(request);
  const params = new URL(request.url).searchParams;
  let clientId = cfg.clientId;
  let loginHint;
  if (cfg.mode === 'local' && params.get('account') !== 'new') {
    const registration = await latestRegistration();
    if (registration) {
      clientId = registration.client_id;
      loginHint = registration.email || undefined;
    }
  }

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
        sql: `INSERT INTO auth_transactions (id, state, code_verifier, nonce, return_to, expires_at, client_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, state, codeVerifier, nonce, safeReturnTo(params.get('returnTo')), now + TRANSACTION_TTL_MS, clientId],
      },
    ],
    'write',
  );

  const location = await authorizationUrl({ ...cfg, clientId }, {
    state,
    nonce,
    codeChallenge: sha256Base64url(codeVerifier),
    loginHint,
    consent: params.get('consent') === '1',
  });
  return redirect(location, [cookie(request, AUTH_COOKIE, id, TRANSACTION_TTL_MS / 1000)]);
});
