// Value: protects=writeAccess admits owner and cookied attendees, refuses cookieless tunnel callers when event mode is on; fails_when=attendee check is skipped or off-mode gating inverts; why_new=event.test.js never calls writeAccess; seam=none; no_claim=does not prove HTTP handlers actually call writeAccess
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.chdir(mkdtempSync(join(tmpdir(), 'access-test-')));
const ev = await import('../lib/event.js');

function req(host, socket, headers = {}) {
  const r = new Request(`http://${host}/api/save`, { headers: { host, ...headers } });
  ev.tagRequest(r, socket);
  return r;
}

test('writeAccess: owner and cookied attendee allowed, cookieless attendee refused, event off allows all', () => {
  const saved = { code: process.env.EVENT_CODE, key: process.env.ANTHROPIC_API_KEY };
  try {
    process.env.EVENT_CODE = 'access-code-1';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const tunnel = { 'cf-connecting-ip': '1.2.3.4' };
    const value = ev.attendeeCookie(req('abc.trycloudflare.com', '127.0.0.1')).split(';')[0];

    assert.deepEqual(ev.writeAccess(req('127.0.0.1:3000', '127.0.0.1')), { event: null, attendee: null });
    const attendee = ev.writeAccess(req('abc.trycloudflare.com', '127.0.0.1', { ...tunnel, cookie: value }));
    assert.equal(attendee.event, ev.eventTag());
    assert.ok(attendee.attendee);
    assert.equal(ev.writeAccess(req('abc.trycloudflare.com', '127.0.0.1', tunnel)), null);

    delete process.env.ANTHROPIC_API_KEY; // event mode off
    assert.deepEqual(ev.writeAccess(req('abc.trycloudflare.com', '127.0.0.1', tunnel)), { event: null, attendee: null });
  } finally {
    for (const [k, v] of [['EVENT_CODE', saved.code], ['ANTHROPIC_API_KEY', saved.key]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
