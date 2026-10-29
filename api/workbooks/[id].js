import { getDb } from '../../lib/db.js';
import { HttpError, sanitizeData, sanitizeOwner, sanitizeTitle } from '../../lib/fields.js';
import { bearerToken, json, readJson, route, tokenMatches } from '../../lib/http.js';

function workbookId(request) {
  const id = decodeURIComponent(new URL(request.url).pathname.split('/').pop() || '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new HttpError(404, 'Workbook not found');
  return id;
}

// GET /api/workbooks/:id — public read for share links. Owner email is never returned.
export const GET = route(async (request) => {
  const id = workbookId(request);
  const db = await getDb();
  const { rows } = await db.execute({
    sql: `SELECT w.id, w.title, w.data, w.created_at, w.updated_at, u.name, u.organization
          FROM workbooks w JOIN users u ON u.id = w.user_id WHERE w.id = ?`,
    args: [id],
  });
  const row = rows[0];
  if (!row) throw new HttpError(404, 'Workbook not found');
  await db.execute({ sql: 'UPDATE workbooks SET view_count = view_count + 1 WHERE id = ?', args: [id] });

  return json(200, {
    id: row.id,
    title: row.title,
    data: JSON.parse(row.data),
    owner: { name: row.name, organization: row.organization },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// PUT /api/workbooks/:id — owner update, authorised by the edit token.
export const PUT = route(async (request) => {
  const id = workbookId(request);
  const body = await readJson(request);
  const data = sanitizeData(body.data);
  const title = sanitizeTitle(body.title);
  const owner = body.owner ? sanitizeOwner(body.owner) : null;

  const db = await getDb();
  const { rows } = await db.execute({
    sql: 'SELECT user_id, edit_token_hash FROM workbooks WHERE id = ?',
    args: [id],
  });
  const row = rows[0];
  if (!row) throw new HttpError(404, 'Workbook not found');
  if (!tokenMatches(bearerToken(request), row.edit_token_hash)) {
    throw new HttpError(403, 'You do not have permission to edit this workbook');
  }

  const now = new Date().toISOString();
  const statements = [
    {
      sql: 'UPDATE workbooks SET title = ?, data = ?, updated_at = ? WHERE id = ?',
      args: [title, JSON.stringify(data), now, id],
    },
  ];
  if (owner) {
    statements.push({
      sql: 'UPDATE users SET name = ?, email = ?, organization = ?, updated_at = ? WHERE id = ?',
      args: [owner.name, owner.email, owner.organization, now, row.user_id],
    });
  }
  await db.batch(statements, 'write');

  return json(200, { id, title, updatedAt: now });
});
