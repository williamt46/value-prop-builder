import { HttpError } from '../lib/fields.js';
import { assertSameOrigin, json, readJson, route } from '../lib/http.js';
import { API_BASE, authConfig } from '../lib/openai-auth.js';
import { getAccessToken, getSession, saveSessionModel } from '../lib/session.js';

// System prompts live on the server; the client picks a task and supplies the workbook context.
const TASKS = {
  refine: "You are a world-class startup mentor. You help founders find 'Hair on Fire' problems. Be concise, critical, and strategic. Use frameworks like the 4 Us and MVS.",
  critique: "You are a 'Red Team' startup consultant. Your job is to poke holes in this value proposition. Identify why it might fail and how to make it more defensible.",
  pitch: "You are an expert pitch coach. Create a 30-second high-impact elevator pitch. Focus on the transformation from 'Life Before' to 'Life After'.",
};
const MAX_PROMPT = 30000;

// Recovery guidance from https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
function planError(status, code) {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return new HttpError(429, "You've reached your ChatGPT usage limit for this app.", 'usage_limit');
    case 'subscription_sharing_user_not_eligible':
      return new HttpError(403, "Your ChatGPT account isn't eligible to use its plan in this app.", 'not_eligible');
    case 'subscription_sharing_invalid_user':
      return new HttpError(401, 'Your ChatGPT session expired. Please sign in again.', 'reauth');
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return new HttpError(503, 'ChatGPT is temporarily unavailable. Please try again shortly.', 'unavailable');
  }
  if (status === 401) return new HttpError(401, 'Your ChatGPT session expired. Please sign in again.', 'reauth');
  if (status === 503) return new HttpError(503, 'ChatGPT is temporarily unavailable. Please try again shortly.', 'unavailable');
  return new HttpError(502, 'The AI request failed. Please try again.', 'ai_failed');
}

async function pickModel(session, accessToken) {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  if (session.model) return session.model;
  const res = await fetch(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw planError(res.status, '');
  const { models = [] } = await res.json();
  const model = models.find((m) => m.visibility === 'list')?.slug;
  if (!model) throw new HttpError(503, 'No ChatGPT models are available for this account.', 'unavailable');
  await saveSessionModel(session, model);
  return model;
}

// Read the Responses stream to its terminal event and return the output text.
async function readStream(res) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data);
      if (event.type === 'response.output_text.delta') text += event.delta;
      else if (event.type === 'response.completed') return text;
      else if (event.type === 'response.failed') throw planError(0, event.response?.error?.code);
      else if (event.type === 'response.incomplete') throw new HttpError(502, 'The AI response was cut short. Please try again.', 'ai_failed');
      else if (event.type === 'error') throw planError(0, event.code || event.error?.code);
    }
  }
  throw new HttpError(502, 'The AI response ended unexpectedly. Please try again.', 'ai_failed');
}

// POST /api/ai — run a workbook AI task on the signed-in user's ChatGPT plan.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const body = await readJson(request);
  const instructions = TASKS[body.task];
  if (!instructions) throw new HttpError(400, 'Unknown AI task');
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new HttpError(400, 'Prompt is required');

  const session = await getSession(request);
  if (!session) throw new HttpError(401, 'Sign in with ChatGPT to use AI features.', 'signin_required');
  if (!session.planUsage) {
    throw new HttpError(403, "Your ChatGPT sign-in doesn't include plan usage for this app yet.", 'plan_usage_disabled');
  }

  const accessToken = await getAccessToken(session, authConfig(request));
  const model = await pickModel(session, accessToken);
  const res = await fetch(`${API_BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model,
      instructions,
      input: [{ role: 'user', content: body.prompt.slice(0, MAX_PROMPT) }],
      store: false,
      stream: true,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    console.error('Responses API error', res.status, res.headers.get('x-request-id'), detail.error?.code || detail.detail || '');
    throw planError(res.status, detail.error?.code);
  }
  return json(200, { text: await readStream(res), model });
});
