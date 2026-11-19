// Value: protects=coach request and answer validation reject malformed input with 400; fails_when=bad mode, session id, size, answer type slips through; why_new=no coach tests exist; seam=none; no_claim=does not prove the cross-attendee answer refusal or any SDK turn
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoachRequest, parseAnswer, buildPrompt, renderWorkbook } from '../lib/coach.js';

const SID = '123e4567-e89b-12d3-a456-426614174000';
const bad = (fn) => assert.throws(fn, (e) => e.status === 400);

test('parseCoachRequest and parseAnswer reject malformed input and accept the valid shapes', () => {
  bad(() => parseCoachRequest({ mode: 'nope' }));
  bad(() => parseCoachRequest({ mode: 'office-hours', sessionId: 'not-a-uuid', message: 'hi' }));
  bad(() => parseCoachRequest({ mode: 'office-hours', message: 'x'.repeat(30001) }));
  bad(() => parseCoachRequest({ mode: 'office-hours', path: 'braindump', message: '   ' }));
  bad(() => parseCoachRequest({ mode: 'office-hours', path: 'weird' }));
  bad(() => parseCoachRequest({ mode: 'office-hours', sessionId: SID, message: '' }));
  const ok = parseCoachRequest({ mode: 'office-hours', path: 'braindump', message: '  my notes  ' });
  assert.equal(ok.message, 'my notes');
  assert.equal(ok.path, 'braindump');
  assert.equal(parseCoachRequest({ mode: 'ceo-review' }).path, null);

  bad(() => parseAnswer({ id: 'x', answers: {} }));
  bad(() => parseAnswer({ id: 'abcdef12', answers: [] }));
  bad(() => parseAnswer({ id: 'abcdef12', answers: { q: 5 } }));
  const five = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`q${n}`, 'a']));
  assert.deepEqual(Object.keys(parseAnswer({ id: 'abcdef12', answers: five }).answers), ['q1', 'q2', 'q3', 'q4']);
});

// Value: protects=new-session prompt requests card_* copy while follow-up turns omit it and renderWorkbook shows filled text; fails_when=card instruction repeats on resume or filled fields drop; why_new=no buildPrompt tests exist; seam=none; no_claim=does not prove the model follows the prompt
test('buildPrompt asks for share-card copy only in a new session, and renderWorkbook shows filled fields', () => {
  const wb = { mvs_narrative: 'Solo founders in healthcare' };
  const rendered = renderWorkbook(wb);
  assert.match(rendered, /- mvs_narrative \(.*\): Solo founders in healthcare/);
  assert.equal(renderWorkbook(null), '(no workbook sent)');

  const fresh = buildPrompt({ mode: 'office-hours', path: 'guided', message: 'idea', workbook: wb });
  assert.match(fresh, /call fill_workbook once more to fill the six card_\* fields/);
  const follow = buildPrompt({ mode: 'office-hours', path: 'guided', message: 'next', sessionId: SID, workbook: wb });
  assert.doesNotMatch(follow, /fill_workbook once more/);
  assert.match(follow, /Solo founders in healthcare/);
});
