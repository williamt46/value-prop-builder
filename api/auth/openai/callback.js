import { getDb } from '../../../lib/db.js';
import { cookie, readCookie, redirect } from '../../../lib/http.js';
import { DYNAMIC_CLIENT, authConfig, exchangeCode, verifyIdToken } from '../../../lib/openai-auth.js';
import { createSession, registrationFor, saveRegistration } from '../../../lib/session.js';
import { AUTH_COOKIE, safeReturnTo } from '../openai.js';

// Re-validate the stored path, then append the param without re-parsing it as a URL.
function withParam(path, key, value) {
  const safe = safeReturnTo(path);
  const sep = safe.includes('?') ? '&' : '?';
  return `${safe}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

// The client to exchange the code with. A first local sign-in returns its newly issued client_id
// on the callback; a returning one must keep the client the attempt started with.
function resolveClientId(cfg, tx, returned) {
  const pending = tx.client_id || cfg.clientId;
  if (cfg.mode !== 'local') return pending;
  if (pending === DYNAMIC_CLIENT) return returned && returned !== DYNAMIC_CLIENT ? returned : null;
  return !returned || returned === pending ? pending : null;
}

// GET /api/auth/openai/callback (hosted) and /auth/callback (local) — verify the sign-in and
// start an app session.
export async function GET(request) {
  const clearAuth = cookie(request, AUTH_COOKIE, '', 0);
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

    const clientId = resolveClientId(cfg, tx, params.get('client_id'));
    if (!clientId) return fail('failed', tx.return_to);
    const attempt = { ...cfg, clientId };

    let tokens;
    try {
      tokens = await exchangeCode(attempt, { code, codeVerifier: tx.code_verifier });
    } catch (err) {
      // OpenAI's documented recovery for a first local sign-in: keep the newly issued client and
      // start a fresh authorization with it. A retry starts from the issued client, not
      // DYNAMIC_CLIENT, so it can't loop.
      if (cfg.mode === 'local' && tx.client_id === DYNAMIC_CLIENT && err.oauthError === 'invalid_grant') {
        console.error('Sign in with ChatGPT: retrying with the issued client after', err.message);
        await saveRegistration({ clientId, subject: '', email: '' });
        return redirect(`/api/auth/openai?returnTo=${encodeURIComponent(safeReturnTo(tx.return_to))}`, [clearAuth]);
      }
      throw err;
    }
    if (typeof tokens.id_token !== 'string') throw new Error('Token response missing id_token');
    const identity = await verifyIdToken(attempt, tokens.id_token, tx.nonce);

    if (cfg.mode === 'local') {
      // A saved registration belongs to one ChatGPT account; never attach another account to it.
      const registration = await registrationFor(clientId);
      if (registration?.subject && registration.subject !== identity.sub) return fail('failed', tx.return_to);
      await saveRegistration({ clientId, subject: identity.sub, email: identity.email });
    }

    const sessionCookie = await createSession(request, { identity, clientId, tokens });
    return redirect(withParam(tx.return_to, 'signed_in', '1'), [clearAuth, sessionCookie]);
  } catch (err) {
    console.error('Sign in with ChatGPT failed:', err.message);
    return fail(err.code === 'not_configured' ? 'not_configured' : 'failed');
  }
}
