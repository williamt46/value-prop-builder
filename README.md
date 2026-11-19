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

Attendees open one link and get their own brain-dump coach session on an Anthropic API key, then make their share cards. It runs only on this laptop's dev server, reached through a Cloudflare tunnel. Attendees never get your Claude login, your ChatGPT sign-in or the owner page.

*Once, before the event*

1. Install the tunnel (no account needed): `brew install cloudflared`.
2. Put the event API key in `.env` in this folder (git ignores it) as one line: `ANTHROPIC_API_KEY=sk-ant-...`.
3. In the [Anthropic Console](https://console.anthropic.com), set a spend limit on that key. That limit is the only hard cap on spend. A brain-dump session cost about $0.10 to $0.16 in testing.
4. Pick an event code, e.g. `roundtable-nov14`. Anyone with the link can use your key, so don't post the link publicly.
5. Clear old test data so it doesn't show on your owner page: `rm -rf data/event-state.json data/event-claude`. To also drop test workbooks, delete `data/workbooks.db`.

*Start (three terminal tabs, in this folder, in this order)*

1. Keep the laptop awake and plugged in:
   ```bash
   caffeinate -dis
   ```
2. Start the server. `--env-file` loads the key from `.env` so it never lands in your shell history:
   ```bash
   EVENT_CODE=roundtable-nov14 node --env-file=.env dev-server.mjs
   ```
   You should see `Event mode ON`. If you don't, the key or code is missing and the coach stays off.
3. Open the tunnel, with no host-header flag. Adding one makes attendees look like you:
   ```bash
   cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3000
   ```
   It prints `https://<words>.trycloudflare.com`. **Wait about 10 seconds** before opening it; opening it too early can cache a "not found". The address changes every time you restart the tunnel.
4. Test it yourself on your phone, on cellular, not your wifi: open `https://<words>.trycloudflare.com/?e=roundtable-nov14`, run a brain dump, press **Make my cards**, and download or share the images. Card download on a real phone has not been tested yet, so do this before anyone arrives.
5. Share that same link with the code on the end. The code is swapped once for a cookie and removed from the URL. Put the link on a slide or a QR code.

*During the event*

- Attendees get office-hours brain dump only (no guided session, CEO review or ChatGPT sign-in). Up to 10 coach turns run at once and one per attendee, with 25 model calls per turn. Question cards pause after 5 minutes and resume when they send a message. A reload resumes their session.
- Their ideas pass through this laptop and the Anthropic API. The start screen tells them so.
- Watch the server tab: it logs each turn's cost and any errors.
- See what people saved at http://127.0.0.1:3000/owner on this laptop. **Make my cards** and **Save** store the workbook. The owner page also shows a big **Scan to join** QR code and link, pre-filled with the live tunnel address (read from cloudflared's local metrics port) and your `EVENT_CODE`, so you can put it straight on a slide.
- If the server restarts, attendees keep their link and sessions. If the tunnel restarts you get a new address, so re-share it.
- If the coach breaks for everyone, fall back to cards by hand: attendees fill the card boxes themselves and download, no AI needed.

*After the event*

1. Stop all three tabs with Ctrl+C. This closes the link.
2. Revoke or delete the API key in the Console, or check its spend.
3. Attendee data stays on this laptop in `data/`: coach transcripts in `data/event-claude/`, session bindings and spend in `data/event-state.json`, workbooks in `data/workbooks.db`. Export what you need and delete the rest.

Run `npm test` to run every test in the `test/` folder (9 files, 17 tests). `COACH_MODEL` overrides the attendee model (default `claude-sonnet-5-5`).

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
| `GET` | `/api/auth/openai/callback` | Sign in with ChatGPT callback. Locally also served at `/auth/callback`, the path OpenAI's open-source flow requires |
| `GET` | `/api/auth/me` | Current ChatGPT account and plan-usage status |
| `POST` | `/api/auth/logout` | Revoke the refresh token and end the session |
| `POST` | `/api/ai` | Run `{ task: "refine" \| "critique" \| "pitch", prompt }` on the user's ChatGPT plan |
| `POST` | `/api/export` | Render `{ format: "docx" \| "pdf", title, owner, data }` as a file |
| `POST` | `/api/coach` | Start or continue a coach session; streams server-sent events. Local owner (your Claude login) or event attendees (brain dump only); everyone else gets 404 |
| `POST` | `/api/coach/answer` | Answer a coach question card. Same access as `/api/coach` |
| `GET` | `/api/owner/workbooks` | List workbooks saved during an event (titles and times). Owner on `127.0.0.1` only; others get 404 |

In event mode, `POST /api/workbooks`, `PUT /api/workbooks/:id` and `POST /api/export` return 404 for visitors who don't have the event cookie (the owner is exempt). Reading a shared workbook with `GET` is unaffected.


### License

### Credit 


