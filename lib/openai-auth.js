import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './fields.js';

// Sign in with ChatGPT (OAuth 2.0 Authorization Code + PKCE + OpenID Connect).
// https://developers.openai.com/siwc/website
const ISSUER = process.env.OPENAI_ISSUER || 'https://auth.openai.com';
export const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const RESOURCE = 'https://api.openai.com/v1';

export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const IDENTITY_SCOPES = ['openid', 'profile', 'email'];
const PLAN_SCOPES = ['offline_access', 'resource.invoke', PLAN_SCOPE];

export function isConfigured() {
  return !!process.env.OPENAI_CLIENT_ID;
}

export function authConfig(request) {
  const clientId = process.env.OPENAI_CLIENT_ID;
  if (!clientId) throw new HttpError(503, 'Sign in with ChatGPT is not configured', 'not_configured');
  const redirectUri = process.env.OPENAI_REDIRECT_URI ||
    (process.env.VERCEL ? null : `${new URL(request.url).origin}/api/auth/openai/callback`);
  if (!redirectUri) throw new HttpError(503, 'OPENAI_REDIRECT_URI is not configured', 'not_configured');
  return {
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

export async function authorizationUrl(cfg, { state, codeChallenge, nonce }) {
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
    const err = new Error(`OpenAI token request failed: ${res.status} ${body.error || ''}`.trim());
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
