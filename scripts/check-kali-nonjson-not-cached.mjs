#!/usr/bin/env node
// relayFetchKV does not store a body that is not JSON, and does not ask a host that sent one again for `ttl`.
// docs/CC-CMD-2026-11-22-kali-shut-down.md, Tasks 1 to 3.
//
// WHY. Kali's author shut the API down on 2026-09-23. On 2026-11-22 a GitHub-hosted runner (field-laboratory
// probe-url run 45084086791) read /api/afl/v1/predictions?year=2026, /teams and /fixture on kaliaflstats.com: each
// answered HTTP 200 with a 5818-byte HTML page titled "kali-afl - back in 2027". relayFetchKV treated any `upstream.ok`
// as data, wrote the body to KALI_CACHE and replayed it as `Content-Type: application/json` for `ttl` seconds. Its two
// callers (src/index.js buildAFLJournalismContext, src/wp-resolver.js resolveWinProbability) both fell back after failing
// to parse it, so nothing broke loudly: the harm was a KV write of a page that is not data and a mislabelled replay.
//
// The first version of the guard only refused the page. An independent review (2026-11-22) ran ten calls against the
// holding page: the old code made 1 upstream call (the stored page answered the other nine), the guard alone made 10, each
// carrying the Bearer token. So the guard also stores a marker, under `not-json:<url>` with the same ttl, and a marker hit
// is answered 502 without a fetch. Cases a5 and g1 hold both halves: no second call while the marker lives, a call again
// once it is gone.
//
// This imports the REAL src/cache-helpers.js (it has no Worker-only import) and drives relayFetchKV with a stubbed fetch and
// a counting KV. The holding-page fixture opens with the first 400 bytes the runner logged, committed verbatim in
// outbox/kali-holding-page-head-20261122.html (case a6 asserts the fixture starts with that file); the rest of the page was
// not captured, so it is padded with an HTML comment to the 5818 BYTES the runner read. The guard only parses the text, so
// the padding decides no case.
//
// Coverage, printed with the result (Rule 91): eight cases of relayFetchKV, counted from the cases that ran against the list
// in CASES below (a case that did not run fails by name). Not checked: the /kali/* route, which uses relayFetch (the Cache
// API helper with other call sites) and is owner question O1 of the CC-CMD; the two call sites' own handling of a non-ok
// answer (read from the code, not run here); KV's real expiry (the stub has none: g1 deletes the marker by hand to stand for
// it, and b2/a4 assert the expirationTtl that was passed).
//
//   node scripts/check-kali-nonjson-not-cached.mjs            # self-test
//   node scripts/check-kali-nonjson-not-cached.mjs --mutate   # Rule 90

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPERS = path.resolve(HERE, '../src/cache-helpers.js');
const HELPERS_MODULE = process.env.HELPERS_MODULE || HELPERS;
const EXCERPT = path.resolve(HERE, '../outbox/kali-holding-page-head-20261122.html');

const { relayFetchKV } = await import(pathToFileURL(HELPERS_MODULE).href);

const URL_PRED = 'https://kaliaflstats.com/api/afl/v1/predictions?year=2026&round=1';
const URL_OTHER = 'https://kaliaflstats.com/api/afl/v1/predictions?year=2026&round=2';
const NEG = u => `not-json:${u}`;

const HOLDING_HEAD = readFileSync(EXCERPT, 'utf8');
const HOLDING_MID = '.com/" />\n<!-- ';
const HOLDING_TAIL = ' -->\n</head></html>';
const bytes = s => Buffer.byteLength(s, 'utf8');
const HOLDING_PAGE = HOLDING_HEAD + HOLDING_MID + 'x'.repeat(5818 - bytes(HOLDING_HEAD) - bytes(HOLDING_MID) - bytes(HOLDING_TAIL)) + HOLDING_TAIL;

function kvStub() {
  const store = new Map();
  const opts = new Map();
  return {
    puts: 0, store, opts,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, o) { this.puts++; opts.set(k, o); store.set(k, v); },
  };
}

// A fetch stub that answers from a queue of plans (the last repeats) and counts calls and Authorization headers sent.
function installFetch(plans) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, auth: init && init.headers && init.headers.Authorization });
    const p = plans[Math.min(calls.length - 1, plans.length - 1)];
    if (p.throws) throw new Error(p.throws);
    return new Response(p.body, { status: p.status, headers: p.headers || {} });
  };
  return calls;
}

function captureWarn(fn) {
  const real = console.warn, seen = [];
  console.warn = (...a) => { seen.push(a.join(' ')); };
  return fn().then(r => { console.warn = real; return [r, seen]; }, e => { console.warn = real; throw e; });
}

const CASES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const seen = new Set();
let failed = 0, asserted = 0;
function check(id, name, ok, detail) {
  asserted++; seen.add(id[0]);
  if (ok) console.log(`  PASS ${id} ${name}`);
  else { failed++; console.log(`  FAIL ${id} ${name}${detail ? ' :: ' + detail : ''}`); }
}

async function runCases() {
  const H = { Authorization: 'Bearer dummy', Accept: 'application/json' };
  const JSON_BODY = '{"predictions":[{"home":"Collingwood","homeWinPct":57.9}]}';

  // (a) the holding page: 200 HTML. Not stored, not served as data, marked, and not asked again while the marker lives.
  {
    const kv = kvStub(); const calls = installFetch([{ status: 200, body: HOLDING_PAGE, headers: { 'content-type': 'text/html' } }]);
    const [r1, warns] = await captureWarn(() => relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000));
    check('a1', 'a 200 HTML holding page is not answered as 200', r1.status !== 200, `status ${r1.status}`);
    check('a2', 'the answer is a 502 naming kali-not-json', r1.status === 502 && r1.headers.get('X-RELAY-Error') === 'kali-not-json', `status ${r1.status} header ${r1.headers.get('X-RELAY-Error')}`);
    check('a3', 'the page is stored nowhere in KV (not under its URL, not as any value)', !kv.store.has(URL_PRED) && ![...kv.store.values()].some(v => v.includes('<!doctype')), `keys ${[...kv.store.keys()].join(',')}`);
    check('a4', 'a marker is stored under not-json:<url> with the same ttl', kv.store.has(NEG(URL_PRED)) && kv.opts.get(NEG(URL_PRED))?.expirationTtl === 3600, `opts ${JSON.stringify(kv.opts.get(NEG(URL_PRED)))}`);
    const r2 = await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    check('a5', 'the next call is a marker hit: no second upstream call, no second Bearer send, the same 502', calls.length === 1 && calls.filter(c => c.auth).length === 1 && r2.status === 502 && r2.headers.get('X-RELAY-Error') === 'kali-not-json', `fetch calls ${calls.length}, status ${r2.status}`);
    check('a6', 'the fixture is 5818 bytes and opens with the committed runner excerpt', bytes(HOLDING_PAGE) === 5818 && HOLDING_PAGE.startsWith(HOLDING_HEAD) && bytes(HOLDING_HEAD) === 400 && HOLDING_HEAD.startsWith('<!doctype html>'), `bytes ${bytes(HOLDING_PAGE)}, excerpt bytes ${bytes(HOLDING_HEAD)}`);
    check('a7', 'one warning names the source and the upstream status', warns.length === 1 && warns[0].includes('kali') && warns[0].includes('200') && warns[0].includes('not JSON'), `warnings ${JSON.stringify(warns)}`);
  }

  // (b) real JSON: stored once with the ttl, served 200, the second call a KV hit, no marker.
  {
    const kv = kvStub(); const calls = installFetch([{ status: 200, body: JSON_BODY }]);
    const r1 = await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    const t1 = await r1.text();
    check('b1', 'a JSON body is answered 200 unchanged', r1.status === 200 && t1 === JSON_BODY, `status ${r1.status}`);
    check('b2', 'a JSON body is stored once with the ttl and no marker is written', kv.puts === 1 && kv.opts.get(URL_PRED)?.expirationTtl === 3600 && !kv.store.has(NEG(URL_PRED)), `puts ${kv.puts} opts ${JSON.stringify(kv.opts.get(URL_PRED))}`);
    const r2 = await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    check('b3', 'the second call is a KV hit: no second fetch, kv proxy header', calls.length === 1 && r2.status === 200 && r2.headers.get('X-FIELD-Proxy') === 'relay-kali-kv', `fetch calls ${calls.length} header ${r2.headers.get('X-FIELD-Proxy')}`);
  }

  // (c) a non-2xx is passed through, not stored and not marked (the existing behaviour, held).
  {
    const kv = kvStub(); installFetch([{ status: 503, body: 'unavailable' }]);
    const r = await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    check('c1', 'a 503 is answered 503, not stored, not marked', r.status === 503 && kv.puts === 0 && r.headers.get('X-RELAY-Error') === 'kali-503', `status ${r.status} puts ${kv.puts}`);
  }

  // (d) a thrown fetch is a 502 kali-network, not stored, not marked (the existing behaviour, held).
  {
    const kv = kvStub(); installFetch([{ throws: 'connection reset' }]);
    const r = await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    check('d1', 'a network error is a 502 kali-network, not stored, not marked', r.status === 502 && kv.puts === 0 && r.headers.get('X-RELAY-Error') === 'kali-network', `status ${r.status} puts ${kv.puts}`);
  }

  // (e) an empty 200 body is not JSON: refused, marked, not stored.
  {
    const kv = kvStub(); installFetch([{ status: 200, body: '' }]);
    const r = await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    check('e1', 'an empty 200 body is refused, marked, and not stored under its URL', r.status === 502 && !kv.store.has(URL_PRED) && kv.store.has(NEG(URL_PRED)), `status ${r.status} keys ${[...kv.store.keys()].join(',')}`);
  }

  // (f) the guard parses; it does not judge content: an empty array is JSON and is stored.
  {
    const kv = kvStub(); installFetch([{ status: 200, body: '[]' }]);
    const r = await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    check('f1', 'valid JSON with no rows is still stored and served 200 (the guard parses, it does not judge)', r.status === 200 && kv.store.has(URL_PRED) && !kv.store.has(NEG(URL_PRED)), `status ${r.status} puts ${kv.puts}`);
  }

  // (g) a host that comes back is asked again once the marker is gone (KV expiry stands in as a manual delete).
  {
    const kv = kvStub(); const calls = installFetch([{ status: 200, body: HOLDING_PAGE }, { status: 200, body: JSON_BODY }]);
    await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    kv.store.delete(NEG(URL_PRED));
    const r = await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    check('g1', 'with the marker expired a second call goes upstream, and a JSON answer is then stored and served 200', calls.length === 2 && r.status === 200 && kv.store.get(URL_PRED) === JSON_BODY, `fetch calls ${calls.length}, status ${r.status}`);
  }

  // (h) the marker is per URL: one refused round does not block another.
  {
    const kv = kvStub(); const calls = installFetch([{ status: 200, body: HOLDING_PAGE }, { status: 200, body: JSON_BODY }]);
    await relayFetchKV(URL_PRED, H, 3600, 'kali', kv, 5000);
    const r = await relayFetchKV(URL_OTHER, H, 3600, 'kali', kv, 5000);
    check('h1', 'a refusal for one URL does not refuse another URL', calls.length === 2 && r.status === 200 && kv.store.get(URL_OTHER) === JSON_BODY, `fetch calls ${calls.length}, status ${r.status}`);
  }

}

async function selfTest() {
  try { await runCases(); }
  catch (e) { failed++; console.log(`  FAIL threw ${String(e && e.message).slice(0, 160).replace(/\n/g, ' ')} (an assertion that throws is a failure, not a crash)`); }
  const missing = CASES.filter(c => !seen.has(c));
  if (missing.length) { failed++; console.log(`  FAIL coverage: case ${missing.join(', ')} did not run`); }
  console.log(`\nchecked ${CASES.length - missing.length} of ${CASES.length} cases (${asserted} assertions) of relayFetchKV: the holding page and its marker, JSON, 503, a thrown fetch, an empty body, an empty array, marker expiry, marker per URL. Not checked: the /kali/* route (relayFetch), the two callers' own handling, KV's real expiry.`);
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : 'self-test passed');
  return failed;
}

// [name, [[from, to], ...]]. Every anchor must occur exactly once, or the mutation is not run and the gate
// fails (Rule 90's corollary: a mutation that applied nothing is worse than no test).
const GUARD_REFUSAL = "await kv.put(notJsonKey, '1', { expirationTtl: ttl });\n        return new Response(`${source} returned a non-JSON body`, { status: 502, headers: { 'X-RELAY-Error': `${source}-not-json`";
const HIT_REFUSAL = "if (await kv.get(notJsonKey) !== null) {\n        return new Response(`${source} returned a non-JSON body`, { status: 502, headers: { 'X-RELAY-Error': `${source}-not-json`";
const MUTATIONS = [
  ['the guard is removed', [['if (!isJsonBody(bodyText)) {', 'if (false) {']]],
  ['the parse always succeeds', [['try { JSON.parse(text); return true; } catch { return false; }', 'try { JSON.parse(text); return true; } catch { return true; }']]],
  ['the page is stored before the check', [['    const bodyText = await upstream.text();\n', '    const bodyText = await upstream.text();\n    await kv.put(cacheKey, bodyText, { expirationTtl: ttl });\n']]],
  ['the guard refusal is answered 200', [[GUARD_REFUSAL, GUARD_REFUSAL.replace('status: 502', 'status: 200')]]],
  ['the marker-hit refusal is answered 200', [[HIT_REFUSAL, HIT_REFUSAL.replace('status: 502', 'status: 200')]]],
  ['the guard refusal does not name itself', [[GUARD_REFUSAL, GUARD_REFUSAL.replace("`${source}-not-json`", "`${source}-502`")]]],
  ['the marker-hit refusal does not name itself', [[HIT_REFUSAL, HIT_REFUSAL.replace("`${source}-not-json`", "`${source}-502`")]]],
  ['the guard refuses valid JSON', [['if (!isJsonBody(bodyText)) {', 'if (isJsonBody(bodyText)) {']]],
  ['an empty body is trusted', [['try { JSON.parse(text); return true; } catch { return false; }', "if (text === '') return true;\n    try { JSON.parse(text); return true; } catch { return false; }"]]],
  ['the marker is not written', [["await kv.put(notJsonKey, '1', { expirationTtl: ttl });", '']]],
  ['the marker is never read', [['if (await kv.get(notJsonKey) !== null) {', 'if (false) {']]],
  ['the marker has no expiry', [["await kv.put(notJsonKey, '1', { expirationTtl: ttl });", "await kv.put(notJsonKey, '1');"]]],
  ['the marker has a different ttl', [["await kv.put(notJsonKey, '1', { expirationTtl: ttl });", "await kv.put(notJsonKey, '1', { expirationTtl: 60 });"]]],
  ['the marker is shared by every URL', [['const notJsonKey = `not-json:${targetUrl}`;', "const notJsonKey = 'not-json';"]]],
  ['the warning is dropped', [['console.warn(`[relayFetchKV] ${source} answered ${upstream.status} with a body that is not JSON', 'void (`[relayFetchKV] ${source} answered ${upstream.status} with a body that is not JSON']]],
];

function mutate() {
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout + base.stderr); return 1; }
  let bad = 0;
  const original = readFileSync(HELPERS, 'utf8');
  for (const [name, edits] of MUTATIONS) {
    let text = original, why = null;
    for (const [from, to] of edits) {
      const at = text.indexOf(from);
      if (at < 0 || text.indexOf(from, at + 1) >= 0) { why = at < 0 ? 'missing' : 'not unique'; break; }
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
    if (why) { console.log(`  ANCHOR     ${name} (${why}): not run`); bad++; continue; }
    if (text === original) { console.log(`  ANCHOR     ${name} (applied nothing): not run`); bad++; continue; }
    const mutant = path.join(path.dirname(HELPERS), `.mutant-${process.pid}-kali-cache-helpers.js`);
    writeFileSync(mutant, text, 'utf8');
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, HELPERS_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (\S+)/gm) || []).map(l => l.slice(7));
      if (r.status !== 0 && /SELF-TEST FAILED/.test(r.stdout) && fails.length) {
        console.log(`  CAUGHT     ${name}\n               by: ${fails.join(' ')}`);
      } else if (r.status === 0) {
        console.log(`  NOT CAUGHT ${name}`); bad++;
      } else {
        console.log(`  HARNESS ERROR ${name} (exit ${r.status}, no failing assertion)\n${(r.stderr || '').slice(0, 400)}`); bad++;
      }
    } finally { unlinkSync(mutant); }
  }
  console.log(`\nmutations: ${MUTATIONS.length - bad} of ${MUTATIONS.length} caught (exit 0 when all are caught, 1 otherwise)`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--mutate')) process.exit(mutate());
else process.exit(await selfTest() ? 1 : 0);
