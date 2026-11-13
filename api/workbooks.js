import { getDb } from '../lib/db.js';
import { sanitizeData, sanitizeOwner, sanitizeTitle } from '../lib/fields.js';
import { HttpError } from '../lib/fields.js';
import { hashToken, json, newId, readJson, route } from '../lib/http.js';
import { writeAccess } from '../lib/event.js';

// POST /api/workbooks — create a workbook and its owner record.
// Returns the public share id and a secret edit token (only the hash is stored).
// In event mode, only the owner or an attendee with the event cookie may create, and the row
// is tagged with the event and attendee so the owner page can list it.
export const POST = route(async (request) => {
  const access = writeAccess(request);
  if (!access) throw new HttpError(404, 'Not found');
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
        sql: `INSERT INTO workbooks (id, user_id, title, data, edit_token_hash, event, attendee_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, userId, title, JSON.stringify(data), hashToken(editToken), access.event, access.attendee, now, now],
      },
    ],
    'write',
  );

  return json(201, { id, editToken, title, updatedAt: now });
});
