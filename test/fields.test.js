// Value: protects=sanitizeData keeps the six card_* fields, caps them at 20000 chars, and drops unknown keys; fails_when=card fields removed from TEXT_FIELDS or stored unbounded; why_new=no fields tests exist and card_* was added this branch; seam=none; no_claim=does not prove cards render or export correctly
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeData } from '../lib/fields.js';

test('sanitizeData: card_* fields survive, are length-limited, unknown keys dropped', () => {
  const cards = ['card_who', 'card_pain', 'card_need', 'card_before', 'card_after', 'card_pitch'];
  const out = sanitizeData({
    card_who: 'Nurses', card_pain: 'Burnout', card_need: 'Rest', card_before: 'b', card_after: 'a',
    card_pitch: 'x'.repeat(25000), evil: 'drop me', __proto__x: 1,
  });
  for (const id of cards) assert.equal(typeof out[id], 'string', id);
  assert.equal(out.card_who, 'Nurses');
  assert.equal(out.card_pitch.length, 20000);
  assert.equal(sanitizeData({})['card_who'], '');
  assert.equal('evil' in out, false);
  assert.equal('__proto__x' in out, false);
  assert.throws(() => sanitizeData({ card_who: { a: 1 } }), (e) => e.status === 400);
});
