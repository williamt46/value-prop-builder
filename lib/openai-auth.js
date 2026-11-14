import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './fields.js';

// Sign in with ChatGPT (OAuth 2.0 Authorization Code + PKCE + OpenID Connect), in two modes:
// - hosted: a partner client ID issued by OpenAI (waitlisted). https://developers.openai.com/siwc/website
// - local:  OpenAI's open-source flow for apps a user runs on their own machine. Each ChatGPT
//           account registers its own client on first sign-in; no client ID or secret needed.
//           https://developers.openai.com/siwc/token-sharing-open-source
const ISSUER = process.env.OPENAI_ISSUER || 'https://auth.openai.com';
export const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const RESOURCE = 'https://api.openai.com/v1';

export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const IDENTITY_SCOPES = ['openid', 'profile', 'email'];
const PLAN_SCOPES = ['offline_access', 'resource.invoke', PLAN_SCOPE];

export const DYNAMIC_CLIENT = 'dynamic_agent_client';
const AGENT_NAME = 'CrashTest MVP';

// Local mode needs the browser on http://127.0.0.1 (the docs disallow "localhost"), which the
// dev server enforces by redirecting localhost there.
export function signInMode(request) {
  if (process.env.OPENAI_CLIENT_ID) return 'hosted';
  if (process.env.VERCEL || process.env.OPENAI_LOCAL_SIGNIN === 'false') return null;
  return new URL(request.url).hostname === '127.0.0.1' ? 'local' : null;
}

export function isConfigured(request) {
  return !!signInMode(request);
}

// Stable opaque ID for this machine's install, created once (ext_agent_host_id).
let hostId;
export function localHostId() {
  if (!hostId) {
    mkdirSync('data', { recursive: true });
    try {
      hostId = readFileSync('data/.agent-host-id', 'utf8').trim();
    } catch {
      hostId = `urn:uuid:${randomUUID()}`;
      writeFileSync('data/.agent-host-id', hostId, { mode: 0o600 });
    }
  }
  return hostId;
}

export function authConfig(request) {
  const mode = signInMode(request);
  if (!mode) throw new HttpError(503, 'Sign in with ChatGPT is not configured', 'not_configured');
  if (mode === 'local') {
    return {
      mode,
      clientId: DYNAMIC_CLIENT,
      clientSecret: '',
      // The open-source flow requires exactly this loopback path; only the port may vary.
      redirectUri: `${new URL(request.url).origin}/auth/callback`,
      planUsage: true,
    };
  }
  const clientId = process.env.OPENAI_CLIENT_ID;
  const redirectUri = process.env.OPENAI_REDIRECT_URI ||
    (process.env.VERCEL ? null : `${new URL(request.url).origin}/api/auth/openai/callback`);
  if (!redirectUri) throw new HttpError(503, 'OPENAI_REDIRECT_URI is not configured', 'not_configured');
  return {
    mode,
    clientId,
    clientSecret: process.env.OPENAI_CLIENT_SECRET || '',
    redirectUri,
    // Only request plan-usage scopes once OpenAI has approved this client for them.
    planUsage: process.env.OPENAI_PLAN_USAGE === 'true',
  };
}

let discovery;
let jwks;

async function getDiscovery() {
  if (!discovery) {
    const res = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`OpenID discovery failed: ${res.status}`);
    const doc = await res.json();
    for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
      if (typeof doc[key] !== 'string') throw new Error(`OpenID discovery missing ${key}`);
    }
    discovery = doc;
    jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
  }
  return discovery;
}

// cfg.clientId is the issued client for this attempt (DYNAMIC_CLIENT on a first local sign-in).
export async function authorizationUrl(cfg, { state, codeChallenge, nonce, loginHint, consent }) {
  const { authorization_endpoint } = await getDiscovery();
  const url = new URL(authorization_endpoint);
  const params = {
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: [...IDENTITY_SCOPES, ...(cfg.planUsage ? PLAN_SCOPES : [])].join(' '),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  };
  if (cfg.planUsage) params.resource = RESOURCE;
  if (cfg.mode === 'local') {
    params.ext_agent_host_id = localHostId();
    if (cfg.clientId === DYNAMIC_CLIENT) params.agent_name_hint = AGENT_NAME;
  }
  if (loginHint) params.login_hint = loginHint;
  // Re-asking for plan usage after a decline; never on ordinary sign-ins.
  if (consent) params.prompt = 'consent';
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

async function tokenRequest(cfg, params) {
  const { token_endpoint } = await getDiscovery();
  const headers = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' };
  if (cfg.clientSecret) {
    const enc = (v) => new URLSearchParams({ v }).toString().slice(2);
    headers.authorization = `Basic ${Buffer.from(`${enc(cfg.clientId)}:${enc(cfg.clientSecret)}`).toString('base64')}`;
  }
  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ client_id: cfg.clientId, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // OAuth error descriptions carry no secrets; the request ID lets OpenAI trace the failure.
    const requestId = res.headers.get('openai-request-id') || res.headers.get('x-request-id') || '';
    const detail = [body.error || body.code, body.error_description || body.detail || body.message]
      .filter(Boolean).join(': ');
    const err = new Error(`OpenAI token request failed: ${res.status} ${detail}${requestId ? ` (request ${requestId})` : ''}`.trim());
    err.oauthError = body.error || body.code || '';
    throw err;
  }
  return body;
}

export function exchangeCode(cfg, { code, codeVerifier }) {
  return tokenRequest(cfg, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
    ...(cfg.planUsage ? { resource: RESOURCE } : {}),
  });
}

export function refreshTokens(cfg, refreshToken) {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken, resource: RESOURCE });
}

// Best effort: revoke the renewable session on sign-out.
export async function revokeRefreshToken(cfg, refreshToken) {
  const { revocation_endpoint } = await getDiscovery();
  if (!revocation_endpoint) return false;
  const res = await fetch(revocation_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: cfg.clientId }),
  });
  return res.ok;
}

export async function verifyIdToken(cfg, idToken, expectedNonce) {
  const { issuer } = await getDiscovery();
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience: cfg.clientId,
    requiredClaims: ['sub', 'exp', 'iat'],
    clockTolerance: 5,
  });
  if (payload.nonce !== expectedNonce) throw new Error('ID token nonce mismatch');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('ID token missing subject');
  return payload;
}
