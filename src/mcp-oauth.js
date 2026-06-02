// src/mcp-oauth.js
// MCP OAuth 2.1 server for claude.ai custom-connector compatibility.
// Created June 2 2026 (PM-14) — Tier 1 Phase 2 (claude.ai surface unblock).
//
// Background: PM-13 shipped Tier 1 MCP with bearer-token auth (FIELD_MCP_SECRET).
// claude.ai's custom-connector UI is OAuth-only and requires successful OAuth
// discovery before populating tools into the chat tool surface. Without
// /.well-known/oauth-authorization-server, DCR silently fails and tool
// registration never starts.
//
// This module adds the OAuth 2.1 + PKCE + DCR surface so claude.ai's MCP client
// completes its discovery handshake. Bearer-token auth on /mcp remains as a
// fallback for CI probes; OAuth bearer tokens minted by /oauth/token are
// accepted equally.
//
// Storage: env.MCP_OAUTH KV namespace. Keys:
//   client:{id}    DCR-registered client { client_secret, redirect_uris, ... }  TTL 90d
//   code:{code}    Pending authorization code (PKCE-bound)                       TTL 5min
//   token:{tok}    Access token { client_id, scope }                             TTL 1h
//   refresh:{rt}   Refresh token { client_id, scope }                            TTL 90d
//   log:{ts}-{n}   Request log entry (diagnostic, sanitized)                     TTL 1h
//
// User auth backend: shared-password page. Password = env.FIELD_MCP_SECRET.
// Single-user pattern. Blast radius is HANDOFF read/write + get_head_sha.
// OAuth ceremony provides MCP-spec compliance, per-client revocable tokens,
// and 1-hour token rotation.

const TTL_CODE = 300;          // 5 min
const TTL_TOKEN = 3600;        // 1 hour
const TTL_REFRESH = 7776000;   // 90 days
const TTL_CLIENT = 7776000;    // 90 days
const TTL_LOG = 3600;          // 1 hour

// ── Helpers ──────────────────────────────────────────────────────────────────
function rand(bytes = 32) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

function b64url(buf) {
    const bin = String.fromCharCode(...new Uint8Array(buf));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input) {
    const enc = new TextEncoder().encode(input);
    return await crypto.subtle.digest('SHA-256', enc);
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

function json(data, status = 200, extra = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json', ...extra },
    });
}

function html(body, status = 200) {
    return new Response(body, {
        status,
        headers: { ...corsHeaders(), 'Content-Type': 'text/html; charset=utf-8' },
    });
}

// ── Request log — never throws (best-effort diagnostic) ─────────────────────
// claude.ai's actual request shape isn't well-documented; logging lets us
// retroactively see what hit the worker without needing live wrangler tail.
export async function logRequest(env, request, label) {
    try {
        if (!env.MCP_OAUTH) return;
        const url = new URL(request.url);
        const ts = new Date().toISOString();
        const nonce = rand(4);
        const entry = {
            ts, label,
            method: request.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            headers: Object.fromEntries(
                [...request.headers.entries()].filter(
                    ([k]) => !/^(cookie|x-real-ip|cf-)/i.test(k)
                )
            ),
        };
        await env.MCP_OAUTH.put(
            `log:${ts}-${nonce}`,
            JSON.stringify(entry),
            { expirationTtl: TTL_LOG }
        );
    } catch (e) { /* never let logging fail the request */ }
}

// ── GET /.well-known/oauth-authorization-server (RFC 8414) ──────────────────
export function authServerMetadata(origin) {
    return json({
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        revocation_endpoint: `${origin}/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        scopes_supported: ['mcp'],
    });
}

// ── GET /.well-known/oauth-protected-resource (RFC 9728) ────────────────────
export function protectedResourceMetadata(origin) {
    return json({
        resource: origin,
        authorization_servers: [origin],
        scopes_supported: ['mcp'],
        bearer_methods_supported: ['header'],
    });
}

// ── POST /oauth/register — Dynamic Client Registration (RFC 7591) ───────────
export async function register(request, env) {
    let body = {};
    try { body = await request.json(); } catch (e) {
        return json({ error: 'invalid_request', error_description: 'Body must be JSON' }, 400);
    }
    const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (redirect_uris.length === 0) {
        return json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' }, 400);
    }
    for (const uri of redirect_uris) {
        try {
            const u = new URL(uri);
            if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
                return json({ error: 'invalid_redirect_uri', error_description: `Non-HTTPS redirect_uri: ${uri}` }, 400);
            }
        } catch (e) {
            return json({ error: 'invalid_redirect_uri', error_description: `Malformed URI: ${uri}` }, 400);
        }
    }

    const client_id = rand(16);
    const client_secret = rand(32);
    const issued_at = Math.floor(Date.now() / 1000);

    const record = {
        client_id, client_secret,
        redirect_uris,
        client_name: body.client_name || 'unnamed',
        grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
        response_types: body.response_types || ['code'],
        token_endpoint_auth_method: body.token_endpoint_auth_method || 'client_secret_post',
        issued_at,
    };

    await env.MCP_OAUTH.put(`client:${client_id}`, JSON.stringify(record), { expirationTtl: TTL_CLIENT });

    return json({
        ...record,
        client_id_issued_at: issued_at,
        client_secret_expires_at: 0,  // RFC 7591: 0 means never expires
    }, 201);
}

// ── GET /oauth/authorize — render password prompt ───────────────────────────
export async function authorizeGet(url, env) {
    const params = url.searchParams;
    const response_type = params.get('response_type');
    const client_id = params.get('client_id');
    const redirect_uri = params.get('redirect_uri');
    const state = params.get('state') || '';
    const scope = params.get('scope') || 'mcp';
    const code_challenge = params.get('code_challenge');
    const code_challenge_method = params.get('code_challenge_method') || 'plain';

    if (response_type !== 'code') {
        return html(errorPage('unsupported_response_type', 'Only response_type=code is supported'), 400);
    }
    if (!client_id) return html(errorPage('invalid_request', 'client_id is required'), 400);
    if (!redirect_uri) return html(errorPage('invalid_request', 'redirect_uri is required'), 400);
    if (!code_challenge) return html(errorPage('invalid_request', 'code_challenge is required (PKCE)'), 400);
    if (code_challenge_method !== 'S256') {
        return html(errorPage('invalid_request', 'code_challenge_method must be S256'), 400);
    }

    const clientRaw = await env.MCP_OAUTH.get(`client:${client_id}`);
    if (!clientRaw) return html(errorPage('invalid_client', `Unknown client_id: ${client_id}`), 400);
    const client = JSON.parse(clientRaw);
    if (!client.redirect_uris.includes(redirect_uri)) {
        return html(errorPage('invalid_redirect_uri', 'redirect_uri not registered for this client'), 400);
    }

    return html(passwordPage({
        client_name: client.client_name,
        client_id, redirect_uri, state, scope,
        code_challenge, code_challenge_method,
    }));
}

// ── POST /oauth/authorize — verify password, mint code, redirect ───────────
export async function authorizePost(request, env) {
    const form = await request.formData();
    const password = form.get('password');
    const client_id = form.get('client_id');
    const redirect_uri = form.get('redirect_uri');
    const state = form.get('state') || '';
    const scope = form.get('scope') || 'mcp';
    const code_challenge = form.get('code_challenge');
    const code_challenge_method = form.get('code_challenge_method');

    if (!password || password !== env.FIELD_MCP_SECRET) {
        const clientRaw = await env.MCP_OAUTH.get(`client:${client_id}`);
        if (!clientRaw) return html(errorPage('invalid_client', 'Unknown client'), 400);
        const client = JSON.parse(clientRaw);
        return html(passwordPage({
            client_name: client.client_name,
            client_id, redirect_uri, state, scope,
            code_challenge, code_challenge_method,
            error: 'Incorrect password',
        }), 401);
    }

    const clientRaw = await env.MCP_OAUTH.get(`client:${client_id}`);
    if (!clientRaw) return html(errorPage('invalid_client', 'Unknown client'), 400);
    const client = JSON.parse(clientRaw);
    if (!client.redirect_uris.includes(redirect_uri)) {
        return html(errorPage('invalid_redirect_uri', 'redirect_uri changed'), 400);
    }

    const code = rand(32);
    await env.MCP_OAUTH.put(`code:${code}`, JSON.stringify({
        client_id, redirect_uri, scope,
        code_challenge, code_challenge_method,
        expires_at: Math.floor(Date.now() / 1000) + TTL_CODE,
    }), { expirationTtl: TTL_CODE });

    const redirect = new URL(redirect_uri);
    redirect.searchParams.set('code', code);
    if (state) redirect.searchParams.set('state', state);
    return new Response(null, {
        status: 302,
        headers: { ...corsHeaders(), 'Location': redirect.toString() },
    });
}

// ── POST /oauth/token — exchange code or refresh for access_token ──────────
export async function token(request, env) {
    const form = await request.formData();
    const grant_type = form.get('grant_type');

    if (grant_type === 'authorization_code') {
        const code = form.get('code');
        const redirect_uri = form.get('redirect_uri');
        const client_id = form.get('client_id');
        const code_verifier = form.get('code_verifier');

        if (!code) return json({ error: 'invalid_request', error_description: 'code required' }, 400);
        if (!code_verifier) return json({ error: 'invalid_request', error_description: 'code_verifier required (PKCE)' }, 400);

        const codeRaw = await env.MCP_OAUTH.get(`code:${code}`);
        if (!codeRaw) return json({ error: 'invalid_grant', error_description: 'Code expired or invalid' }, 400);
        const codeData = JSON.parse(codeRaw);

        if (client_id && client_id !== codeData.client_id) {
            return json({ error: 'invalid_client' }, 400);
        }
        if (redirect_uri !== codeData.redirect_uri) {
            return json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
        }

        // PKCE verification: base64url(SHA256(verifier)) === stored challenge
        const verifierHash = b64url(await sha256(code_verifier));
        if (verifierHash !== codeData.code_challenge) {
            return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
        }

        // One-time use: delete the code
        await env.MCP_OAUTH.delete(`code:${code}`);

        const access_token = rand(32);
        const refresh_token = rand(32);
        await env.MCP_OAUTH.put(`token:${access_token}`, JSON.stringify({
            client_id: codeData.client_id, scope: codeData.scope,
        }), { expirationTtl: TTL_TOKEN });
        await env.MCP_OAUTH.put(`refresh:${refresh_token}`, JSON.stringify({
            client_id: codeData.client_id, scope: codeData.scope,
        }), { expirationTtl: TTL_REFRESH });

        return json({
            access_token, token_type: 'Bearer', expires_in: TTL_TOKEN,
            refresh_token, scope: codeData.scope,
        });
    }

    if (grant_type === 'refresh_token') {
        const rt = form.get('refresh_token');
        if (!rt) return json({ error: 'invalid_request', error_description: 'refresh_token required' }, 400);
        const rtRaw = await env.MCP_OAUTH.get(`refresh:${rt}`);
        if (!rtRaw) return json({ error: 'invalid_grant', error_description: 'Refresh token expired or invalid' }, 400);
        const rtData = JSON.parse(rtRaw);

        const access_token = rand(32);
        await env.MCP_OAUTH.put(`token:${access_token}`, JSON.stringify({
            client_id: rtData.client_id, scope: rtData.scope,
        }), { expirationTtl: TTL_TOKEN });

        return json({
            access_token, token_type: 'Bearer', expires_in: TTL_TOKEN,
            scope: rtData.scope,
        });
    }

    return json({ error: 'unsupported_grant_type' }, 400);
}

// ── POST /oauth/revoke — token revocation (RFC 7009) ────────────────────────
export async function revoke(request, env) {
    const form = await request.formData();
    const tok = form.get('token');
    if (!tok) return json({}, 200);
    await env.MCP_OAUTH.delete(`token:${tok}`);
    await env.MCP_OAUTH.delete(`refresh:${tok}`);
    return json({}, 200);
}

// ── Bearer validation — used by /mcp auth gate ──────────────────────────────
// Returns { valid: true, client_id, scope } if Authorization header carries a
// valid OAuth access token. Returns { valid: false } otherwise (caller falls
// back to FIELD_MCP_SECRET check for legacy/CI clients).
export async function validateBearer(authHeader, env) {
    if (!authHeader) return { valid: false };
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) return { valid: false };
    const tok = m[1].trim();
    if (!env.MCP_OAUTH) return { valid: false };
    const raw = await env.MCP_OAUTH.get(`token:${tok}`);
    if (!raw) return { valid: false };
    try {
        const data = JSON.parse(raw);
        return { valid: true, client_id: data.client_id, scope: data.scope };
    } catch (e) { return { valid: false }; }
}

// ── GET /debug/recent-requests — read request log (FIELD_MCP_SECRET-gated) ──
// Diagnostic endpoint to see what claude.ai actually sent to the worker.
export async function debugRecentRequests(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const tok = auth.replace(/^Bearer\s+/i, '');
    if (tok !== env.FIELD_MCP_SECRET) return json({ error: 'Unauthorized' }, 401);

    const list = await env.MCP_OAUTH.list({ prefix: 'log:', limit: 200 });
    const entries = [];
    for (const k of list.keys) {
        const v = await env.MCP_OAUTH.get(k.name);
        if (v) {
            try { entries.push(JSON.parse(v)); } catch (e) { /* skip */ }
        }
    }
    entries.sort((a, b) => (a.ts > b.ts ? -1 : 1));
    return json({ count: entries.length, entries });
}

// ── HTML templates ──────────────────────────────────────────────────────────
function passwordPage({ client_name, client_id, redirect_uri, state, scope, code_challenge, code_challenge_method, error }) {
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>FIELD Handoff — Authorize</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
         max-width: 480px; margin: 80px auto; padding: 0 24px;
         background: #0a0a0a; color: #e0e0e0; }
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
  p.sub { color: #888; font-size: 14px; margin-top: 0; }
  .client { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px;
            padding: 16px; margin: 24px 0; font-size: 14px; }
  .client b { color: #fff; }
  .meta { margin-top: 8px; color: #666; font-size: 12px; word-break: break-all; }
  label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; }
  input[type=password] { width: 100%; padding: 10px 12px; box-sizing: border-box;
                         background: #1a1a1a; color: #fff; border: 1px solid #2a2a2a;
                         border-radius: 6px; font-size: 15px; font-family: inherit; }
  button { background: #2a5cf0; color: #fff; border: 0; padding: 10px 20px;
           border-radius: 6px; font-size: 14px; font-weight: 500;
           margin-top: 16px; cursor: pointer; }
  button:hover { background: #1e4ee0; }
  .error { color: #ff6464; font-size: 13px; margin-top: 8px; }
</style></head><body>
<h1>FIELD Handoff</h1>
<p class="sub">Authorize MCP client access</p>
<div class="client">
  <div><b>${esc(client_name)}</b> requests <code>${esc(scope)}</code> scope.</div>
  <div class="meta">redirect_uri: ${esc(redirect_uri)}</div>
</div>
<form method="POST" action="/oauth/authorize">
  <label for="password">Password</label>
  <input type="password" id="password" name="password" autofocus required>
  ${error ? `<div class="error">${esc(error)}</div>` : ''}
  <input type="hidden" name="client_id" value="${esc(client_id)}">
  <input type="hidden" name="redirect_uri" value="${esc(redirect_uri)}">
  <input type="hidden" name="state" value="${esc(state)}">
  <input type="hidden" name="scope" value="${esc(scope)}">
  <input type="hidden" name="code_challenge" value="${esc(code_challenge)}">
  <input type="hidden" name="code_challenge_method" value="${esc(code_challenge_method)}">
  <button type="submit">Authorize</button>
</form>
</body></html>`;
}

function errorPage(error, description) {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:80px auto;padding:0 20px;background:#0a0a0a;color:#e0e0e0">
<h2 style="color:#ff6464">OAuth Error: ${error}</h2><p>${description}</p></body></html>`;
}
