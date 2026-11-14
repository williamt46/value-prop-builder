// Local stand-in for Vercel: serves index.html and routes /api/* to the same
// Web-standard handlers Vercel runs. Usage: npm run dev
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT) || 3000;
// Loopback only by default: the server can hold a ChatGPT session. HOST=0.0.0.0 to expose it.
const HOST = process.env.HOST || '127.0.0.1';

const routes = [
  [/^\/api\/workbooks$/, () => import('./api/workbooks.js')],
  [/^\/api\/workbooks\/[^/]+$/, () => import('./api/workbooks/[id].js')],
  [/^\/api\/export$/, () => import('./api/export.js')],
  [/^\/api\/ai$/, () => import('./api/ai.js')],
  // Local-only coach (Claude Agent SDK on the owner's Claude Code login); streams SSE.
  [/^\/api\/coach$/, () => import('./api/coach.js')],
  [/^\/api\/coach\/answer$/, () => import('./api/coach/answer.js')],
  [/^\/api\/auth\/openai$/, () => import('./api/auth/openai.js')],
  [/^\/api\/auth\/openai\/callback$/, () => import('./api/auth/openai/callback.js')],
  // Local Sign in with ChatGPT: OpenAI's open-source flow requires this exact callback path.
  [/^\/auth\/callback$/, () => import('./api/auth/openai/callback.js')],
  [/^\/api\/auth\/me$/, () => import('./api/auth/me.js')],
  [/^\/api\/auth\/logout$/, () => import('./api/auth/logout.js')],
];

const vercel = JSON.parse(await readFile(new URL('./vercel.json', import.meta.url), 'utf8'));
const globalHeaders = vercel.headers.find((h) => h.source === '/(.*)')?.headers || [];

async function toRequest(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  // Abort request.signal when the client goes away, so streaming handlers can stop work.
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  return new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    signal: controller.signal,
  });
}

async function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  if (response.body && (response.headers.get('content-type') || '').startsWith('text/event-stream')) {
    // Server-sent events: write each chunk as it arrives instead of buffering the whole body.
    res.flushHeaders();
    const reader = response.body.getReader();
    res.on('close', () => reader.cancel().catch(() => {}));
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch {
      // Client disconnected or the stream errored; nothing more to send.
    }
    return res.end();
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer(async (req, res) => {
  // Local ChatGPT sign-in must run on 127.0.0.1, not localhost; keep the whole app on one origin.
  if (/^localhost(:|$)/i.test(req.headers.host || '')) {
    res.writeHead(302, { Location: `http://127.0.0.1:${PORT}${req.url}` });
    return res.end();
  }
  for (const { key, value } of globalHeaders) res.setHeader(key, value);
  const { pathname } = new URL(req.url, 'http://localhost');

  const match = routes.find(([pattern]) => pattern.test(pathname));
  if (match) {
    const handler = (await match[1]())[req.method];
    if (!handler) return send(res, Response.json({ error: 'Method not allowed' }, { status: 405 }));
    return send(res, await handler(await toRequest(req, res)));
  }

  // Local demo snapshots (docs/demo/<name>.html), e.g. /demo/vet-no-show restores a coach demo.
  const demo = /^\/demo\/([a-z0-9-]+)$/.exec(pathname);
  if (demo) {
    try {
      const page = await readFile(new URL(`./docs/demo/${demo[1]}.html`, import.meta.url));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(page);
    } catch {}
  }

  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await readFile(new URL('./index.html', import.meta.url)));
  }
  res.statusCode = 404;
  res.end('Not found');
}).listen(PORT, HOST, () => console.log(`CrashTest MVP running at http://127.0.0.1:${PORT}`));
