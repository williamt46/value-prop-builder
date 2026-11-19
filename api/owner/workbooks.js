import { getDb } from '../../lib/db.js';
import { HttpError } from '../../lib/fields.js';
import { json, route } from '../../lib/http.js';
import { isOwner } from '../../lib/event.js';

// GET /api/owner/workbooks — every workbook saved during an event, newest first. Owner only
// (127.0.0.1 from this laptop); titles and times only, the page opens one workbook at a time.
export const GET = route(async (request) => {
  if (!isOwner(request)) throw new HttpError(404, 'Not found');
  const db = await getDb();
  const { rows } = await db.execute(
    `SELECT w.id, w.title, w.event, w.attendee_id, w.created_at, w.updated_at, u.name
     FROM workbooks w JOIN users u ON u.id = w.user_id
     WHERE w.event IS NOT NULL ORDER BY w.updated_at DESC LIMIT 500`,
  );
  return json(200, {
    workbooks: rows.map((r) => ({
      id: r.id, title: r.title, event: r.event, attendee: r.attendee_id, name: r.name,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),
  });
});
