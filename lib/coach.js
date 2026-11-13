// Local-only AI coach: runs the vendored gstack skills (coach/.claude/skills) through the
// Claude Agent SDK on the owner's Claude Code login. Never runs on Vercel.
//
// Lockdown, per the Step 0 spike (docs/agent-sdk-handoff.md):
// - `tools` limits built-ins to read-only ones; Bash/Write/Edit do not exist in the session.
// - permissionMode 'default' with an empty allowedTools, so every call reaches canUseTool.
//   ('dontAsk' denies AskUserQuestion, and allowedTools entries skip canUseTool.)
// - settingSources ['project'] with cwd coach/, plus claudeMdExcludes and no auto-memory,
//   so ~/.claude settings, CLAUDE.md files and memory stay out.
// - strictMcpConfig + disableClaudeAiConnectors, so only the in-process workbook server loads.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SECTIONS, TEXT_FIELDS, NUMERIC_FIELDS, HttpError, classifyNeed, sanitizeData } from './fields.js';
import { newId } from './http.js';

const COACH_DIR = fileURLToPath(new URL('../coach', import.meta.url));
const SKILL = { 'office-hours': 'office-hours', 'ceo-review': 'plan-ceo-review' };
const MAX_TURNS = { 'office-hours': 60, 'ceo-review': 80 };
const QUESTION_TIMEOUT_MS = 30 * 60 * 1000;

const FIELD_HELP = {
  mvs_narrative: 'Minimum Viable Segment: exactly who this is for, their shared characteristics and situation. Name a real person where possible.',
  unworkable_txt: 'Unworkable: how the current situation is broken or inefficient.',
  unavoidable_txt: 'Unavoidable: why the customer has to solve this (mandates, laws, forces they cannot avoid).',
  urgent_txt: 'Urgent: why the problem needs attention now, not next year.',
  underserved_txt: "Underserved: why existing solutions (the status quo, competitors) don't adequately address the need.",
  maslow_narrative: 'The underlying human need the product serves (e.g. security, control, belonging, esteem).',
  graph_text: 'Why the product sits where it does on the needs map (critical vs aspirational, latent vs blatant).',
  disruptive_txt: 'Disruptive: how the product makes an existing market more accessible, cheaper or efficient.',
  discontinuous_txt: 'Discontinuous: what users can now do that was impossible before.',
  moat_ip: 'Defensibility through intellectual property (patents, trade secrets).',
  moat_switching: 'Defensibility through switching costs: why it is hard to leave.',
  moat_network: 'Defensibility through network effects: does it get better with more users?',
  moat_data: 'Defensibility through proprietary data: what unique data is collected.',
  life_before: "Before: the customer's current painful situation.",
  life_after: "After: the customer's situation once the product works.",
  gain_narrative: "Gain: the 10x benefit, in detail and in the customer's terms.",
  pain_narrative: 'Pain: the friction and cost of adopting (money, effort, switching, risk).',
  card_who: "Share card 1, who it's for: one short plain sentence naming the specific person or role (under 90 characters).",
  card_pain: 'Share card 2, the pain: one short plain sentence on the problem they have today (under 110 characters).',
  card_need: 'Share card 3, need line: one short plain sentence on why this need is critical and blatant (under 90 characters).',
  card_before: 'Share card 4, before: one short plain sentence on life today, with the pain in it (under 120 characters).',
  card_after: 'Share card 4, after: one short plain sentence on life once it works (under 120 characters).',
  card_pitch: 'Share card 5, one-line pitch: a single plain sentence, "We help [who] do [what]" style (under 90 characters).',
};
const NUMERIC_HELP = {
  graph_x: 'Needs map x, 0-100: below 50 = latent need (customer does not yet feel it), above 50 = blatant.',
  graph_y: 'Needs map y, 0-100: below 50 = critical need, above 50 = aspirational.',
  gain_range: 'Gain score 1-100 (how big the benefit is).',
  pain_range: 'Pain score 1-10 (how hard adoption is).',
};

// ------------------------------------------------------------ input

export function parseCoachRequest(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Request body must be an object');
  const { mode, path = 'guided', message = '', sessionId } = body;
  if (!SKILL[mode]) throw new HttpError(400, 'Unknown coach mode');
  if (mode === 'office-hours' && !['guided', 'braindump'].includes(path)) throw new HttpError(400, 'Unknown office-hours path');
  if (typeof message !== 'string' || message.length > 30000) throw new HttpError(400, 'Message must be text under 30,000 characters');
  if (mode === 'office-hours' && path === 'braindump' && !sessionId && !message.trim()) throw new HttpError(400, 'Paste your notes first');
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId))) throw new HttpError(400, 'Invalid session id');
  if (sessionId && !message.trim()) throw new HttpError(400, 'Message is required');
  const workbook = body.workbook === undefined ? null : sanitizeData(body.workbook);
  return { mode, path: mode === 'office-hours' ? path : null, message: message.trim(), sessionId, workbook };
}

export function renderWorkbook(data) {
  if (!data) return '(no workbook sent)';
  const lines = [];
  for (const s of SECTIONS) {
    lines.push(`## ${s.title}`);
    if (s.extra === 'needsMap') {
      lines.push(`- graph_x / graph_y (needs map position): ${data.graph_x} / ${data.graph_y} → ${classifyNeed(data.graph_x, data.graph_y)}`);
    }
    for (const f of s.fields) lines.push(`- ${f.id} (${f.label}): ${data[f.id]?.trim() || '(empty)'}`);
    if (s.extra === 'ratio') lines.push(`- gain_range / pain_range: ${data.gain_range} / ${data.pain_range}`);
  }
  return lines.join('\n');
}

export function buildPrompt({ mode, path, message, sessionId, workbook }) {
  if (sessionId) {
    // Follow-up turn in an existing session: the skill is already running.
    return workbook ? `${message}\n\n(Current workbook, for reference:)\n${renderWorkbook(workbook)}` : message;
  }
  if (mode === 'ceo-review') {
    return `/plan-ceo-review\n\nThe workbook below is the plan to review.\n\n${renderWorkbook(workbook)}` +
      (message ? `\n\nFounder's note: ${message}` : '');
  }
  const intro = path === 'braindump'
    ? `Here are my raw notes. Fill my workbook from them:\n"""\n${message}\n"""`
    : message ? `My idea: ${message}` : 'I want to work through my value proposition.';
  const cards = '\n\nWhen the session wraps up, call fill_workbook once more to fill the six card_* fields (card_who, card_pain, card_need, card_before, card_after, card_pitch). Write each as one short, plain sentence a stranger could read on a social image: no jargon, no lists, no quotation marks.';
  return `/office-hours PATH: ${path}\n\nHere is the current workbook:\n${renderWorkbook(workbook)}\n\n${intro}${cards}`;
}

// ------------------------------------------------------------ pending questions

// Single-user local server: questions wait here until /api/coach/answer resolves them.
const pending = new Map(); // id -> { resolve, timer }

export function answerQuestion(id, answers) {
  const entry = pending.get(id);
  if (!entry) throw new HttpError(404, 'That question is no longer waiting for an answer');
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve(answers);
}

function waitForAnswer(id, signal) {
  return new Promise((resolvePromise) => {
    const done = (value) => { pending.delete(id); clearTimeout(timer); resolvePromise(value); };
    const timer = setTimeout(() => done(null), QUESTION_TIMEOUT_MS);
    signal?.addEventListener('abort', () => done(null), { once: true });
    pending.set(id, { resolve: done, timer });
  });
}

export function parseAnswer(body) {
  const { id, answers } = body || {};
  if (typeof id !== 'string' || !/^[\w-]{6,40}$/.test(id)) throw new HttpError(400, 'Invalid question id');
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, 'Answers must be an object');
  const clean = {};
  for (const [q, a] of Object.entries(answers).slice(0, 4)) {
    if (typeof a !== 'string') throw new HttpError(400, 'Each answer must be text');
    clean[String(q).slice(0, 2000)] = a.slice(0, 5000);
  }
  return { id, answers: clean };
}

// ------------------------------------------------------------ session

function workbookServer(sdk, current, emit) {
  const fields = z.object(Object.fromEntries(TEXT_FIELDS.map((id) => [id, z.string().optional().describe(FIELD_HELP[id])])));
  const numeric = z.object(Object.fromEntries(Object.keys(NUMERIC_FIELDS).map((id) => [id, z.number().optional().describe(NUMERIC_HELP[id])])));
  const fill = sdk.tool(
    'fill_workbook',
    "Write values into the founder's value-proposition workbook. Pass only the fields you are setting; each string replaces that field's current text, so include any existing text you want to keep. Unknown fields are dropped and numbers are clamped to range.",
    { fields: fields.optional(), numeric: numeric.optional(), note: z.string().optional().describe('One line for the founder on what changed.') },
    async (args) => {
      const sent = { ...(args.fields || {}), ...(args.numeric || {}) };
      // sanitizeData fills every field, so merge first and keep only the keys the model sent.
      const clean = sanitizeData({ ...current, ...sent });
      const applied = Object.keys(sent).filter((k) => k in clean);
      const update = Object.fromEntries(applied.map((k) => [k, clean[k]]));
      Object.assign(current, update);
      if (applied.length) emit({ type: 'fill', fields: update, note: typeof args.note === 'string' ? args.note.slice(0, 500) : '' });
      return { content: [{ type: 'text', text: `applied: ${applied.join(', ') || '(nothing)'}` }] };
    },
  );
  return sdk.createSdkMcpServer({ name: 'workbook', version: '1.0.0', tools: [fill] });
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

function insideCoachDir(input) {
  const target = resolve(COACH_DIR, input.file_path || input.path || '.');
  return target === COACH_DIR || target.startsWith(COACH_DIR + '/');
}

// Runs one coach turn and calls emit(event) for each SSE event. Resolves when the turn ends.
export async function runCoach(req, emit, signal) {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const writes = req.mode === 'office-hours';
  const current = { ...(req.workbook || sanitizeData({})) };
  const abortController = new AbortController();
  signal?.addEventListener('abort', () => abortController.abort(), { once: true });

  async function canUseTool(toolName, input, { signal: toolSignal } = {}) {
    if (toolName === 'AskUserQuestion') {
      const id = newId();
      emit({ type: 'question', id, questions: input.questions });
      const answers = await waitForAnswer(id, toolSignal || abortController.signal);
      if (!answers) return { behavior: 'deny', message: 'The founder did not answer this question. Continue without it, or ask in chat.' };
      return { behavior: 'allow', updatedInput: { ...input, answers } };
    }
    if (READ_TOOLS.has(toolName)) {
      return insideCoachDir(input)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'The coach can only read its own skill files.' };
    }
    if (toolName === 'WebSearch' || (writes && toolName === 'mcp__workbook__fill_workbook')) {
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: `${toolName} is not available in the coach.` };
  }

  const options = {
    cwd: COACH_DIR,
    settingSources: ['project'],
    // settingSources alone still loads ~/.claude/CLAUDE.md (seen in testing); exclude every
    // instruction file and auto-memory so only the skill text steers the coach.
    settings: {
      disableClaudeAiConnectors: true,
      claudeMdExcludes: ['**/CLAUDE.md', '**/CLAUDE.local.md', '**/.claude/rules/**'],
      autoMemoryEnabled: false,
    },
    strictMcpConfig: true,
    skills: [SKILL[req.mode]],
    tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'AskUserQuestion', 'Skill'],
    allowedTools: [],
    disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Agent', 'Task'],
    permissionMode: 'default',
    canUseTool,
    mcpServers: writes ? { workbook: workbookServer(sdk, current, emit) } : {},
    includePartialMessages: true,
    maxTurns: MAX_TURNS[req.mode],
    abortController,
    // Run on the Claude Code login (owner's plan), never an API key from the environment.
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)$/.test(k))),
    ...(process.env.COACH_MODEL ? { model: process.env.COACH_MODEL } : {}),
    ...(req.sessionId ? { resume: req.sessionId } : {}),
  };

  let sessionId = req.sessionId || null;
  for await (const m of sdk.query({ prompt: buildPrompt(req), options })) {
    if (m.type === 'system' && m.subtype === 'init') {
      sessionId = m.session_id;
      emit({ type: 'session', sessionId, model: m.model, apiKeySource: m.apiKeySource });
    } else if (m.type === 'stream_event') {
      const e = m.event;
      if (m.parent_tool_use_id == null && e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        emit({ type: 'text', delta: e.delta.text });
      } else if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use' && e.content_block.name !== 'AskUserQuestion') {
        // Announce a tool as soon as the model starts writing the call: a full fill_workbook
        // call takes tens of seconds to generate.
        emit({ type: 'tool', name: e.content_block.name });
      } else if (e.type === 'message_stop') {
        emit({ type: 'text_end' });
      }
    } else if (m.type === 'result') {
      if (m.subtype !== 'success') {
        emit({ type: 'error', message: m.subtype === 'error_max_turns' ? 'The coach hit its turn limit. Send a message to continue.' : 'The coach stopped with an error.', code: m.subtype });
      }
      emit({ type: 'done', sessionId: m.session_id || sessionId, turns: m.num_turns, costEstimateUsd: m.total_cost_usd });
    }
  }
}
