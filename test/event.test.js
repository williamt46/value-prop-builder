import { test, before, beforeEach } from 'node:test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run in a temp dir so data/event-state.json never touches the repo.
process.chdir(mkdtempSync(join(tmpdir(), 'event-test-')));
process.env.EVENT_CODE = 'test-code-1234';
process.env.ANTHROPIC_API_KEY = 'sk-test';
const ev = await import('../lib/event.js');

function req(host, socket, headers = {}) {
  const r = new Request(`http://${host}/api/coach`, { headers: { host, ...headers } });
  ev.tagRequest(r, socket);
  return r;
}

beforeEach(() => ev._resetForTests());

test('owner: loopback socket, no forwarding headers, exact Host', () => {
  assert.equal(ev.isOwner(req('127.0.0.1:3000', '127.0.0.1')), true);
  assert.equal(ev.isOwner(req('127.0.0.1:3000', '::ffff:127.0.0.1')), true);
});

test('not owner: tunnel headers on a loopback socket (cloudflared)', () => {
  assert.equal(ev.isOwner(req('127.0.0.1:3000', '127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' })), false);
  assert.equal(ev.isOwner(req('127.0.0.1:3000', '127.0.0.1', { 'x-forwarded-for': '1.2.3.4' })), false);
});

test('not owner: forged Host from the LAN, or a tunnel Host', () => {
  assert.equal(ev.isOwner(req('127.0.0.1:3000', '192.168.1.20')), false);
  assert.equal(ev.isOwner(req('abc.trycloudflare.com', '127.0.0.1')), false);
  const untagged = new Request('http://127.0.0.1:3000/', { headers: { host: '127.0.0.1:3000' } });
  assert.equal(ev.isOwner(untagged), false);
});

test('event code: right code matches, wrong does not', () => {
  assert.equal(ev.codeMatches('test-code-1234'), true);
  assert.equal(ev.codeMatches('wrong'), false);
  assert.equal(ev.codeMatches(''), false);
});

test('attendee cookie: valid verifies, tampered or other-code cookie rejected', () => {
  const set = ev.attendeeCookie(req('abc.trycloudflare.com', '127.0.0.1'));
  const value = set.split(';')[0]; // name=value
  const visitor = req('abc.trycloudflare.com', '127.0.0.1', { cookie: value, 'cf-connecting-ip': '1.2.3.4' });
  assert.ok(ev.attendeeId(visitor));
  assert.equal(ev.isEventVisitor(visitor), true);
  const tampered = req('abc.trycloudflare.com', '127.0.0.1', { cookie: value.slice(0, -2) + 'xx' });
  assert.equal(ev.attendeeId(tampered), null);
  // An attendee knows the code, so a cookie signed with the code alone must not verify.
  const id = 'forged-id';
  const forged = `vp_event=${id}.${createHmac('sha256', 'test-code-1234').update(id).digest('base64url')}`;
  assert.equal(ev.attendeeId(req('abc.trycloudflare.com', '127.0.0.1', { cookie: forged })), null);
  process.env.EVENT_CODE = 'another-code-99';
  try {
    assert.equal(ev.attendeeId(visitor), null);
  } finally {
    process.env.EVENT_CODE = 'test-code-1234';
  }
});

test('caps: one turn per attendee, ten in total, release frees the slot', () => {
  const r1 = ev.acquireSlot('a');
  assert.ok(r1);
  assert.equal(ev.acquireSlot('a'), null);
  for (let i = 0; i < 9; i++) assert.ok(ev.acquireSlot(`p${i}`));
  assert.equal(ev.acquireSlot('late'), null);
  r1();
  r1(); // double release is harmless
  assert.ok(ev.acquireSlot('late'));
});

test('spend: cumulative session totals become deltas, never sums', () => {
  assert.deepEqual(ev.recordCost('s1', 0.12), { delta: 0.12, total: 0.12 });
  const second = ev.recordCost('s1', 0.2);
  assert.ok(Math.abs(second.delta - 0.08) < 1e-9 && Math.abs(second.total - 0.2) < 1e-9);
  const other = ev.recordCost('s2', 0.1);
  assert.ok(Math.abs(other.total - 0.3) < 1e-9);
});

test('session binding persists across a restart', () => {
  ev.bindSession('sess-1', 'attendee-a');
  ev._resetForTests(); // simulates a restart: in-memory state gone, file remains
  assert.equal(ev.sessionAttendee('sess-1'), 'attendee-a');
  assert.equal(ev.sessionAttendee('sess-2'), undefined);
});
