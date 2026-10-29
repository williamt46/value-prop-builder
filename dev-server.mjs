// Local stand-in for Vercel: serves index.html and routes /api/* to the same
// Web-standard handlers Vercel runs. Usage: npm run dev
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT) || 3000;

const routes = [
  [/^\/api\/workbooks$/, () => import('./api/workbooks.js')],
  [/^\/api\/workbooks\/[^/]+$/, () => import('./api/workbooks/[id].js')],
  [/^\/api\/export$/, () => import('./api/export.js')],
  [/^\/api\/ai$/, () => import('./api/ai.js')],
  [/^\/api\/auth\/openai$/, () => import('./api/auth/openai.js')],
  [/^\/api\/auth\/openai\/callback$/, () => import('./api/auth/openai/callback.js')],
  [/^\/api\/auth\/me$/, () => import('./api/auth/me.js')],
  [/^\/api\/auth\/logout$/, () => import('./api/auth/logout.js')],
];

const vercel = JSON.parse(await readFile(new URL('./vercel.json', import.meta.url), 'utf8'));
const globalHeaders = vercel.headers.find((h) => h.source === '/(.*)')?.headers || [];

async function toRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
}

async function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer(async (req, res) => {
  for (const { key, value } of globalHeaders) res.setHeader(key, value);
  const { pathname } = new URL(req.url, 'http://localhost');

  const match = routes.find(([pattern]) => pattern.test(pathname));
  if (match) {
    const handler = (await match[1]())[req.method];
    if (!handler) return send(res, Response.json({ error: 'Method not allowed' }, { status: 405 }));
    return send(res, await handler(await toRequest(req)));
  }

  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await readFile(new URL('./index.html', import.meta.url)));
  }
  res.statusCode = 404;
  res.end('Not found');
}).listen(PORT, () => console.log(`Value Prop Builder running at http://localhost:${PORT}`));
