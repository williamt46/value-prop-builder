import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE = { width: 612, height: 792 }; // US Letter, points
const MARGIN = 60;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const STYLES = {
  title: { font: 'bold', size: 22, color: rgb(0.06, 0.09, 0.16), before: 0, after: 6 },
  meta: { font: 'regular', size: 10, color: rgb(0.39, 0.45, 0.55), before: 0, after: 18 },
  heading: { font: 'bold', size: 15, color: rgb(0.15, 0.39, 0.92), before: 18, after: 6, rule: true },
  label: { font: 'bold', size: 11, color: rgb(0.2, 0.25, 0.33), before: 10, after: 3 },
  text: { font: 'regular', size: 10.5, color: rgb(0.12, 0.16, 0.23), before: 0, after: 2 },
  empty: { font: 'italic', size: 10.5, color: rgb(0.58, 0.64, 0.72), before: 0, after: 2 },
  fact: { font: 'bold', size: 10.5, color: rgb(0.12, 0.16, 0.23), before: 0, after: 2 },
};

// Standard PDF fonts only cover WinAnsi; swap anything else for '?' instead of throwing.
function encodable(font, text) {
  let out = '';
  for (const ch of text.replace(/\t/g, '    ').replace(/\r/g, '')) {
    if (ch === '\n') {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function wrap(font, size, text) {
  const out = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= CONTENT_WIDTH) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // Break words longer than a full line.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > CONTENT_WIDTH) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > CONTENT_WIDTH) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export async function buildPdf(blocks, { title, author }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor(author || 'Value Proposition Builder');
  pdf.setCreator('Value Proposition Builder');

  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };

  blocks.forEach((block, i) => {
    const style = STYLES[block.type] || STYLES.text;
    const font = fonts[style.font];
    const lineHeight = style.size * 1.35;
    const wrapped = wrap(font, style.size, encodable(font, block.text));

    // Keep headings and labels with at least the first line of what follows.
    const next = blocks[i + 1];
    const keepWithNext = (block.type === 'heading' || block.type === 'label') && next ? 3 * lineHeight : 0;
    y -= style.before;
    if (y - lineHeight - keepWithNext < MARGIN) newPage();

    for (const line of wrapped) {
      if (y - lineHeight < MARGIN) newPage();
      y -= lineHeight;
      page.drawText(line, { x: MARGIN, y: y + (lineHeight - style.size) / 2, size: style.size, font, color: style.color });
    }
    if (style.rule) {
      y -= 3;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE.width - MARGIN, y },
        thickness: 0.6,
        color: rgb(0.89, 0.91, 0.94),
      });
    }
    y -= style.after;
  });

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    const size = 8.5;
    p.drawText(label, {
      x: PAGE.width - MARGIN - fonts.regular.widthOfTextAtSize(label, size),
      y: MARGIN / 2,
      size,
      font: fonts.regular,
      color: rgb(0.58, 0.64, 0.72),
    });
  });

  return Buffer.from(await pdf.save());
}
