import { getDb } from '../../../lib/db.js';
import { cookie, readCookie, redirect } from '../../../lib/http.js';
import { authConfig, exchangeCode, verifyIdToken } from '../../../lib/openai-auth.js';
import { createSession } from '../../../lib/session.js';
import { AUTH_COOKIE, safeReturnTo } from '../openai.js';

// Re-validate the stored path, then append the param without re-parsing it as a URL.
function withParam(path, key, value) {
  const safe = safeReturnTo(path);
  const sep = safe.includes('?') ? '&' : '?';
  return `${safe}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

// GET /api/auth/openai/callback — verify the sign-in and start an app session.
export async function GET(request) {
  const clearAuth = cookie(AUTH_COOKIE, '', 0);
  const fail = (reason, returnTo = '/') => redirect(withParam(returnTo, 'auth_error', reason), [clearAuth]);

  try {
    const cfg = authConfig(request);
    const params = new URL(request.url).searchParams;

    // Consume the transaction exactly once, whatever the outcome.
    const txId = readCookie(request, AUTH_COOKIE);
    if (!txId) return fail('expired');
    const db = await getDb();
    const { rows } = await db.execute({ sql: 'DELETE FROM auth_transactions WHERE id = ? RETURNING *', args: [txId] });
    const tx = rows[0];
    if (!tx || tx.expires_at <= Date.now() || params.get('state') !== tx.state) return fail('expired');
    if (params.get('error')) return fail(params.get('error') === 'access_denied' ? 'denied' : 'failed', tx.return_to);
    const code = params.get('code');
    if (!code) return fail('failed', tx.return_to);

    const tokens = await exchangeCode(cfg, { code, codeVerifier: tx.code_verifier });
    if (typeof tokens.id_token !== 'string') throw new Error('Token response missing id_token');
    const identity = await verifyIdToken(cfg, tokens.id_token, tx.nonce);

    const sessionCookie = await createSession({ identity, clientId: cfg.clientId, tokens });
    return redirect(withParam(tx.return_to, 'signed_in', '1'), [clearAuth, sessionCookie]);
  } catch (err) {
    console.error('Sign in with ChatGPT failed:', err.message);
    return fail(err.code === 'not_configured' ? 'not_configured' : 'failed');
  }
}
