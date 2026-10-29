// Workbook structure shared by validation and document export.
// Keep ids in sync with the field ids in index.html.

export const SECTIONS = [
  {
    title: 'Defining the "Who"',
    fields: [{ id: 'mvs_narrative', label: 'The Minimum Viable Segment (MVS)' }],
  },
  {
    title: "The Four U's of Problem Evaluation",
    fields: [
      { id: 'unworkable_txt', label: 'Unworkable' },
      { id: 'unavoidable_txt', label: 'Unavoidable' },
      { id: 'urgent_txt', label: 'Urgent' },
      { id: 'underserved_txt', label: 'Underserved' },
    ],
  },
  {
    title: 'Critical vs. Aspirational',
    fields: [
      { id: 'maslow_narrative', label: 'The Underlying Human Need' },
      { id: 'graph_text', label: 'Contextual Narrative' },
    ],
    extra: 'needsMap',
  },
  {
    title: "The Three D's",
    fields: [
      { id: 'disruptive_txt', label: 'Disruptive' },
      { id: 'discontinuous_txt', label: 'Discontinuous' },
      { id: 'moat_ip', label: 'Defensible: Intellectual Property' },
      { id: 'moat_switching', label: 'Defensible: Switching Costs' },
      { id: 'moat_network', label: 'Defensible: Network Effects' },
      { id: 'moat_data', label: 'Defensible: Proprietary Data' },
    ],
  },
  {
    title: 'Evaluation',
    fields: [
      { id: 'life_before', label: 'Before (Current Pain)' },
      { id: 'life_after', label: 'After (Future Gain)' },
      { id: 'gain_narrative', label: 'Gain (10x Benefit)' },
      { id: 'pain_narrative', label: 'Pain (Friction & Cost)' },
    ],
    extra: 'ratio',
  },
];

export const TEXT_FIELDS = SECTIONS.flatMap((s) => s.fields.map((f) => f.id));

// [min, max, default]
export const NUMERIC_FIELDS = {
  graph_x: [0, 100, 50],
  graph_y: [0, 100, 50],
  gain_range: [1, 100, 5],
  pain_range: [1, 10, 5],
};

const MAX_TEXT = 20000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(400, 'Invalid field value');
  }
  return String(value).slice(0, max);
}

// Keep only known fields, coerce types and clamp ranges.
export function sanitizeData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Workbook data must be an object');
  }
  const data = {};
  for (const id of TEXT_FIELDS) data[id] = cleanString(input[id], MAX_TEXT);
  for (const [id, [min, max, fallback]] of Object.entries(NUMERIC_FIELDS)) {
    const n = Number.parseFloat(input[id]);
    data[id] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  return data;
}

export function sanitizeTitle(value) {
  const title = cleanString(value, 200).trim();
  return title || 'Untitled Value Proposition';
}

export function sanitizeOwner(input = {}) {
  const owner = {
    name: cleanString(input.name, 120).trim(),
    email: cleanString(input.email, 254).trim(),
    organization: cleanString(input.organization, 160).trim(),
  };
  if (owner.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email)) {
    throw new HttpError(400, 'Email address looks invalid');
  }
  return owner;
}

export function classifyNeed(x, y) {
  return `${y < 50 ? 'Critical' : 'Aspirational'} & ${x < 50 ? 'Latent' : 'Blatant'}`;
}

export function gainPainRatio(gain, pain) {
  return (gain / pain).toFixed(1);
}
