import { HttpError } from '../lib/fields.js';
import { assertSameOrigin, readJson, route } from '../lib/http.js';
import { acquireSlot, attendeeId, isEventVisitor, isOwner, sessionAttendee } from '../lib/event.js';
import { parseCoachRequest, runCoach } from '../lib/coach.js';

const PING_MS = 15_000;

// Who is asking: the owner on 127.0.0.1 (their Claude login) or an event attendee holding the
// event cookie (API key). Everyone else gets a plain 404, so the coach is not advertised.
export function coachIdentity(request) {
  if (isOwner(request)) return { kind: 'owner' };
  if (isEventVisitor(request)) return { kind: 'event', attendee: attendeeId(request) };
  throw new HttpError(404, 'Not found');
}

// POST /api/coach — start or continue a coach session; responds with server-sent events:
//   session {sessionId, model, apiKeySource} · text {delta} · text_end · tool {name}
//   question {id, questions} · fill {fields, note} · error {message, code} · done {sessionId}
// plus `: ping` comment lines every 15 s so tunnels don't drop a quiet stream.
export const POST = route(async (request) => {
  const identity = coachIdentity(request);
  assertSameOrigin(request);
  const req = parseCoachRequest(await readJson(request));
  // Event attendees get office-hours brain dump only.
  if (identity.kind === 'event' && !(req.mode === 'office-hours' && req.path === 'braindump')) {
    throw new HttpError(404, 'Not found');
  }
  // An attendee may only continue a session their own earlier turn created.
  if (identity.kind === 'event' && req.sessionId && sessionAttendee(req.sessionId) !== identity.attendee) {
    throw new HttpError(404, 'Not found');
  }
  const release = identity.kind === 'event' ? acquireSlot(identity.attendee) : () => {};

  const encoder = new TextEncoder();
  let open = true;
  let ping;
  const stream = new ReadableStream({
    cancel() { open = false; clearInterval(ping); release?.(); },
    start(controller) {
      const emit = (event) => {
        if (open) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      const finish = () => {
        clearInterval(ping);
        release?.();
        if (open) controller.close();
        open = false;
      };
      if (!release) {
        emit({ type: 'error', message: 'The coach is busy, try again in a minute.', code: 'busy' });
        return finish();
      }
      ping = setInterval(() => { if (open) controller.enqueue(encoder.encode(': ping\n\n')); }, PING_MS);
      runCoach(req, emit, request.signal, identity)
        .catch((err) => {
          if (request.signal?.aborted) return;
          console.error('coach failed', err);
          emit({ type: 'error', message: 'The coach could not run. Is Claude Code installed and signed in?', code: 'coach_failed' });
        })
        .finally(finish);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
});
