import { mkdirSync } from 'node:fs';
import { createClient } from '@libsql/client';

// SQLite via libSQL. Locally this is a file under data/; in production set
// TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (Vercel's filesystem is not persistent).
const LOCAL_URL = 'file:data/workbooks.db';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workbooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    edit_token_hash TEXT NOT NULL,
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS workbooks_user_id ON workbooks(user_id)',
  // One-time Sign in with ChatGPT attempts (state, PKCE verifier, nonce).
  `CREATE TABLE IF NOT EXISTS auth_transactions (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    return_to TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // App sessions; OpenAI tokens are encrypted at rest and never sent to the browser.
  `CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    client_id TEXT NOT NULL,
    sid TEXT,
    scopes TEXT NOT NULL,
    tokens TEXT,
    access_expires_at INTEGER,
    model TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
];

let client;
let ready;

export async function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url && process.env.VERCEL) {
      throw new Error('TURSO_DATABASE_URL is not configured');
    }
    if (!url) mkdirSync('data', { recursive: true });
    client = createClient({ url: url || LOCAL_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  ready ??= client.batch(SCHEMA, 'write');
  await ready;
  return client;
}
