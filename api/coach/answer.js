import { assertSameOrigin, json, readJson, route } from '../../lib/http.js';
import { answerQuestion, parseAnswer } from '../../lib/coach.js';
import { coachIdentity } from '../coach.js';

// POST /api/coach/answer — {id, answers: {<question text>: <answer>}} resolves a pending question card.
// An attendee can only answer cards from their own coach turns.
export const POST = route(async (request) => {
  const identity = coachIdentity(request);
  assertSameOrigin(request);
  const { id, answers } = parseAnswer(await readJson(request));
  answerQuestion(id, answers, identity.kind === 'event' ? identity.attendee : null);
  return json(200, { ok: true });
});
