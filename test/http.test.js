// Value: protects=cookie names get __Host- and Secure only over https or tunnel proto, and readCookie round-trips; fails_when=prefix or Secure applied on plain http; why_new=event.test.js only round-trips one https-less cookie; seam=none; no_claim=does not prove browsers accept these cookies
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookie, readCookie } from '../lib/http.js';

test('cookie/readCookie: plain http unprefixed, x-forwarded-proto https gets __Host- and Secure', () => {
  const saved = process.env.VERCEL;
  delete process.env.VERCEL;
  try {
    const plain = new Request('http://127.0.0.1:3000/');
    const set = cookie(plain, 'sess', 'a b;c', 60);
    assert.match(set, /^sess=a%20b%3Bc; Path=\//);
    assert.doesNotMatch(set, /Secure|__Host-/);
    const back = new Request('http://127.0.0.1:3000/', { headers: { cookie: 'x=1; sess=a%20b%3Bc' } });
    assert.equal(readCookie(back, 'sess'), 'a b;c');

    const tunnel = new Request('http://127.0.0.1:3000/', { headers: { 'x-forwarded-proto': 'https' } });
    const tset = cookie(tunnel, 'sess', 'v', 60);
    assert.match(tset, /^__Host-sess=v;/);
    assert.match(tset, / Secure;/);
    const tback = new Request('http://127.0.0.1:3000/', { headers: { 'x-forwarded-proto': 'https', cookie: 'sess=plain; __Host-sess=v' } });
    assert.equal(readCookie(tback, 'sess'), 'v');
    assert.equal(readCookie(plain, 'sess'), '');
  } finally {
    if (saved !== undefined) process.env.VERCEL = saved;
  }
});
