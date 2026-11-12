# Handoff: Agent SDK coach in Value Prop Builder (office-hours + CEO review)

Status: planning only. No code has been written. Whoever builds this starts at Step 0.

Heads-up: other Claude sessions were editing this repo when this was written (`git status` showed `index.html`, `dev-server.mjs`, `lib/*`, `api/auth/*`, `README.md` modified). Line numbers below were read at that time; re-check them against the current files.

## Context

Value Prop Builder (`/Users/kabst/value-prop-workbook`) is a no-build app: single `index.html`, Web-standard handlers in `api/`, `dev-server.mjs` for local, Turso/libSQL for storage. Its AI features run on the user's ChatGPT plan through `api/ai.js`, which is three one-shot prompts (`refine`, `critique`, `pitch`).

Goal: run the gstack `/office-hours` and `/plan-ceo-review` skills inside the web app, locally first via `npm run dev`, using the **Claude Agent SDK on the owner's Claude Pro login**. The live build comes later and is out of scope.

## Decisions (made by the owner)

1. **Isolated copies of the skills live in the repo** (not the originals in `~/.claude/skills`). gstack is MIT licensed (Copyright 2026 Garry Tan, https://github.com/garrytan/gstack), so vendoring is allowed; keep the license text and note the upstream commit.
2. **CEO review treats the workbook as the plan.** The workbook is rendered to text and handed to `plan-ceo-review` as the thing under review.
3. **Office-hours has two paths, and in both the results populate the workbook automatically in the right fields:**
   - **Path A, guided:** the skill asks its questions step by step, rendered as question cards in the UI.
   - **Path B, brain dump:** the user pastes raw, unstructured text; the coach maps it into the workbook fields.

Assumptions I made that the owner has not confirmed (flag them when building):
- CEO review is read-only: it produces a review in chat and does not write to the workbook.
- Auto-fill may overwrite non-empty fields, with a one-click undo, and the coach is shown current field values so it extends rather than clobbers.
- Brain dump is paste-only (no file upload) in v1.

## Spike findings (already run; nothing in the repo changed)
Spike code: `/private/tmp/claude-501/-Users-kabst-value-prop-workbook/2300d13f-78bc-4717-ad2f-0fedf8c71867/scratchpad/sdk-spike/` (`spike1.mjs`, `spike2.mjs`).

- `@anthropic-ai/claude-agent-sdk` 0.3.322 installs cleanly on Node 24; local Claude Code is 2.1.322.
- With no `ANTHROPIC_*` env vars the SDK reports `apiKeySource: "none"`, so it runs on the Claude Code login and Pro limits apply. The `total_cost_usd` it prints is an estimate, not a charge.
- `settingSources: ['user'], skills: 'all'` loaded `office-hours` from `~/.claude/skills`.
- `/office-hours` reached its first `AskUserQuestion`, and that call arrived in `canUseTool(toolName, input)`. Input shape (`sdk-tools.d.ts`, `AskUserQuestionInput`): 1-4 questions, each with `header`, `options[2-4]` of `{label, description, preview?}`, `multiSelect`.
- The probe hit my own `maxTurns: 8` cap (`error_max_turns`), about $0.59 estimated, mostly the 44KB skill text.

## Hazards and how the design handles them
1. **Auto-upgrade of gstack.** The original skill preamble said it would upgrade gstack from v1.92.80.0 to v1.99.1.0. *Handled by:* the coach runs only vendored copies with no Bash tool, so nothing can touch `~/.claude/skills/gstack`.
2. **Preamble side effects** (`bin/gstack-skill-start` writes `~/.gstack/*`; allow rules in the owner's Claude settings could auto-approve Bash before `canUseTool` sees it). *Handled by:* `settingSources: ['project']`, `permissionMode: 'dontAsk'`, and an explicit `allowedTools` list with no Bash/Write/Edit.
3. **Global `~/.claude/CLAUDE.md` leaking in** (simulator rules, "use /browse"). *Handled by:* not loading the `user` setting source; `cwd` is `coach/`.
4. **`plan-ceo-review` has a `PostToolUse` Bash hook** (`bin/mode-handoff-hook`). *Handled by:* the vendored copy drops the hook frontmatter.
5. **The skills lean on gstack helper scripts.** Both `SKILL.md` files call `~/.claude/skills/gstack/bin/*` (`gstack-brain-cache`, `gstack-slug`, `gstack-paths`, `gstack-config`, `gstack-question-preference`, and for CEO review `gstack-plan-reality`, `gstack-design-doc-find`, `gstack-learnings-search`) and read `sections/*.md`. They also read and write `~/.gstack/projects/<slug>/…`. *Handled by:* "coach edition" copies (see Step 0/1) that strip the helper calls and keep the method.
6. **Policy.** Pro-login auth is for the owner's own local use. Anthropic's terms bar offering Claude.ai login to other people, so the live build needs an API key. I could not verify the current terms; re-read https://code.claude.com/docs/en/legal-and-compliance before the live step.

## Approach

A local-only coach: a streaming endpoint wrapping `query()`, an in-process "fill workbook" tool, and a chat panel in `index.html`.

### Coach modes
| Mode | Skill | Input | Tools allowed | Writes workbook? |
|---|---|---|---|---|
| `office-hours` + `guided` (Path A) | office-hours | optional one-line idea; current workbook values | Read, Grep, Glob, WebSearch, AskUserQuestion, Skill, `fill_workbook` | yes, as answers settle and at the end |
| `office-hours` + `braindump` (Path B) | office-hours | pasted raw text; current workbook values | same as A | yes, in one or a few calls, then a gaps summary |
| `ceo-review` | plan-ceo-review | the whole workbook rendered as the plan | Read, Grep, Glob, WebSearch, AskUserQuestion, Skill | no |

### Step 0: spike to resolve open questions (no repo changes)
1. **Build the coach-edition skills.** Write `coach/sync-skills.mjs` that reads upstream `~/.claude/skills/gstack/{office-hours,plan-ceo-review}` and writes `coach/.claude/skills/<name>/SKILL.md` plus any `sections/` the method needs, with: the preamble block and every `~/.claude/skills/gstack/bin/*` call removed, `gbrain`/`hooks`/`allowed-tools` frontmatter dropped, telemetry/upgrade/learnings steps removed, and `~/.gstack` reads/writes removed. Keep the core method: for office-hours, `sections/phase-2a-startup-diagnostic.md` (the forcing questions) and `design-and-handoff.md`; for CEO review, `review-sections.md` and `checklist.md`. Include `coach/LICENSE-gstack` and a header comment with the upstream version and commit. The generated `SKILL.md` files are build output from `SKILL.md.tmpl`; derive from the generated files, not the templates.
2. **Check quality survives stripping.** Run both vendored skills through a probe and compare against the originals' first few turns. If the stripped version loses the push-back behaviour, restore the missing section.
3. **Brain-dump behaviour.** Test whether the vendored office-hours honours a "brain-dump mode" instruction (skip the interactive question loop, map the pasted text, ask at most a few clarifying questions only where a field would otherwise stay empty). If not, fall back to a dedicated system-prompt append for Path B that reuses office-hours' forcing-question lens.
4. **AskUserQuestion answer shape.** Confirm the `canUseTool` allow response (`{behavior:'allow', updatedInput:{questions, answers}}`); read `AskUserQuestionOutput` in `sdk-tools.d.ts` for the exact answers field.
5. **Lockdown.** Confirm `permissionMode: 'dontAsk'` plus the `allowedTools` list actually blocks Bash/Write even when the owner's user settings contain allow rules (they should not load with `settingSources: ['project']`, but verify).
6. **Custom tool wiring.** Confirm `createSdkMcpServer` + `tool()` from the SDK expose `mcp__workbook__fill_workbook` to the skill session, and that the skill actually calls it when told to.

### Step 1: server, `api/coach.js` (new)
- `POST /api/coach` body `{ mode: 'office-hours' | 'ceo-review', path?: 'guided' | 'braindump', message, workbook?, sessionId? }`, response is a stream of server-sent events (SSE).
- Prompt wrapper: invoke the skill, then add the context: `workbook` rendered as text via `SECTIONS` (`lib/fields.js`) / `lib/document.js`, the field IDs and their meaning, and for CEO review the line "the workbook below is the plan to review".
- `query({ prompt, options: { settingSources: ['project'], cwd: coachDir, skills: 'all', allowedTools, permissionMode: 'dontAsk', canUseTool, mcpServers: { workbook }, includePartialMessages: true, maxTurns, resume: sessionId } })`.
- **`fill_workbook` tool** (in-process MCP server, `createSdkMcpServer`): input `{ fields: { <TEXT_FIELDS id>: string }, numeric?: { graph_x, graph_y, gain_range, pain_range }, note?: string }`. The handler validates with `sanitizeData` (`lib/fields.js`; it drops unknown fields, coerces types, clamps ranges), pushes `{type:'fill', fields, numeric}` onto the SSE stream, and returns "applied: <ids>" to the model. Only registered for office-hours modes.
- **Questions:** on an `AskUserQuestion` request in `canUseTool`, emit `{type:'question', id, questions}`, hold the promise, resolve it when the browser posts to `POST /api/coach/answer` (in-memory `Map<id, resolver>`, fine for single-user local).
- Stream assistant text deltas as `{type:'text', delta}`; emit `{type:'done', sessionId}` at the end so the conversation can resume.
- **Guards:** local mode only (reuse `signInMode(request) === 'local'`, `lib/openai-auth.js`: `127.0.0.1` and no `process.env.VERCEL`), 404 on Vercel. Reuse `assertSameOrigin`, `readJson`, `route` from `lib/http.js`.

### Step 2: dev server, `dev-server.mjs`
- Add `/api/coach` and `/api/coach/answer` to `routes`.
- `send()` currently does `Buffer.from(await response.arrayBuffer())`, which buffers everything. Add a streaming branch: if `content-type` is `text/event-stream`, pipe `response.body` to `res` and flush per chunk. Leave the non-streaming path unchanged.

### Step 3: persistence, `lib/db.js`
- Add `coach_sessions` (`id`, `workbook_id`, `mode`, `path`, `sdk_session_id`, `transcript` JSON, `created_at`, `updated_at`) to the `SCHEMA` array, following the existing `CREATE TABLE IF NOT EXISTS` pattern. This replaces `~/.gstack` as the record and carries over to the live build.

### Step 4: UI, `index.html`
- **Coach panel** with three entry points: "Office hours: guided", "Office hours: brain dump", "CEO review".
- **Guided:** message list plus a question card for each `AskUserQuestion` (chips from `header`, option buttons with `description`, "Other" free text, multiSelect support).
- **Brain dump:** a large textarea, "Fill my workbook" button, then a streamed summary of what was filled and which fields are still weak or empty.
- **Auto-populate:** on a `fill` event, write each value into the field's existing input by ID (IDs must match `lib/fields.js`), trigger the existing draft autosave, briefly highlight changed fields, and keep a snapshot so a single "Undo AI fill" button restores the previous values. Reuse the existing styling (Tailwind classes; `body.ai-off` gating near line 105; modal helpers like `showModalMessage` near line 1213).
- **Gate:** show the panel only when the server reports coach support (extend `/api/auth/me`, `api/auth/me.js`, with `coach: true` in local mode).

### Step 5: config and docs
- `package.json`: add `@anthropic-ai/claude-agent-sdk`.
- Commit `coach/.claude/skills/*` and `coach/LICENSE-gstack` (MIT, attribute upstream). `.gitignore` already covers `data/` and `.env*`.
- `README.md`: add a "Coach (local only)" section: needs Claude Code logged in, runs on your Claude plan, never on the hosted site, how to refresh the skills with `node coach/sync-skills.mjs`.
- `vercel.json` CSP needs no change (`connect-src 'self'`).

## Critical files
- Modify: `dev-server.mjs`, `lib/db.js`, `index.html`, `api/auth/me.js`, `package.json`, `README.md`
- New: `api/coach.js`, `api/coach/answer.js` (or one handler that routes on path), `coach/sync-skills.mjs`, `coach/.claude/skills/office-hours/`, `coach/.claude/skills/plan-ceo-review/`, `coach/LICENSE-gstack`
- Reuse: `lib/http.js` (`route`, `json`, `readJson`, `assertSameOrigin`), `lib/fields.js` (`SECTIONS`, `TEXT_FIELDS`, `NUMERIC_FIELDS`, `sanitizeData`, `HttpError`), `lib/document.js`, `lib/openai-auth.js` (`signInMode`)
- Reference (read-only): `~/.claude/skills/gstack/office-hours/SKILL.md`, `.../plan-ceo-review/SKILL.md`, their `sections/`, `.../bin/gstack-skill-start`

## Verification
1. `npm run dev`, open http://127.0.0.1:3000, start **Office hours: guided**: a question card renders, answering continues the session, and fields fill as answers settle.
2. **Brain dump:** paste a messy paragraph; the relevant fields fill, the summary names gaps, and "Undo AI fill" restores the previous values. Refresh and confirm the draft autosave kept the filled values.
3. **CEO review** on a filled workbook: it reviews the workbook content (not a repo file) and writes nothing to the fields.
4. **No side effects:** `cat ~/.claude/skills/gstack/VERSION` is unchanged, `git -C ~/.claude/skills/gstack status` shows no new changes, and `~/.gstack/sessions` gets no new entries from coach runs.
5. **Lockdown:** ask the coach to "run ls" or "write a file": refused.
6. **Streaming:** text appears incrementally (proves the `dev-server.mjs` fix).
7. **Validation:** a `fill_workbook` call with an unknown field ID or an out-of-range number is dropped or clamped, not written.
8. **Resume:** reload mid-session and resume with the stored `sessionId`.
9. **Guards:** `/api/coach` with `VERCEL=1` or a non-`127.0.0.1` host returns 404; a cross-origin request returns 403.
10. **Plan usage:** `apiKeySource` stays `"none"` and the session counts against Pro usage in Claude settings.

## Out of scope / later (live build)
- The live site cannot use the owner's Pro login. Options: an Anthropic API key held server-side with per-user rate limits, bring-your-own-key, or the Vercel AI SDK with ported prompts. On Vercel, the Agent SDK would also need a sandbox (Vercel Sandbox) if any tool beyond Read/WebSearch is enabled.
- Porting the skill methodology into plain prompts and tools, so no skill files are needed.
- Auth for coach sessions, multi-user session isolation, cost controls, file upload for brain dumps.
