// What model actually answers a J-layer call, and does X-FIELD-Test-Model
// actually steer it?
//
// ROUND 1 (2026-08-14, outbox/jlayer-model-probe-20260814T0126*.log) established
// the routing: 6/6 calls answered by gemini-3.1-flash-lite, X-FIELD-Model present
// every time, X-FIELD-Gemini-Error empty every time. That part is settled and the
// calls below re-confirm it as a control rather than re-litigate it.
//
// ROUND 1 also produced one observation it could NOT interpret: forcing
// `X-FIELD-Test-Model: claude-haiku-4-5-20251001` still returned
// gemini-3.1-flash-lite. Two explanations fit equally well, because every round-1
// call sent an IDENTICAL body and the forced call came back in 29ms/45ms against
// 874-3908ms for the others:
//   (a) the proxy ignores the header
//   (b) the response was a cache hit and the header never reached a real inference
//
// A third explanation surfaced from this repo's own history and beats both. The
// 2026-07-16 comparison session (outbox/gemini-model-comparison-2026-07-16.md)
// recorded that the proxy validates the header against
//   ALLOWED_TEST_MODELS = new Set(['gemini-3.1-flash-lite','gemini-3.5-flash'])
// and falls back to DEFAULT_GEMINI_MODEL when the value is absent OR not in that
// set. Under that claim the override works fine and round 1 simply asked it for a
// model it does not accept — a Claude model name. That is an inherited claim
// (Rule 72) about a file in a DIFFERENT repo (workers/field-claude-proxy), 4 weeks
// old, so it is a hypothesis to test over the wire, not a fact to write up.
//
// This round therefore fixes the measurement in two ways:
//
//   1. EVERY call sends a UNIQUE prompt (label + run timestamp embedded in the
//      message text). This is the whole reason round 1 was uninterpretable —
//      identical bodies make a cache hit indistinguishable from an ignored header.
//
//   2. The override is tested with BOTH an out-of-allow-list value (a Claude model,
//      what round 1 tried) and an in-allow-list value (gemini-3.5-flash). Only the
//      second arm can distinguish "override ignored entirely" from "override
//      honored, but scoped to the Gemini models the proxy accepts". A probe that
//      tests only the Claude value cannot tell those apart no matter how many
//      times it runs.
//
// Rule 78: every call is one real inference. max_tokens 32, trivial prompts.

const PROXY = process.env.PROXY_URL || 'https://field-claude-proxy.jeffunglesbee.workers.dev';
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SECRET = process.env.RELAY_SHARED_SECRET || 'field-relay-cron-2026';
const TS = new Date().toISOString();

// The allow-list the 2026-07-16 session recorded. Under test, not assumed.
const IN_ALLOWLIST = 'gemini-3.5-flash';
const OUT_OF_ALLOWLIST = 'claude-haiku-4-5-20251001';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

// Unique per call. Without this the whole probe is uninterpretable.
const uniquePrompt = (label) =>
  `Run ${TS} call ${label}. Reply with exactly the word: OK`;

// Body shape copied verbatim from the relay's own call sites.
const body = (prompt, maxTokens = 32) => JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: maxTokens,
  messages: [{ role: 'user', content: prompt }],
});

async function callProxy(label, testModel) {
  const headers = { 'Content-Type': 'application/json', 'X-FIELD-Relay': SECRET };
  if (testModel) headers['X-FIELD-Test-Model'] = testModel;
  const t0 = Date.now();
  const rec = { label, testModel: testModel || null, prompt: uniquePrompt(label) };
  try {
    const r = await fetch(PROXY, {
      method: 'POST', headers, body: body(rec.prompt),
      signal: AbortSignal.timeout(45000),
    });
    rec.status = r.status;
    rec.wallMs = Date.now() - t0;
    // The provenance the relay already reads at src/index.js:8915.
    rec.xFieldModel = r.headers.get('X-FIELD-Model');
    rec.xFieldLatencyMs = r.headers.get('X-FIELD-Latency-Ms');
    rec.xFieldGeminiError = r.headers.get('X-FIELD-Gemini-Error');
    const txt = await r.text();
    rec.bytes = txt.length;
    try {
      const j = JSON.parse(txt);
      rec.bodyModel = j?.model ?? null;
      rec.usage = j?.usage ?? null;
      rec.textHead = (j?.content?.[0]?.text || '').slice(0, 60);
    } catch {
      // A non-JSON body here is a Cloudflare error page, not a model response.
      // Round 2 lost the diagnosis by truncating at 160 chars and keeping only
      // the DOCTYPE; the CF error code is the whole content of the message.
      rec.parseFailed = true;
      rec.head = txt.slice(0, 160);
      rec.cfErrorCode = (txt.match(/error code:\s*(\d+)/i) || [])[1] || null;
      rec.cfRayOrTitle = (txt.match(/<title>([^<]{0,120})<\/title>/i) || [])[1] || null;
    }
  } catch (e) { rec.error = String(e.message || e); }
  return rec;
}

(async () => {
  const out = { ts: TS, proxy: PROXY, relay: RELAY, calls: [] };
  const add = async (label, testModel) => {
    const r = await callProxy(label, testModel);
    out.calls.push(r);
    console.log(
      `${String(r.status ?? 'ERR').padEnd(4)} ${String(r.wallMs ?? '-').padStart(6)}ms  ` +
      `sent=${String(r.testModel || '(none)').padEnd(28)} ` +
      `X-FIELD-Model=${String(r.xFieldModel).padEnd(22)} ` +
      `geminiError=${r.xFieldGeminiError || '-'}  ${r.label}`);
    return r;
  };

  console.log(`=== jlayer-model-probe round 2  proxy=${PROXY}  utc=${TS} ===`);
  console.log(`every call sends a unique prompt; latency is therefore real inference, not cache\n`);

  // ── Control: routing with no override at all (round 1's finding, re-checked) ──
  const base1 = await add('baseline-1', null);
  const base2 = await add('baseline-2', null);

  // ── The pair the CC-CMD specifies: same unique prompt shape, +/- Claude override ──
  const forcedClaude = await add('forced-claude', OUT_OF_ALLOWLIST);
  const unforcedTwin = await add('unforced-twin', null);

  // ── The discriminating arm: an override value the proxy is claimed to ACCEPT ──
  // Repeated, and interleaved with unforced controls, because round 2 got a single
  // HTTP 500 here and one sample cannot separate "this VALUE breaks the proxy" from
  // "the proxy was flaky in that moment" — a 1101 from this same worker was already
  // observed once tonight on an unrelated call.
  const forcedGeminiRuns = [];
  const interleavedControls = [];
  for (let i = 1; i <= 3; i++) {
    forcedGeminiRuns.push(await add(`forced-gemini-3.5-${i}`, IN_ALLOWLIST));
    interleavedControls.push(await add(`control-${i}`, null));
  }
  const forcedGemini = forcedGeminiRuns[0];

  // ── The route that reports a model, for comparison (fixed in 12e4018) ──
  try {
    const r = await fetch(`${RELAY}/test/gemini-judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': SECRET },
      body: JSON.stringify({ brief: `Run ${TS}. The Orioles won 5-4. Baltimore needed every inning of it.` }),
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json().catch(() => null);
    out.judgeRoute = { status: r.status, reportedModel: j?.model ?? null, geminiError: j?.geminiError ?? null, ms: j?.ms ?? null };
    console.log(`\n/test/gemini-judge reports model=${out.judgeRoute.reportedModel} (status ${out.judgeRoute.status})`);
  } catch (e) { out.judgeRoute = { error: String(e.message || e) }; }

  // ── Verdict: A / B / C, decided by the measurements, not by preference ────────
  const baselineModels = [base1, base2, unforcedTwin].map(c => c.xFieldModel);
  const baselineStable = new Set(baselineModels.filter(Boolean)).size === 1;
  const baselineModel = baselineModels[0];

  // A cache hit would show up as a wall time far below the real-inference range.
  // With unique prompts this should no longer be possible; measured, not assumed.
  const realTimes = [base1, base2, unforcedTwin].map(c => c.wallMs).filter(Number.isFinite);
  const minReal = Math.min(...realTimes);
  const suspiciouslyFast = out.calls.filter(c => Number.isFinite(c.wallMs) && c.wallMs < minReal / 3)
    .map(c => ({ label: c.label, wallMs: c.wallMs }));

  const geminiOverrideHonored = forcedGeminiRuns.some(c => c.xFieldModel === IN_ALLOWLIST);
  const claudeOverrideHonored = forcedClaude.xFieldModel === OUT_OF_ALLOWLIST;

  // Round 2's verdict logic was wrong and stamped "OVERRIDE IGNORED" on a run whose
  // discriminating call returned HTTP 500. It tested `xFieldModel === IN_ALLOWLIST`
  // and treated every other outcome as "ignored", conflating "the proxy answered
  // with a different model" (ignored) with "the proxy did not answer at all"
  // (errored). Those are opposite conclusions: an IGNORED header returns 200 plus
  // the default; a header that ERRORS the worker demonstrably reached its routing
  // logic. Non-200 is now its own class and can never be read as "ignored".
  const forcedGeminiErrored = forcedGeminiRuns.filter(c => c.status !== 200);
  const controlsAllOk = interleavedControls.every(c => c.status === 200);

  let verdict, verdictText;
  if (suspiciouslyFast.length) {
    verdict = 'C';
    verdictText = 'AMBIGUOUS — at least one call returned implausibly fast despite a unique prompt; ' +
      'cache cannot be excluded. Do not conclude anything about the override from this run.';
  } else if (forcedGeminiErrored.length && controlsAllOk) {
    verdict = 'A-ERROR';
    verdictText = `OVERRIDE REACHES THE PROXY, AND ${IN_ALLOWLIST} IS BROKEN — ` +
      `${forcedGeminiErrored.length}/${forcedGeminiRuns.length} forced calls returned non-200 ` +
      `(${forcedGeminiErrored.map(c => `${c.status}${c.cfErrorCode ? `/cf-${c.cfErrorCode}` : ''}`).join(', ')}) ` +
      `while ${interleavedControls.length}/${interleavedControls.length} interleaved unforced controls returned 200. ` +
      'The header is NOT inert — an ignored header would return 200 with the default model, as the ' +
      `${OUT_OF_ALLOWLIST} arm does. It steers routing, and the ${IN_ALLOWLIST} route currently throws.`;
  } else if (forcedGeminiErrored.length && !controlsAllOk) {
    verdict = 'C';
    verdictText = 'AMBIGUOUS — the forced calls errored, but so did at least one unforced control, ' +
      'so the proxy was unhealthy during this run. Re-run; do not attribute the errors to the header.';
  } else if (geminiOverrideHonored || claudeOverrideHonored) {
    verdict = 'A';
    verdictText = 'OVERRIDE WORKS — X-FIELD-Test-Model changed the answering model. ' +
      (geminiOverrideHonored && !claudeOverrideHonored
        ? `Scoped: honored for ${IN_ALLOWLIST}, NOT for ${OUT_OF_ALLOWLIST} (which fell through to the default ` +
          `${forcedClaude.xFieldModel}) — consistent with a proxy-side allow-list of Gemini models.`
        : 'Honored for every value tested.');
  } else {
    verdict = 'B';
    verdictText = `OVERRIDE IGNORED — every forced call returned HTTP 200 with ` +
      `${forcedGemini.xFieldModel}, the same model and latency range as the unforced calls, for both ` +
      `${OUT_OF_ALLOWLIST} and ${IN_ALLOWLIST}. The header is dead weight in this repo.`;
  }

  out.summary = {
    // Round 1's finding, re-confirmed as a control.
    baselineModel, baselineStable,
    // The question this round exists to answer.
    sentOutOfAllowlist: OUT_OF_ALLOWLIST, gotForOutOfAllowlist: forcedClaude.xFieldModel,
    sentInAllowlist: IN_ALLOWLIST,
    inAllowlistResults: forcedGeminiRuns.map(c => ({
      label: c.label, status: c.status, model: c.xFieldModel,
      cfErrorCode: c.cfErrorCode ?? null, wallMs: c.wallMs,
    })),
    interleavedControlResults: interleavedControls.map(c => ({
      label: c.label, status: c.status, model: c.xFieldModel, wallMs: c.wallMs,
    })),
    claudeOverrideHonored, geminiOverrideHonored,
    // Cache exclusion, measured rather than asserted.
    wallMsByCall: out.calls.map(c => ({ label: c.label, wallMs: c.wallMs })),
    minUnforcedWallMs: minReal,
    suspiciouslyFast,
    cacheExcluded: suspiciouslyFast.length === 0,
    judgeRouteReports: out.judgeRoute?.reportedModel ?? null,
    verdict, verdictText,
  };

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(out.summary, null, 2));
  console.log(`\n=== VERDICT ${verdict} — ${verdictText} ===`);

  const fs = await import('node:fs');
  fs.mkdirSync('outbox', { recursive: true });
  fs.writeFileSync(`outbox/jlayer-model-probe-${TS.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2));
  process.exit(0);
})();
