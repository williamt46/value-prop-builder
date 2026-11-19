// Value: protects=event-mode workbook create tags rows with event and attendee, and PUT demands the edit token, owner list shows only event rows; fails_when=cookieless save, untagged row, wrong token edit, or non-event rows listed; why_new=access.test.js checks writeAccess only, not handlers or stored rows; seam=none; no_claim=does not prove UI or Turso in production
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'wb-api-'));
const saved = {};
for (const k of ['TURSO_DATABASE_URL', 'EVENT_CODE', 'ANTHROPIC_API_KEY', 'VERCEL']) saved[k] = process.env[k];
delete process.env.VERCEL;
process.env.TURSO_DATABASE_URL = 'file:' + join(dir, 'test.db');
process.env.EVENT_CODE = 'wb-api-code';
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.chdir(dir);

const ev = await import('../lib/event.js');
const { POST } = await import('../api/workbooks.js');
const { PUT, GET } = await import('../api/workbooks/[id].js');
const { GET: OWNER_LIST } = await import('../api/owner/workbooks.js');

after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(dir, { recursive: true, force: true });
});

const TUNNEL = { 'cf-connecting-ip': '1.2.3.4' };
function req(url, { method = 'GET', host, socket = '127.0.0.1', headers = {}, body } = {}) {
  const h = new URL(url).host;
  const r = new Request(url, {
    method, headers: { host: host || h, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  ev.tagRequest(r, socket);
  return r;
}
const attendeeCookie = () =>
  ev.attendeeCookie(req('http://abc.trycloudflare.com/')).split(';')[0];
const post = (opts) => POST(req('http://abc.trycloudflare.com/api/workbooks', { method: 'POST', ...opts }));
const body = { title: '  Event idea ', data: { mvs_narrative: 'Nurses', card_pitch: 'Pitch' }, owner: { name: 'Ann' } };

let created;
test('event mode: cookieless visitor gets 404, attendee create is tagged, PUT needs the edit token', async () => {
  const none = await post({ headers: TUNNEL, body });
  assert.equal(none.status, 404);

  const cookie = attendeeCookie();
  const res = await post({ headers: { ...TUNNEL, cookie }, body });
  assert.equal(res.status, 201);
  created = await res.json();
  assert.equal(created.title, 'Event idea');

  const { getDb } = await import('../lib/db.js');
  const db = await getDb();
  const { rows } = await db.execute({ sql: 'SELECT event, attendee_id FROM workbooks WHERE id = ?', args: [created.id] });
  assert.equal(rows[0].event, ev.eventTag());
  assert.ok(rows[0].attendee_id);

  const url = `http://abc.trycloudflare.com/api/workbooks/${created.id}`;
  const put = (token) => PUT(req(url, {
    method: 'PUT', headers: { ...TUNNEL, cookie, authorization: `Bearer ${token}` },
    body: { title: 'Renamed', data: { mvs_narrative: 'Doctors' } },
  }));
  assert.equal((await put('wrong-token')).status, 403);
  assert.equal((await put(created.editToken)).status, 200);
  const got = await (await GET(req(url, { headers: TUNNEL }))).json();
  assert.equal(got.title, 'Renamed');
  assert.equal(got.data.mvs_narrative, 'Doctors');

  const listUrl = 'http://127.0.0.1:3000/api/owner/workbooks';
  // A non-event row created by the owner (event is null) must not be listed.
  const plain = await POST(req('http://127.0.0.1:3000/api/workbooks', { method: 'POST', body: { title: 'Owner private', data: {} } }));
  assert.equal(plain.status, 201);

  assert.equal((await OWNER_LIST(req(listUrl, { headers: TUNNEL }))).status, 404);
  assert.equal((await OWNER_LIST(req(listUrl, { socket: '192.168.1.5' }))).status, 404);

  const listRes = await OWNER_LIST(req(listUrl));
  assert.equal(listRes.status, 200);
  const { workbooks } = await listRes.json();
  assert.deepEqual(workbooks.map((w) => w.id), [created.id]);
  assert.equal(workbooks[0].event, ev.eventTag());
  assert.equal(workbooks[0].name, 'Ann');
  assert.ok(workbooks[0].attendee);
});
