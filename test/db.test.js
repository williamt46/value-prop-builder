// Value: protects=migration is idempotent: reopening an existing database file keeps event and attendee_id columns and data; fails_when=duplicate-column error escapes or a re-run drops rows; why_new=no db tests exist and the ALTER migrations are new; seam=none; no_claim=does not prove Turso remote migration behavior
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

const dir = mkdtempSync(join(tmpdir(), 'db-test-'));
const url = 'file:' + join(dir, 'test.db');
const saved = { url: process.env.TURSO_DATABASE_URL, vercel: process.env.VERCEL };
delete process.env.VERCEL;
process.env.TURSO_DATABASE_URL = url;

after(() => {
  if (saved.url === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = saved.url;
  if (saved.vercel !== undefined) process.env.VERCEL = saved.vercel;
  rmSync(dir, { recursive: true, force: true });
});

test('getDb migrates twice (fresh process state over an existing file) without error', async () => {
  const { getDb } = await import('../lib/db.js');
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute({ sql: 'INSERT INTO users (id, created_at, updated_at) VALUES (?, ?, ?)', args: ['u1', now, now] });
  await db.execute({
    sql: 'INSERT INTO workbooks (id, user_id, title, data, edit_token_hash, event, attendee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    args: ['w1', 'u1', 't', '{}', 'h', 'ev1', 'att1', now, now],
  });

  // Re-importing the module under a new query string gives a fresh cached client and migrate().
  const again = await import('../lib/db.js?second');
  const db2 = await again.getDb();
  const cols = (await db2.execute('PRAGMA table_info(workbooks)')).rows.map((r) => r.name);
  assert.ok(cols.includes('event') && cols.includes('attendee_id'));
  const row = (await db2.execute('SELECT event, attendee_id FROM workbooks WHERE id = \'w1\'')).rows[0];
  assert.equal(row.event, 'ev1');
  assert.equal(row.attendee_id, 'att1');

  const raw = createClient({ url });
  const tcols = (await raw.execute('PRAGMA table_info(auth_transactions)')).rows.map((r) => r.name);
  assert.ok(tcols.includes('client_id'));
  raw.close();
});
