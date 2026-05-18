// field-claude-proxy — Cloudflare Worker v4
// Source of truth: workers/field-claude-proxy/src/index.js
// Auto-deployed via .github/workflows/deploy-proxy.yml on push to workers/**
//
// CHANGES IN v4:
//   Model: gemini-2.5-flash → gemini-2.5-flash-lite (30 RPM vs 15 RPM)
//   429 handling: forward Retry-After to client instead of throwing 502
//   ALLOWED_ORIGINS: added jubilant-bassoon.pages.dev
//   X-FIELD-Proxy-Version: 4 header on all responses
//   max_tokens default: 1000 → 2500 (supports compound editorial call)
//
// SECRETS (set once in Cloudflare dashboard, persist across deploys):
//   GEMINI_KEY    → aistudio.google.com → Get API key (free, 1500 RPD / 30 RPM)
//   ANTHROPIC_KEY → console.anthropic.com → API Keys (optional Claude fallback)
//
// VERIFY after deploy (DevTools Network tab on FIELD app):
//   X-FIELD-Proxy-Version: 4
//   X-FIELD-Model: gemini-2.5-flash-lite  (or claude-sonnet-4 on fallback)

const PROXY_VERSION = '4';

const ALLOWED_ORIGINS = [
  'https://jubilant-bassoon.jeffunglesbee.workers.dev',
  'https://jubilant-bassoon.pages.dev',
];

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

const version = () => ({'X-FIELD-Proxy-Version': PROXY_VERSION});

function toGemini(body) {
  const sys = body.system ? body.system + '\n\n' : '';
  const msg = body.messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : m.content?.[0]?.text || '')
    .join('\n');
  return {
    systemInstruction: {
      parts: [{
        text: 'You are a sports intelligence editor. Always write complete, well-formed sentences. Never stop mid-sentence. Be concise and factual. When asked to return JSON, return ONLY valid JSON with no markdown, no backticks, and no preamble.'
      }]
    },
    contents: [{ parts: [{ text: sys + msg }] }],
    generationConfig: { maxOutputTokens: body.max_tokens || 2500, temperature: 0.4 },
  };
}

function fromGemini(data) {
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return JSON.stringify({
    id: 'gemini-proxy', type: 'message', role: 'assistant',
    model: 'gemini-2.5-flash-lite',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

async function callGemini(body, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toGemini(body)),
  });
  if (r.status === 429) {
    const retryAfter = r.headers.get('Retry-After') || '60';
    throw {is429: true, retryAfter, detail: (await r.text().catch(() => '')).slice(0, 200)};
  }
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { text: fromGemini(await r.json()), model: 'gemini-2.5-flash-lite', status: 200 };
}

async function callClaude(raw, key) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
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

    if (!ALLOWED_ORIGINS.includes(origin))
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

    let result;

    if (gKey) {
      try {
        result = await callGemini(JSON.parse(raw), gKey);
      } catch (e) {
        if (e.is429) {
          return new Response(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: e.retryAfter }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': e.retryAfter, ...cors(origin), ...version() },
          });
        }
        if (aKey) {
          try { result = await callClaude(raw, aKey); }
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
      try { result = await callClaude(raw, aKey); }
      catch (e) {
        return new Response(JSON.stringify({ error: `Claude failed: ${e.message}` }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...cors(origin), ...version() },
        });
      }
    }

    return new Response(result.text, {
      status: result.status,
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Model': result.model, ...cors(origin), ...version() },
    });
  },
};
