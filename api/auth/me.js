import { json, route } from '../../lib/http.js';
import { isConfigured } from '../../lib/openai-auth.js';
import { getSession } from '../../lib/session.js';

// GET /api/auth/me — who is signed in, and whether their ChatGPT plan can be used.
export const GET = route(async (request) => {
  const session = await getSession(request);
  if (!session) return json(200, { signedIn: false, configured: isConfigured() });
  return json(200, {
    signedIn: true,
    configured: true,
    name: session.name,
    email: session.email,
    planUsage: session.planUsage,
  });
});
