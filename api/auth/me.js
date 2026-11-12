import { json, route } from '../../lib/http.js';
import { signInMode } from '../../lib/openai-auth.js';
import { getSession, latestRegistration } from '../../lib/session.js';

// GET /api/auth/me — who is signed in, and whether their ChatGPT plan can be used.
// configured=false means no sign-in is available here, so the page hides its AI features.
export const GET = route(async (request) => {
  const mode = signInMode(request);
  const session = await getSession(request);
  if (!session) {
    const saved = mode === 'local' ? await latestRegistration() : null;
    return json(200, { signedIn: false, configured: !!mode, mode, savedAccount: saved?.email || null });
  }
  return json(200, {
    signedIn: true,
    configured: true,
    mode,
    name: session.name,
    email: session.email,
    planUsage: session.planUsage,
  });
});
