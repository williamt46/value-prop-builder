// Builds the "vet clinic no-show killer" demo snapshot from a recorded coach session.
//
//   node docs/demo/build-vet-no-show.mjs
//
// Reads the Claude Agent SDK transcript of the brain-dump session and writes
// docs/demo/vet-no-show.html: a page that restores the filled workbook and the coach
// conversation into this browser (served by the dev server at /demo/vet-no-show).
// The transcript stops at the coach's summary; later test turns are left out.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sanitizeData, TEXT_FIELDS } from '../../lib/fields.js';

const SESSION_ID = '3cb44090-6082-47b7-8c8b-cba7aa3f9fbc';
// Saved copy (share link /?w=<id>); no edit token is stored here.
const WORKBOOK = { id: '0y_ahYODp0CY', title: 'Vet clinic no-show killer (coach demo)' };
const NOTES = `ok so the idea: no-show killer for small vet clinics. my sister Dana runs Riverbend Animal Clinic (3 vets, Portland) and she says ~12% of appts no-show, each one is ~$180 lost. they use AVImark and the front desk calls everyone the day before, takes Maria (front desk) like 90 min every afternoon. they tried the built-in text reminders but people ignore them. idea is reminders where you can rebook/cancel in one tap and the slot auto-fills from a waitlist. Dana said she'd pay $200/mo if it cut no-shows in half. talked to 2 other clinics, one said "interesting", one said they already use PetDesk. ~30k independent vet practices in the US. I think the waitlist data could be a moat?? not sure. clinics hate switching software.`;

const sessionDir = join(homedir(), '.claude/projects/-Users-kabst-value-prop-workbook-coach');
const sessionFile = join(sessionDir, `${SESSION_ID}.jsonl`);
const lines = readFileSync(sessionFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// Workbook before the coach: only the founder's one-line segment.
const original = { ...sanitizeData({}), mvs_narrative: 'Small independent veterinary clinics.' };
const workbook = { ...original };
const log = [{ role: 'user', text: NOTES }];

for (const line of lines) {
  if (line.isSidechain) continue;
  if (line.type === 'user' && typeof line.message?.content !== 'string' &&
      line.message?.content?.some((b) => b.type === 'text' && b.text.startsWith('I undid your fill'))) break; // test turn: stop
  if (line.type === 'user' && line.toolUseResult?.answers) {
    const { questions, answers } = line.toolUseResult;
    for (const q of questions) {
      const title = q.question.split('\n')[0].replace(/^[DQ]\d+(\.\d+)?\s*(—|–|-|:)\s*/, '');
      log.push({ role: 'answer', text: `${title} → ${answers[q.question]}` });
    }
  }
  if (line.type !== 'assistant') continue;
  for (const b of line.message.content) {
    if (b.type === 'text' && b.text.trim()) log.push({ role: 'assistant', text: b.text });
    if (b.type === 'tool_use' && b.name === 'mcp__workbook__fill_workbook') {
      const sent = { ...(b.input.fields || {}), ...(b.input.numeric || {}) };
      const clean = sanitizeData({ ...workbook, ...sent });
      const fields = Object.fromEntries(Object.keys(sent).filter((k) => k in clean).map((k) => [k, clean[k]]));
      Object.assign(workbook, fields);
      log.push({ role: 'fill', fields, note: b.input.note || '' });
    }
  }
}

const empty = TEXT_FIELDS.filter((f) => !workbook[f].trim());
if (empty.length) throw new Error(`Workbook has empty fields: ${empty.join(', ')}`);

const coach = { mode: 'office-hours', path: 'braindump', sessionId: SESSION_ID, log, paused: true, undo: original };
const snapshot = { builtAt: new Date().toISOString(), workbook: WORKBOOK, data: workbook, coach };

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Restore demo: vet clinic no-show killer</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;max-width:560px;margin:10vh auto;padding:0 16px;line-height:1.5}
button{background:#059669;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:16px;font-weight:600;cursor:pointer}
.muted{color:#64748b;font-size:14px}</style></head>
<body>
<h1>Restore the coach demo</h1>
<p>This loads the <strong>vet clinic no-show killer</strong> workbook, filled by the brain-dump coach, plus the coach conversation (3 questions answered, summary and assignment). <strong>Undo AI fill</strong> will show the workbook as it was before the coach.</p>
<p class="muted">It replaces the current draft in this browser for this address (${'${location.host}'}). Saved workbooks are not touched.</p>
<p><button id="go">Restore demo</button></p>
<script>
const SNAPSHOT = ${JSON.stringify(snapshot).replace(/</g, '\\u003c')};
document.querySelector('.muted').textContent = document.querySelector('.muted').textContent.replace('\${location.host}', location.host);
document.getElementById('go').onclick = () => {
  const P = 'vprop_v4_';
  const set = (k, v) => localStorage.setItem(P + k, typeof v === 'string' ? v : JSON.stringify(v));
  // Restore as a fresh unsaved draft (not linked to any saved workbook), plus the coach conversation.
  for (const [k, v] of Object.entries(SNAPSHOT.data)) set(k, String(v));
  localStorage.removeItem(P + 'current');
  localStorage.removeItem(P + 'saved_at');
  set('dirty', '1');
  set('coach', SNAPSHOT.coach);
  location.href = '/?coach=1';
};
</script>
</body></html>
`;

const out = new URL('./', import.meta.url);
writeFileSync(new URL('vet-no-show.html', out), html);
writeFileSync(new URL('vet-no-show.snapshot.json', out), JSON.stringify(snapshot, null, 2));
console.log(`fills=${log.filter((e) => e.role === 'fill').length} answers=${log.filter((e) => e.role === 'answer').length} assistant=${log.filter((e) => e.role === 'assistant').length}`);
console.log(log.filter((e) => e.role === 'answer').map((e) => '  ' + e.text).join('\n'));
