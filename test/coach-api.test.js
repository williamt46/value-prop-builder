// Value: protects=POST /api/coach is 404 for strangers, 400 on bad JSON, and 404 for attendees outside office-hours braindump; fails_when=gate removed so strangers or attendees reach the Agent SDK; why_new=coach.test.js covers parsing only, never the handler gating; seam=none; no_claim=does not prove the owner or braindump path streams since that starts the SDK
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'coach-api-'));
const saved = {};
for (const k of ['EVENT_CODE', 'ANTHROPIC_API_KEY', 'VERCEL']) saved[k] = process.env[k];
delete process.env.VERCEL;
process.env.EVENT_CODE = 'coach-api-code';
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.chdir(dir);

const ev = await import('../lib/event.js');
const { POST } = await import('../api/coach.js');

after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(dir, { recursive: true, force: true });
});

function req(host, socket, headers, raw) {
  const r = new Request(`http://${host}/api/coach`, {
    method: 'POST', headers: { host, ...headers },
    body: typeof raw === 'string' ? raw : JSON.stringify(raw),
  });
  ev.tagRequest(r, socket);
  return r;
}

test('coach POST: stranger 404, owner malformed body 400, attendee refused guided and ceo-review', async () => {
  const tunnel = { 'cf-connecting-ip': '1.2.3.4' };
  const good = { mode: 'office-hours', path: 'braindump', message: 'notes' };

  assert.equal((await POST(req('abc.trycloudflare.com', '127.0.0.1', tunnel, good))).status, 404);

  assert.equal((await POST(req('127.0.0.1:3000', '127.0.0.1', {}, 'not json'))).status, 400);
  assert.equal((await POST(req('127.0.0.1:3000', '127.0.0.1', {}, { mode: 'nope' }))).status, 400);

  const cookie = ev.attendeeCookie(req('abc.trycloudflare.com', '127.0.0.1', {}, {})).split(';')[0];
  const as = (b) => POST(req('abc.trycloudflare.com', '127.0.0.1', { ...tunnel, cookie }, b));
  assert.equal((await as({ mode: 'office-hours', path: 'guided', message: 'hi' })).status, 404);
  assert.equal((await as({ mode: 'ceo-review' })).status, 404);
});
