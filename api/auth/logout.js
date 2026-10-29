import { assertSameOrigin, json, route } from '../../lib/http.js';
import { authConfig, revokeRefreshToken } from '../../lib/openai-auth.js';
import { clearSessionCookie, deleteSession, getSession, sessionTokens } from '../../lib/session.js';

// POST /api/auth/logout — revoke the OpenAI refresh token (best effort) and end the session.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const session = await getSession(request);
  let revoked = true;
  if (session) {
    const refreshToken = sessionTokens(session)?.refresh_token;
    if (refreshToken) {
      revoked = await revokeRefreshToken(authConfig(request), refreshToken).catch(() => false);
    }
    await deleteSession(session);
  }
  const res = json(200, { signedIn: false, revoked });
  res.headers.append('Set-Cookie', clearSessionCookie());
  return res;
});
