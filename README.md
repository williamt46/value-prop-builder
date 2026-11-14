# CrashTest MVP

## A value proposition workbook for your next MVP
### Inspired by Michael Skok's Workshop at Harvard Innovation Labs "Value Props: Create a Product People Will Actually Buy"

### Purpose
CrashTest MVP is an interactive value proposition framework for your next MVP idea. Whether you're in the tech or healthcare industry, driving social change or revenue growth, scaling enterprise-level strategies or launching a lean startup, these foundational principles will help define, qualify, evaluate, measure, and build a product people actually want.


### Features
- Guided workbook: Minimum Viable Segment, the Four U's, the needs map, the Three D's, and the Gain-Pain ratio
- Save workbooks to a SQLite database along with owner details (name, optional email, organization)
- Share links (`/?w=<id>`) that anyone can open. Only the browser that created a workbook can update it; anyone else saves their own copy
- Export to DOCX or PDF
- Drafts autosave on your device between saves
- AI mentor feedback, critique and pitch generation through **Sign in with ChatGPT**, which runs on each user's own ChatGPT plan


### How to Use It

**Run locally**

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000 (`localhost` redirects there). Workbooks are stored in `data/workbooks.db`, a local SQLite file that git ignores. The server listens on `127.0.0.1` only; set `HOST=0.0.0.0` to expose it on your network. Owner features (local ChatGPT sign-in, the coach on your Claude login, the owner page) only answer requests from this laptop itself: a loopback connection with no proxy headers and a `127.0.0.1` Host. Other devices on the network never get them.

**AI features when running locally:** click **Continue with ChatGPT** in the sidebar and sign in. Eligible ChatGPT Plus and Pro accounts then run mentor feedback and pitches on their own plan, with no API key or OpenAI approval needed. This uses OpenAI's [ChatGPT plan usage for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source), which registers this install with your ChatGPT account on first sign-in. Review or limit its usage in [ChatGPT settings → Usage](https://chatgpt.com/settings/usage). Set `OPENAI_LOCAL_SIGNIN=false` to turn it off.

**Event mode (one link for a room of attendees)**

Attendees open one link and get their own brain-dump coach session on an Anthropic API key, then make their share cards. It runs only on the local dev server.

1. In the [Anthropic Console](https://console.anthropic.com), set a spend limit on the API key you use for the event. That limit is the only hard cap on spend.
2. Start the server with both variables set (without both, nothing changes):
   ```bash
   EVENT_CODE=pick-a-code ANTHROPIC_API_KEY=sk-ant-... npm run dev
   ```
   `COACH_MODEL` overrides the attendee model (default `claude-sonnet-5-5`).
3. Keep the laptop awake with `caffeinate -dis` in another terminal, then open a tunnel with no host-header flag:
   ```bash
   cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3000
   ```
4. Share `https://<tunnel>.trycloudflare.com/?e=<EVENT_CODE>`. The code is exchanged once for a signed cookie and removed from the URL.

Attendees get office-hours brain dump only (no guided session, CEO review or ChatGPT sign-in), up to 10 coach turns at once and one per attendee, 25 model calls per turn, and question cards that pause after 5 minutes (sending a message resumes). Their coach transcripts go to `data/event-claude/`; session bindings and spend go to `data/event-state.json`, and the server logs each turn's cost. Pressing **Make my cards** or **Save** stores the workbook; you see them at http://127.0.0.1:3000/owner on this laptop. Run `npm test` for the event-mode unit tests.

**Deploy to Vercel**

Vercel's filesystem doesn't persist, so production uses [Turso](https://turso.tech), a hosted SQLite-compatible database (also on the Vercel Marketplace). Create a database, then set these project environment variables:

- `TURSO_DATABASE_URL`, e.g. `libsql://your-db.turso.io`
- `TURSO_AUTH_TOKEN`

The tables are created automatically on first request.

**Sign in with ChatGPT on the hosted site**

AI requests run on the signed-in user's own ChatGPT plan through OpenAI's [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart). OpenAI issues client IDs to approved partners only:

1. Apply through OpenAI's [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/) and ask for **ChatGPT plan usage** for a hosted web app. Register the callback URL `https://<your-domain>/api/auth/openai/callback`.
2. Set these environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_CLIENT_ID` | yes | The `oaiapp_...` client ID OpenAI issues |
| `OPENAI_REDIRECT_URI` | in production | The exact registered callback URL |
| `OPENAI_CLIENT_SECRET` | if confidential | Only if OpenAI provisions a confidential client |
| `OPENAI_PLAN_USAGE` | after approval | `true` requests plan-usage scopes. Leave unset for name and email only |
| `SESSION_SECRET` | in production | Long random string used to encrypt stored OpenAI tokens |
| `OPENAI_MODEL` | no | Pin a model; by default the first model on the user's list is used |

Without `OPENAI_CLIENT_ID`, the hosted site works normally and hides its AI features. Local mode never runs on Vercel. OpenAI tokens stay on the server, encrypted, and the browser only holds an HttpOnly session cookie.

**API**

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/workbooks` | Create a workbook; returns `{ id, editToken }` |
| `GET` | `/api/workbooks/:id` | Read a shared workbook (owner email is never returned) |
| `PUT` | `/api/workbooks/:id` | Update a workbook; requires `Authorization: Bearer <editToken>` |
| `GET` | `/api/auth/openai` | Start Sign in with ChatGPT |
| `GET` | `/api/auth/me` | Current ChatGPT account and plan-usage status |
| `POST` | `/api/auth/logout` | Revoke the refresh token and end the session |
| `POST` | `/api/ai` | Run `{ task: "refine" \| "critique" \| "pitch", prompt }` on the user's ChatGPT plan |
| `POST` | `/api/export` | Render `{ format: "docx" \| "pdf", title, owner, data }` as a file |


### License

### Credit 


