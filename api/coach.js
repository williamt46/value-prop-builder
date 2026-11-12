import { HttpError } from '../lib/fields.js';
import { assertSameOrigin, readJson, route } from '../lib/http.js';
import { signInMode } from '../lib/openai-auth.js';
import { parseCoachRequest, runCoach } from '../lib/coach.js';

// The coach runs on the owner's Claude Code login, so it exists only in local mode
// (127.0.0.1, not on Vercel). Everywhere else it is a plain 404.
export function assertCoachAvailable(request) {
  if (signInMode(request) !== 'local') throw new HttpError(404, 'Not found');
}

// POST /api/coach — start or continue a coach session; responds with server-sent events:
//   session {sessionId, model, apiKeySource} · text {delta} · text_end · tool {name}
//   question {id, questions} · fill {fields, note} · error {message, code} · done {sessionId}
export const POST = route(async (request) => {
  assertCoachAvailable(request);
  assertSameOrigin(request);
  const req = parseCoachRequest(await readJson(request));

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    cancel() { open = false; },
    start(controller) {
      const emit = (event) => {
        if (open) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      runCoach(req, emit, request.signal)
        .catch((err) => {
          if (request.signal?.aborted) return;
          console.error('coach failed', err);
          emit({ type: 'error', message: 'The coach could not run. Is Claude Code installed and signed in?', code: 'coach_failed' });
        })
        .finally(() => {
          if (open) controller.close();
          open = false;
        });
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
