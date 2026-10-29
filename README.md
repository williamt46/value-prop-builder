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

**API**

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/workbooks` | Create a workbook; returns `{ id, editToken }` |
| `GET` | `/api/workbooks/:id` | Read a shared workbook (owner email is never returned) |
| `PUT` | `/api/workbooks/:id` | Update a workbook; requires `Authorization: Bearer <editToken>` |
| `POST` | `/api/export` | Render `{ format: "docx" \| "pdf", title, owner, data }` as a file |


### License

### Credit 


