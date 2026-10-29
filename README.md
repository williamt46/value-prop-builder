# value-prop-builder

## Value Proposition Workbook 
### Inspired by Michael Skok's Workshop at Harvard Innovation Labs "Value Props: Create a Product People Will Actually Buy"

### Purpose
The Value Proposition Workbook is an interactive framework for your next MVP idea. Whether you're in the tech or healthcare industry, driving social change or revenue growth, scaling enterprise-level strategies or launching a lean startup, these foundational principles will help define, qualify, evaluate, measure, and build a product people actually want.


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

Open http://localhost:3000. Workbooks are stored in `data/workbooks.db`, a local SQLite file that git ignores.

**Deploy to Vercel**

Vercel's filesystem doesn't persist, so production uses [Turso](https://turso.tech), a hosted SQLite-compatible database (also on the Vercel Marketplace). Create a database, then set these project environment variables:

- `TURSO_DATABASE_URL`, e.g. `libsql://your-db.turso.io`
- `TURSO_AUTH_TOKEN`

The tables are created automatically on first request.

**Sign in with ChatGPT (AI features)**

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

Without `OPENAI_CLIENT_ID`, the site works normally and the AI buttons explain that sign-in isn't set up. OpenAI tokens stay on the server, encrypted, and the browser only holds an HttpOnly session cookie.

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


