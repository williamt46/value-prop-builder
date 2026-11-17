// Local stand-in for Vercel: serves index.html and routes /api/* to the same
// Web-standard handlers Vercel runs. Usage: npm run dev
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { attendeeCookie, codeMatches, eventEnabled, isOwner, tagRequest } from './lib/event.js';

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
  // Owner-only list of saved event workbooks (127.0.0.1 only, see lib/event.js isOwner).
  [/^\/api\/owner\/workbooks$/, () => import('./api/owner/workbooks.js')],
];

const MAX_BODY = 1024 * 1024;
// A Host we can safely build a URL from: name or IPv4 with an optional port, or [IPv6]:port.
const VALID_HOST = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

class ClientError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A bad request or a bug in one handler must never take the server down for every attendee.
process.on('unhandledRejection', (err) => console.error('unhandled rejection', err));
process.on('uncaughtException', (err) => console.error('uncaught exception', err));

const vercel = JSON.parse(await readFile(new URL('./vercel.json', import.meta.url), 'utf8'));
const globalHeaders = vercel.headers.find((h) => h.source === '/(.*)')?.headers || [];

async function toRequest(req, res) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new ClientError(413, 'Request is too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ClientError(413, 'Request is too large');
    chunks.push(chunk);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  // Abort request.signal when the client goes away, so streaming handlers can stop work.
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  // Behind an HTTPS tunnel the browser's Origin is https://; build the URL to match so the
  // same-origin check passes. A forged header only changes that comparison.
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const request = new Request(`${proto}://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    signal: controller.signal,
  });
  tagRequest(request, req.socket.remoteAddress);
  return request;
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

async function handle(req, res) {
  if (!VALID_HOST.test(req.headers.host || '')) throw new ClientError(400, 'Bad Host header');
  // Local ChatGPT sign-in must run on 127.0.0.1, not localhost; keep the whole app on one origin.
  if (/^localhost(:|$)/i.test(req.headers.host || '')) {
    res.writeHead(302, { Location: `http://127.0.0.1:${PORT}${req.url}` });
    return res.end();
  }
  for (const { key, value } of globalHeaders) res.setHeader(key, value);
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

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

  // Owner page: saved event workbooks. Only on 127.0.0.1 from this laptop.
  if (pathname === '/owner') {
    const request = await toRequest(req, res);
    if (!isOwner(request)) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await readFile(new URL('./lib/owner.html', import.meta.url)));
  }
  // QR library for the owner page (lib/vendor/qrcode.js, MIT). Owner only.
  if (pathname === '/owner/qrcode.js') {
    const request = await toRequest(req, res);
    if (!isOwner(request)) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    return res.end(await readFile(new URL('./lib/vendor/qrcode.js', import.meta.url)));
  }

  if (pathname === '/' || pathname === '/index.html') {
    // Event link: /?e=<code> is exchanged once for an attendee cookie, then the code leaves the URL.
    const code = url.searchParams.get('e');
    if (code !== null && eventEnabled() && codeMatches(code)) {
      const request = await toRequest(req, res);
      url.searchParams.delete('e');
      res.writeHead(302, {
        Location: url.pathname + (url.search || ''),
        'Set-Cookie': attendeeCookie(request),
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await readFile(new URL('./index.html', import.meta.url)));
  }
  res.statusCode = 404;
  res.end('Not found');
}

http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    const status = err instanceof ClientError ? err.status : 500;
    if (status === 500) console.error('request failed', err);
    if (res.headersSent) return res.end();
    res.writeHead(status, { 'Content-Type': 'application/json', Connection: status === 413 ? 'close' : 'keep-alive' });
    res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong. Please try again.' : err.message }));
  }
}).listen(PORT, HOST, () => {
  console.log(`CrashTest MVP running at http://127.0.0.1:${PORT}`);
  if (eventEnabled()) console.log('Event mode ON: attendees open /?e=<code>. Owner page: http://127.0.0.1:' + PORT + '/owner');
});
