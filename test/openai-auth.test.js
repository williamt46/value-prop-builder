// Value: protects=signInMode gives local ChatGPT sign-in only to the loopback owner, never to tunnel or event callers; fails_when=proxied or LAN request gets local mode; why_new=no openai-auth tests exist; seam=none; no_claim=does not prove the OAuth exchange or hosted client ID validity
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.chdir(mkdtempSync(join(tmpdir(), 'auth-test-')));
const ev = await import('../lib/event.js');
const { signInMode } = await import('../lib/openai-auth.js');

function req(host, socket, headers = {}) {
  const r = new Request(`http://${host}/api/auth`, { headers: { host, ...headers } });
  ev.tagRequest(r, socket);
  return r;
}

test('signInMode: local only for loopback owner; tunnel null; VERCEL null; hosted client ID honoured except for attendees', () => {
  const keys = ['VERCEL', 'OPENAI_CLIENT_ID', 'OPENAI_LOCAL_SIGNIN', 'EVENT_CODE', 'ANTHROPIC_API_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    const owner = () => req('127.0.0.1:3000', '127.0.0.1');
    const tunnel = () => req('127.0.0.1:3000', '127.0.0.1', { 'x-forwarded-for': '1.2.3.4' });
    assert.equal(signInMode(owner()), 'local');
    assert.equal(signInMode(tunnel()), null);
    assert.equal(signInMode(req('127.0.0.1:3000', '192.168.1.20')), null);

    process.env.OPENAI_LOCAL_SIGNIN = 'false';
    assert.equal(signInMode(owner()), null);
    delete process.env.OPENAI_LOCAL_SIGNIN;

    process.env.VERCEL = '1';
    assert.equal(signInMode(owner()), null);
    delete process.env.VERCEL;

    process.env.OPENAI_CLIENT_ID = 'client-x';
    assert.equal(signInMode(tunnel()), 'hosted');
    process.env.EVENT_CODE = 'c1';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    assert.equal(signInMode(tunnel()), null);
    assert.equal(signInMode(owner()), 'hosted');
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});
