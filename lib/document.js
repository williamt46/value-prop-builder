import { SECTIONS, classifyNeed, gainPainRatio } from './fields.js';

// Flatten a workbook into a format-neutral list of blocks that the DOCX and PDF
// renderers both walk, so the two exports always contain the same content.
//   { type: 'title' | 'meta' | 'heading' | 'label' | 'text' | 'empty' | 'fact', text }
export function workbookBlocks({ title, owner = {}, data, date = new Date() }) {
  const blocks = [{ type: 'title', text: title }];

  const byline = [owner.name, owner.organization].filter(Boolean).join(', ');
  const dateText = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  blocks.push({ type: 'meta', text: byline ? `Prepared by ${byline} · ${dateText}` : dateText });

  for (const section of SECTIONS) {
    blocks.push({ type: 'heading', text: section.title });

    if (section.extra === 'needsMap') {
      blocks.push({ type: 'label', text: 'User Needs Map' });
      blocks.push({
        type: 'fact',
        text: `Classification: ${classifyNeed(data.graph_x, data.graph_y)} ` +
          `(Blatancy ${Math.round(data.graph_x)}/100, Aspiration ${Math.round(data.graph_y)}/100)`,
      });
    }

    for (const field of section.fields) {
      blocks.push({ type: 'label', text: field.label });
      const value = (data[field.id] || '').trim();
      blocks.push(value ? { type: 'text', text: value } : { type: 'empty', text: 'Not provided' });
    }

    if (section.extra === 'ratio') {
      blocks.push({ type: 'label', text: 'Gain-Pain Ratio' });
      blocks.push({
        type: 'fact',
        text: `Gain ${data.gain_range} / Pain ${data.pain_range} = ` +
          `${gainPainRatio(data.gain_range, data.pain_range)}x calculated viability`,
      });
    }
  }
  return blocks;
}
