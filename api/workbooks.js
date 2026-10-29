import { getDb } from '../lib/db.js';
import { sanitizeData, sanitizeOwner, sanitizeTitle } from '../lib/fields.js';
import { hashToken, json, newId, readJson, route } from '../lib/http.js';

// POST /api/workbooks — create a workbook and its owner record.
// Returns the public share id and a secret edit token (only the hash is stored).
export const POST = route(async (request) => {
  const body = await readJson(request);
  const data = sanitizeData(body.data);
  const title = sanitizeTitle(body.title);
  const owner = sanitizeOwner(body.owner);

  const id = newId();
  const userId = newId();
  const editToken = newId(24);
  const now = new Date().toISOString();

  const db = await getDb();
  await db.batch(
    [
      {
        sql: 'INSERT INTO users (id, name, email, organization, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [userId, owner.name, owner.email, owner.organization, now, now],
      },
      {
        sql: `INSERT INTO workbooks (id, user_id, title, data, edit_token_hash, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, userId, title, JSON.stringify(data), hashToken(editToken), now, now],
      },
    ],
    'write',
  );

  return json(201, { id, editToken, title, updatedAt: now });
});
