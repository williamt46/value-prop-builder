import { json, route } from '../../lib/http.js';
import { signInMode } from '../../lib/openai-auth.js';
import { isEventVisitor, isOwner } from '../../lib/event.js';
import { getSession, latestRegistration } from '../../lib/session.js';

// GET /api/auth/me — who is signed in, and whether their ChatGPT plan can be used.
// configured=false means no sign-in is available here, so the page hides its AI features.
// coach=true for the owner on the local dev server (their Claude login) and for event attendees
// holding the event cookie (API key, brain dump only); event=true marks the attendee view.
export const GET = route(async (request) => {
  const mode = signInMode(request);
  const event = isEventVisitor(request);
  const coach = isOwner(request) || event;
  const session = await getSession(request);
  if (!session) {
    const saved = mode === 'local' ? await latestRegistration() : null;
    return json(200, { signedIn: false, configured: !!mode, mode, coach, event, savedAccount: saved?.email || null });
  }
  return json(200, {
    signedIn: true,
    configured: true,
    mode,
    coach,
    event,
    name: session.name,
    email: session.email,
    planUsage: session.planUsage,
  });
});
