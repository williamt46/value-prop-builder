import { workbookBlocks } from '../lib/document.js';
import { buildDocx } from '../lib/export-docx.js';
import { buildPdf } from '../lib/export-pdf.js';
import { HttpError, sanitizeData, sanitizeOwner, sanitizeTitle } from '../lib/fields.js';
import { readJson, route } from '../lib/http.js';

const FORMATS = {
  docx: { build: buildDocx, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { build: buildPdf, type: 'application/pdf' },
};

function filename(title, ext) {
  const slug = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'Value-Prop-Workbook';
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

// POST /api/export — render the current workbook (saved or not) as DOCX or PDF.
export const POST = route(async (request) => {
  const body = await readJson(request);
  const format = FORMATS[body.format];
  if (!format) throw new HttpError(400, 'Format must be docx or pdf');

  const title = sanitizeTitle(body.title);
  const owner = sanitizeOwner({ name: body.owner?.name, organization: body.owner?.organization });
  const data = sanitizeData(body.data);

  const blocks = workbookBlocks({ title, owner, data });
  const file = await format.build(blocks, { title, author: owner.name });

  return new Response(file, {
    headers: {
      'Content-Type': format.type,
      'Content-Disposition': `attachment; filename="${filename(title, body.format)}"`,
      'Cache-Control': 'no-store',
    },
  });
});
