import { assertSameOrigin, json, readJson, route } from '../../lib/http.js';
import { answerQuestion, parseAnswer } from '../../lib/coach.js';
import { assertCoachAvailable } from '../coach.js';

// POST /api/coach/answer — {id, answers: {<question text>: <answer>}} resolves a pending question card.
export const POST = route(async (request) => {
  assertCoachAvailable(request);
  assertSameOrigin(request);
  const { id, answers } = parseAnswer(await readJson(request));
  answerQuestion(id, answers);
  return json(200, { ok: true });
});
