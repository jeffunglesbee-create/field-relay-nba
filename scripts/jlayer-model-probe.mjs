// What model actually answers a J-layer call?
//
// CLAUDE.md states the proxy routes to Gemini 3.1 Flash-Lite primary with
// Claude Haiku 4.5 fallback. That is an inherited claim (Rule 72) and the
// relay itself cannot corroborate it: every J-layer call sends
// `model: 'claude-haiku-4-5-20251001'` in the body and lets the proxy decide,
// and the one route that reports a model —— /test/gemini-judge, src/index.js:14886
// —— HARDCODES `model: 'gemini-via-proxy'` in its response. It asserts what the
// proxy did rather than reading it.
//
// The mechanism to read it already exists. src/index.js:8915 shows the proxy
// returns provenance in RESPONSE HEADERS:
//
//   X-FIELD-Model         which model actually answered
//   X-FIELD-Latency-Ms
//   X-FIELD-Gemini-Error  why it fell back, when it did
//   X-FIELD-Test-Model    (request) force a specific model
//
// So this measures the routing rather than trusting either the doc or the
// hardcoded label, and does it from a runner because the sandbox proxy 403s
// *.workers.dev.
//
// Rule 78: each call is one real inference. Deliberately 3 calls at
// max_tokens 32 with a trivial prompt — enough to see routing and whether it
// is stable, not enough to matter.

const PROXY = process.env.PROXY_URL || 'https://field-claude-proxy.jeffunglesbee.workers.dev';
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SECRET = process.env.RELAY_SHARED_SECRET || 'field-relay-cron-2026';
const TS = new Date().toISOString();

// Body shape copied verbatim from the relay's own call sites.
const body = (prompt, maxTokens = 32) => JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: maxTokens,
  messages: [{ role: 'user', content: prompt }],
});

async function callProxy(label, prompt, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-FIELD-Relay': SECRET, ...extraHeaders };
  const t0 = Date.now();
  const rec = { label, requestedModel: 'claude-haiku-4-5-20251001', extraHeaders };
  try {
    const r = await fetch(PROXY, { method: 'POST', headers, body: body(prompt), signal: AbortSignal.timeout(45000) });
    rec.status = r.status;
    rec.wallMs = Date.now() - t0;
    // The provenance the relay already knows how to read at src/index.js:8915.
    rec.xFieldModel = r.headers.get('X-FIELD-Model');
    rec.xFieldLatencyMs = r.headers.get('X-FIELD-Latency-Ms');
    rec.xFieldGeminiError = r.headers.get('X-FIELD-Gemini-Error');
    const txt = await r.text();
    rec.bytes = txt.length;
    try {
      const j = JSON.parse(txt);
      // An Anthropic-shaped reply carries its own `model`. Whether the proxy
      // preserves it, rewrites it, or echoes the request is exactly the
      // question — so record it beside the header rather than assuming they
      // agree.
      rec.bodyModel = j?.model ?? null;
      rec.stopReason = j?.stop_reason ?? null;
      rec.usage = j?.usage ?? null;
      rec.textHead = (j?.content?.[0]?.text || '').slice(0, 80);
    } catch { rec.parseFailed = true; rec.head = txt.slice(0, 160); }
  } catch (e) { rec.error = String(e.message || e); }
  return rec;
}

(async () => {
  const out = { ts: TS, proxy: PROXY, relay: RELAY, calls: [] };
  const add = async (...args) => {
    const r = await callProxy(...args);
    out.calls.push(r);
    console.log(`${String(r.status ?? 'ERR').padEnd(4)} ${String(r.wallMs ?? '-').padStart(6)}ms  ` +
      `X-FIELD-Model=${String(r.xFieldModel).padEnd(28)} bodyModel=${String(r.bodyModel).padEnd(28)} ` +
      `geminiError=${r.xFieldGeminiError || '-'}  ${r.label}`);
    return r;
  };

  console.log(`=== jlayer-model-probe  proxy=${PROXY}  utc=${TS} ===\n`);

  // Three identical-shape calls: routing could be per-request (load balanced,
  // quota-driven), so one sample cannot establish "primary".
  await add('routing-1', 'Reply with exactly: OK');
  await add('routing-2', 'Reply with exactly: OK');
  // Does X-FIELD-Test-Model actually override? If it does, the relay has a
  // supported way to pin a model, which matters for any future A/B.
  await add('forced-haiku', 'Reply with exactly: OK', { 'X-FIELD-Test-Model': 'claude-haiku-4-5-20251001' });

  // And the route that reports a model today, for comparison.
  try {
    const r = await fetch(`${RELAY}/test/gemini-judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': SECRET },
      body: JSON.stringify({ brief: 'The Orioles won 5-4. Baltimore needed every inning of it.' }),
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json().catch(() => null);
    out.judgeRoute = { status: r.status, reportedModel: j?.model ?? null, verdict: j?.verdict ?? null, ms: j?.ms ?? null };
    console.log(`\n/test/gemini-judge reports model=${out.judgeRoute.reportedModel} (status ${out.judgeRoute.status})`);
  } catch (e) { out.judgeRoute = { error: String(e.message || e) }; }

  const models = [...new Set(out.calls.map(c => c.xFieldModel).filter(Boolean))];
  out.summary = {
    distinctModelsSeen: models,
    routingStable: models.length <= 1,
    anyGeminiError: out.calls.map(c => c.xFieldGeminiError).filter(Boolean),
    headerPresent: out.calls.every(c => c.xFieldModel != null),
    // The claim under test.
    judgeRouteReports: out.judgeRoute?.reportedModel ?? null,
    judgeRouteMatchesReality: models.length === 1 && out.judgeRoute?.reportedModel === models[0],
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(out.summary, null, 2));

  const fs = await import('node:fs');
  fs.mkdirSync('outbox', { recursive: true });
  fs.writeFileSync(`outbox/jlayer-model-probe-${TS.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2));
  process.exit(0);
})();
