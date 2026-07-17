// field-claude-proxy — Cloudflare Worker v4
// Source of truth: workers/field-claude-proxy/src/index.js
// Auto-deployed via .github/workflows/deploy-proxy.yml on push to workers/**
//
// CHANGES IN v4:
//   Model: gemini-3.1-flash-lite → gemini-3.1-flash-lite (faster, better quality; 2.5 EOL Jun 2026)
//   429 handling: forward Retry-After to client instead of throwing 502
//   ALLOWED_ORIGINS: added jubilant-bassoon.pages.dev
//   X-FIELD-Proxy-Version: 5 header on all responses
//   max_tokens default: 1000 → 2500 (supports compound editorial call)
//
// SECRETS (set once in Cloudflare dashboard, persist across deploys):
//   GEMINI_KEY    → aistudio.google.com → Get API key (free, 1500 RPD / 30 RPM)
//   ANTHROPIC_KEY → console.anthropic.com → API Keys (optional Claude fallback)
//
// VERIFY after deploy (DevTools Network tab on FIELD app):
//   X-FIELD-Proxy-Version: 4
//   X-FIELD-Model: gemini-3.1-flash-lite  (or claude-sonnet-4 on fallback)

const PROXY_VERSION = '8';

const ALLOWED_ORIGINS = [
  'https://jubilant-bassoon.jeffunglesbee.workers.dev',
  'https://jubilant-bassoon.pages.dev',
  'https://field-deploy.jeffunglesbee.workers.dev', // Courier /layer2 vision requests
];

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

const version = () => ({'X-FIELD-Proxy-Version': PROXY_VERSION});

function toGemini(body, modelUsed) {
  const sys = body.system ? body.system + '\n\n' : '';
  const msg = body.messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : m.content?.[0]?.text || '')
    .join('\n');
  const generationConfig = { maxOutputTokens: body.max_tokens || 2500, temperature: 0.4 };
  // CC-CMD-2026-07-16-gemini-model-comparison: gemini-3.5-flash has
  // "thinking" enabled by default (thinking_level: medium), and thinking
  // tokens are counted against maxOutputTokens -- confirmed real via this
  // dispatch's own sanity check (empty text at max_tokens:50, then a full
  // 5-min client-side HeadersTimeoutError hang at max_tokens:300, neither
  // ever producing visible output) and independently confirmed against
  // Google's own current docs. gemini-3.1-flash-lite (the production
  // default) has no such default-on thinking, so leaving this unset would
  // make the comparison mostly measure "did thinking exhaust the budget",
  // not prose quality. Scoped ONLY to the explicit gemini-3.5-flash test
  // override -- the production default model is never affected.
  if (modelUsed === 'gemini-3.5-flash') {
    generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
  }
  return {
    systemInstruction: {
      parts: [{
        text: 'You are a sports intelligence editor. Always write complete, well-formed sentences. Never stop mid-sentence. Be concise and factual. When asked to return JSON, return ONLY valid JSON with no markdown, no backticks, and no preamble.'
      }]
    },
    contents: [{ parts: [{ text: sys + msg }] }],
    generationConfig,
  };
}

function fromGemini(data, modelUsed) {
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const um = data.usageMetadata || {};
  return JSON.stringify({
    id: 'gemini-proxy', type: 'message', role: 'assistant',
    model: modelUsed,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    // Real usageMetadata from Gemini's own response, not hardcoded zeros --
    // CC-CMD-2026-07-16-gemini-model-comparison TASK 0/1 needs real token
    // counts, which this proxy previously discarded entirely. Additive
    // field, same envelope shape production callers already parse
    // (content[0].text) -- no existing consumer reads usage today.
    // thoughtsTokenCount (thinking-mode models only) is real, billed output
    // tokens the caller can't see in `text` -- folded into output_tokens so
    // the real cost isn't undercounted, not left as a separate untracked field.
    usage: {
      input_tokens: um.promptTokenCount || 0,
      output_tokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
    },
  });
}

// ── Cloudflare AI Gateway routing (May 31 2026) ─────────────────────────────
// When env.CF_AI_GATEWAY_BASE is set (e.g. "https://gateway.ai.cloudflare.com/
// v1/{account-id}/{gateway-id}"), all upstream calls route through the gateway.
// AI Gateway provides:
//   - Semantic caching (20-40% savings on repeated/similar prompts)
//   - Request/response logging (observability)
//   - Rate-limit visibility
//   - Cost reporting per provider
// Without the env var, the proxy routes directly to upstream APIs (today's
// behavior). To enable: create gateway in CF dashboard, then
//   echo "https://gateway.ai.cloudflare.com/v1/<acct>/<gw>" \
//     | wrangler secret put CF_AI_GATEWAY_BASE --name field-claude-proxy
// Provider path segments per Cloudflare docs:
//   Google AI Studio: /google-ai-studio
//   Anthropic:        /anthropic
//
// AUTHENTICATED GATEWAY (May 31 2026, post-init):
// When env.CF_AIG_TOKEN is set, requests include cf-aig-authorization: Bearer <token>.
// Required when the gateway has "Authenticated Gateway" turned on in the dashboard
// (recommended — prevents URL leaks from being exploited to dump logs/cache).
// Token is created in dashboard → AI Gateway → field-journalism → Settings →
// "Create authentication token" with scope: Account / AI Gateway / Run.
// Without CF_AIG_TOKEN, no header is sent — works for unauthenticated gateways
// or direct (non-gateway) routing.
// CC-CMD-2026-07-16-gemini-model-comparison TASK 0: explicit, opt-in model
// override for a real head-to-head test -- same pattern as the existing
// X-FIELD-Force-Claude header below (explicit override via header, default
// untouched for every caller that doesn't send it). Allowlisted to the two
// models this specific test compares, not an arbitrary pass-through, so
// this can't become a way to invoke an unintended/more-expensive model
// under FIELD's API key. Any caller not sending X-FIELD-Test-Model gets the
// exact same 'gemini-3.1-flash-lite' default as before this change --
// zero production behavior change.
const ALLOWED_TEST_MODELS = new Set(['gemini-3.1-flash-lite', 'gemini-3.5-flash']);
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

function geminiUrl(env, key, modelOverride) {
  const model = (modelOverride && ALLOWED_TEST_MODELS.has(modelOverride)) ? modelOverride : DEFAULT_GEMINI_MODEL;
  const path = `/v1beta/models/${model}:generateContent?key=${key}`;
  return env.CF_AI_GATEWAY_BASE
    ? `${env.CF_AI_GATEWAY_BASE}/google-ai-studio${path}`
    : `https://generativelanguage.googleapis.com${path}`;
}
function anthropicUrl(env) {
  return env.CF_AI_GATEWAY_BASE
    ? `${env.CF_AI_GATEWAY_BASE}/anthropic/v1/messages`
    : 'https://api.anthropic.com/v1/messages';
}
function aigAuthHeaders(env) {
  return env.CF_AIG_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}` } : {};
}

async function callGemini(body, key, env, modelOverride) {
  const modelUsed = (modelOverride && ALLOWED_TEST_MODELS.has(modelOverride)) ? modelOverride : DEFAULT_GEMINI_MODEL;
  const url = geminiUrl(env, key, modelOverride);
  const t0 = Date.now();
  // CC-CMD-2026-07-16-gemini-model-comparison: a real sanity-check call to
  // gemini-3.5-flash hung with no response at all (client-side
  // HeadersTimeoutError after 5 min) before the thinkingConfig fix above --
  // add a real, generous timeout so a genuine upstream hang can never tie
  // up this Worker indefinitely. 60s is well above gemini-3.1-flash-lite's
  // real observed latency (sub-second to ~1s) so this changes nothing for
  // production traffic; it only bounds a failure mode that was just proven
  // real.
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...aigAuthHeaders(env) },
    body: JSON.stringify(toGemini(body, modelUsed)),
    signal: AbortSignal.timeout(60000),
  });
  const ms = Date.now() - t0;
  if (r.status === 429) {
    const retryAfter = r.headers.get('Retry-After') || '60';
    throw {is429: true, retryAfter, detail: (await r.text().catch(() => '')).slice(0, 200)};
  }
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { text: fromGemini(await r.json(), modelUsed), model: modelUsed, status: 200, ms };
}

async function callClaude(raw, key, env) {
  const r = await fetch(anthropicUrl(env), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      ...aigAuthHeaders(env),
    },
    body: raw,
  });
  return { text: await r.text(), model: 'claude-sonnet-4', status: r.status };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
      return new Response(null, { status: 204, headers: {...cors(origin), ...version()} });
    }

    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405, headers: version() });

    // Server-to-server bypass: the journalism cron (field-relay-nba Worker) calls
    // this proxy with no Origin header (Workers don't send one). Allow it via a
    // shared header instead of Origin. Browsers can't set this cross-origin without
    // a preflight that would fail, so it can't be spoofed from the web.
    const relayAuth = request.headers.get('X-FIELD-Relay') || '';
    const isRelay = relayAuth === (env.RELAY_SHARED_SECRET || 'field-relay-cron-2026');
    if (!isRelay && !ALLOWED_ORIGINS.includes(origin))
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403, headers: { 'Content-Type': 'application/json', ...version() },
      });

    const gKey = env.GEMINI_KEY || '';
    const aKey = env.ANTHROPIC_KEY || '';

    if (!gKey && !aKey)
      return new Response(JSON.stringify({ error: 'No AI backend configured.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...cors(origin), ...version() } });

    const raw = await request.text().catch(() => null);
    if (!raw) return new Response(JSON.stringify({ error: 'Empty body' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin), ...version() },
    });

    // Vision requests (contain image content) must use Claude — Gemini adapter strips images
    // Force-Claude header: server-to-server callers (STAT apply agent, Courier) can force
    // Claude routing for complex multi-turn/tool-use conversations that Gemini can't handle
    let bodyParsed; try { bodyParsed = JSON.parse(raw); } catch { bodyParsed = null; }
    const hasVision = bodyParsed?.messages?.some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image')
    );
    const forceClaude = request.headers.get('X-FIELD-Force-Claude') === 'true';
    const testModel = request.headers.get('X-FIELD-Test-Model') || null;

    let result;
    let geminiFallbackError = null;

    if (gKey && !hasVision && !forceClaude) {
      try {
        result = await callGemini(JSON.parse(raw), gKey, env, testModel);
      } catch (e) {
        if (e.is429) {
          // 429: try Claude fallback first — only send 429 to client if no Claude key
          if (aKey) {
            try { result = await callClaude(raw, aKey, env); }
            catch (e2) {
              return new Response(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: e.retryAfter }), {
                status: 429,
                headers: { 'Content-Type': 'application/json', 'Retry-After': e.retryAfter, ...cors(origin), ...version() },
              });
            }
          } else {
            return new Response(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: e.retryAfter }), {
              status: 429,
              headers: { 'Content-Type': 'application/json', 'Retry-After': e.retryAfter, ...cors(origin), ...version() },
            });
          }
        } else if (aKey) {
          // CC-CMD-2026-07-16-gemini-model-comparison: a real gemini-3.5-flash
          // test call fell back to Claude here with the actual Gemini error
          // silently swallowed -- no way to tell "Gemini failed" from "why".
          // Diagnostic-only header, real production callers already ignore
          // unknown response headers; doesn't change status/body for anyone.
          geminiFallbackError = e.message || String(e);
          try { result = await callClaude(raw, aKey, env); }
          catch (e2) {
            return new Response(JSON.stringify({ error: 'Both backends failed.' }), {
              status: 502, headers: { 'Content-Type': 'application/json', ...cors(origin), ...version() },
            });
          }
        } else {
          return new Response(JSON.stringify({ error: `Gemini failed: ${e.message}` }), {
            status: 502, headers: { 'Content-Type': 'application/json', ...cors(origin), ...version() },
          });
        }
      }
    } else {
      try { result = await callClaude(raw, aKey, env); }
      catch (e) {
        return new Response(JSON.stringify({ error: `Claude failed: ${e.message}` }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...cors(origin), ...version() },
        });
      }
    }

    return new Response(result.text, {
      status: result.status,
      headers: {
        'Content-Type': 'application/json', 'X-FIELD-Model': result.model,
        ...(result.ms != null ? { 'X-FIELD-Latency-Ms': String(result.ms) } : {}),
        ...(geminiFallbackError ? { 'X-FIELD-Gemini-Error': geminiFallbackError.slice(0, 200) } : {}),
        ...cors(origin), ...version(),
      },
    });
  },
};
