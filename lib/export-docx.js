import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

const FONT = 'Calibri';

function lines(text) {
  return text.split(/\r?\n/);
}

export async function buildDocx(blocks, { title, author }) {
  const children = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'title':
        children.push(new Paragraph({ text: block.text, heading: HeadingLevel.TITLE }));
        break;
      case 'meta':
        children.push(new Paragraph({
          spacing: { after: 240 },
          children: [new TextRun({ text: block.text, color: '64748B', size: 20 })],
        }));
        break;
      case 'heading':
        children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1, spacing: { before: 360 } }));
        break;
      case 'label':
        children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_3, spacing: { before: 200 } }));
        break;
      case 'empty':
        children.push(new Paragraph({ children: [new TextRun({ text: block.text, italics: true, color: '94A3B8' })] }));
        break;
      case 'fact':
        children.push(new Paragraph({ children: [new TextRun({ text: block.text, bold: true })] }));
        break;
      default:
        for (const line of lines(block.text)) children.push(new Paragraph({ text: line }));
    }
  }

  const doc = new Document({
    creator: author || 'Value Proposition Builder',
    title,
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
