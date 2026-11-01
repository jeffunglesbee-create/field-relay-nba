#!/usr/bin/env node
// Read allow-listed GET routes of the deployed relay from a GitHub Actions runner and write what came back to outbox/, so a session whose sandbox
// cannot reach *.workers.dev can read it with `git pull`. Driven by .github/workflows/relay-read.yml; the sandbox side is scripts/relay-look.sh.
// docs/relay-from-the-sandbox.md says when to use this and when not to.
//
// WHY THIS EXISTS. Measured 2026-11-01: the sandbox's egress policy answers 403 to CONNECT for field-relay-nba.jeffunglesbee.workers.dev (and
// statsapi.mlb.com, site.api.espn.com), while api.github.com answers. A runner has open egress. Sessions kept writing "STAGED: the sandbox cannot
// reach the relay" and waiting for a scheduled run; this makes a look at the relay a one-minute round trip instead.
//
// AN ALLOW-LIST AND NOTHING ELSE. This points a dispatch input at a live system that spends money (Odds API credits, LLM calls) and writes (D1, KV, R2, queues,
// Durable Objects). A DENY-list cannot be made complete for a relay with several hundred routes, and the independent review of 2026-11-01 proved it by
// reaching spending and writing routes through a version that had one: /wc/match-wp fetches /wc/odds-probs on the relay's own behalf, /analytics/run is an
// unauthenticated GET that runs the analytics engine, /v2/games for a soccer sport charges the Odds API for team lambdas and writes results. So:
//   - ONE rule: the route's path, exactly as it will be SENT, must be a member of ALLOWED. There is no override, no flag and no second list.
//   - GET only, redirects not followed, no credential sent (the relay's shared secret opens /web-fetch, /admin and _forcePrimaryFail; this job does not receive it).
//   - A route is added to ALLOWED only after its handler has been read to the end, with every query parameter, for: a call that reaches a vendor, a queue or an LLM,
//     a write of any kind, and a fetch of the relay's OWN routes (grep `${RELAY}`, `JOURNALISM_QUEUE`, `consumeOddsCredit`, `waitUntil`). The self-test pins the list
//     (so adding one is a two-place edit) and refuses a table of routes known to spend or write.
//
// Usage: ROUTES="/budget/odds?date=2026-11-01 /health" LABEL=x node scripts/relay-read.mjs      |      node scripts/relay-read.mjs --self-test
import { writeFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELAY = String(process.env.RELAY_BASE ?? 'https://field-relay-nba.jeffunglesbee.workers.dev').replace(/\/+$/, '');
export const MAX_BODY = 256 * 1024;
export const MAX_ROUTES = 10;
export const ROUTE_TIMEOUT_MS = Number.isFinite(Number(process.env.RELAY_READ_TIMEOUT_MS)) && Number(process.env.RELAY_READ_TIMEOUT_MS) > 0 ? Number(process.env.RELAY_READ_TIMEOUT_MS) : 20000; // sequential: MAX_ROUTES x this = 200 s, inside the helper's wait and the job's 10 minutes

// Read in src/index.js on 2026-11-01 (handler to the end, every query parameter; the independent review read them again):
//   /health               one KV read.
//   /budget/odds          D1 and KV reads, plus ONE edge-cached (60 s) GET of the vendor's /v4/sports, which the vendor documents as free and which the relay's own
//                         comment labels ODDS-FREE; measured x-requests-last 0 on one reading. A BELIEF, not a guarantee. It is the route the drift, pairing and vendor
//                         watches read every few hours, and it is what this tool exists to look at. On a 401/429 it retries with a second key and writes one KV marker.
//   /analytics/status     KV read.      /analytics/degraded  bound-parameter D1 read.
//   /archive/query        bound parameters only, no SQL or table name accepted, limit capped at 50; costs D1 rows read, not credits.
// NOT on the list, with the reason found in review: /v2/games (soccer: Odds API lambdas + D1/R2/DO writes; NHL/NBA: queue + LLM per final).
export const ALLOWED = ['/health', '/budget/odds', '/analytics/status', '/analytics/degraded', '/archive/query'];

/** {ok:true} or {ok:false, why}. `route` is path plus optional query. */
export function routePolicy(route) {
  if (typeof route !== 'string') return { ok: false, why: 'not a string' };
  if (route.length > 300) return { ok: false, why: 'longer than 300 characters' };
  // The typed path must EQUAL a member of ALLOWED, and every member is a plain path, so the path that is SENT is the path that was typed: there is nothing for the URL
  // parser to rewrite. That matters: the parser resolves dot segments, percent-encoded ones included, so a policy that judged the typed string by prefix let
  // /health/%2e%2e/cfl/odds-probs through and fetch sent /cfl/odds-probs (found 2026-11-01 in the first version of this file; the self-test pins it).
  const raw = route.split('?')[0];
  if (ALLOWED.includes(raw)) return { ok: true };
  return { ok: false, why: `${raw} is not on the allow-list (${ALLOWED.join(', ')}). Reading another route needs its handler read to the end and an edit of ALLOWED in scripts/relay-read.mjs; see the header` };
}

/** The routes of one dispatch: whitespace separated (a comma is legal inside a query value), de-duplicated. NOT capped here: the caller refuses the excess, visibly. */
export function parseRoutes(text) {
  const seen = new Set(), out = [];
  for (const r of (typeof text === 'string' ? text : '').split(/\s+/).filter(Boolean)) if (!seen.has(r)) { seen.add(r); out.push(r); }
  return out;
}

export const KEEP_HEADERS = ['content-type', 'cache-control', 'cf-cache-status', 'age', 'x-field-model', 'x-field-relay-version', 'etag', 'last-modified', 'location'];

/** One route's entry for the artifact. Pure over the response so the self-test can run it. The cap is on BYTES; a JSON body is kept as JSON only if it still fits once
 *  serialised (a 4 KB body of nested arrays serialises to megabytes, and a 40 KB one can overflow the stack), otherwise it is kept as text. `empty` is set for a zero-byte
 *  body: a 200 with nothing in it is not a reading, and must not read as one. */
export function entryFrom(route, status, headers, text, ms) {
  const h = {};
  for (const k of KEEP_HEADERS) { const v = headers.get ? headers.get(k) : headers[k]; if (v !== null && v !== undefined) h[k] = v; }
  const buf = Buffer.from(text, 'utf8');
  const bytes = buf.length;
  const truncated = bytes > MAX_BODY;
  const shown = truncated ? buf.subarray(0, MAX_BODY).toString('utf8').replace(/\uFFFD$/, '') : text; // a cut inside a multibyte character leaves one U+FFFD
  let body = shown, json = false;
  if (!truncated) { try { const parsed = JSON.parse(shown); if (JSON.stringify(parsed).length <= MAX_BODY) { body = parsed; json = true; } } catch (_) { /* text */ } }
  return { route, status, ok: status >= 200 && status < 300, ms, headers: h, bytes, empty: bytes === 0, truncated, json, body };
}

/** The artifact as text. Entries are one line each: a deeply nested body must not be indented into megabytes. */
export function serialize(out) {
  const { entries, ...rest } = out;
  const head = JSON.stringify(rest, null, 1);
  return `${head.slice(0, -2)},\n "entries": [\n${entries.map((e) => `  ${JSON.stringify(e)}`).join(',\n')}\n ]\n}\n`;
}

export async function readRoute(route, fetchImpl) {
  const t0 = Date.now();
  try {
    const res = await fetchImpl(RELAY + route, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'field-relay-read/1' },
    });
    return entryFrom(route, res.status, res.headers, await res.text(), Date.now() - t0);
  } catch (e) {
    return { route, status: null, ok: false, ms: Date.now() - t0, error: String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e).slice(0, 200) };
  }
}

if (process.argv.includes('--self-test')) {
  let bad = 0, total = 0;
  const one = (label, got, want) => { total++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
  const P = (r) => routePolicy(r).ok;
  // The list is PINNED here, so adding a route is a deliberate edit in two places.
  one('ALLOWED is exactly the reviewed list', ALLOWED, ['/health', '/budget/odds', '/analytics/status', '/analytics/degraded', '/archive/query']);
  one('every ALLOWED entry passes, with and without a query', ALLOWED.map((p) => [P(p), P(`${p}?date=2026-11-01`)]), ALLOWED.map(() => [true, true]));
  // Each of these spends, writes, loops, exposes a secret or reaches the vendor (directly or by fetching the relay itself). All must be refused.
  const NEVER = ['/cfl/odds-probs', '/wc/odds-probs', '/odds', '/odds/v4/sports', '/identity/mismatches?date=2026-10-31', '/archive/odds-backfill?date=2026-10-31', '/archive/game', '/archive/backfill',
    '/archive/backfill-enrich', '/archive/debrief-backfill', '/wc/wp', '/test', '/d1/execute', '/session', '/push/subscribe',
    '/v2/games?sport=nhl&date=2026-10-31', '/v2/games?sport=epl', '/v2/games',
    '/wc/match-wp?home=France&away=Brazil', '/wc/projections', '/wc/elimination-traps', '/wc/bracket/refresh',
    '/analytics/run?date=2026-10-31', '/backfill/game-briefs?limit=50', '/backfill/brief-scores', '/quality/backfill-scores', '/integrity/briefs?date=2026-10-31&repair=true',
    '/schedule/ai-fallback?date=2026-11-02', '/live/ambient',
    '/debug/odds-budget-latency', '/mcp', '/oauth/token', '/.well-known/oauth-authorization-server', '/web-fetch?url=https://example.com', '/admin/bsd-game-join'];
  one(`${NEVER.length} routes that spend, write, loop or expose a secret are all refused`, NEVER.filter(P), []);
  one('the refusal says why and names the allow-list', /not on the allow-list \(\/health, /.test(routePolicy('/cfl/odds-probs').why), true);
  // A match is the whole path: not a prefix, not a child, not another case, not a trailing slash.
  one('a longer path is not the allowed one', [P('/budget/oddsx'), P('/budget/odds/x'), P('/healthz'), P('/health/x'), P('/archive/query/x')], [false, false, false, false, false]);
  one('a case variant is not the allowed one', [P('/Health'), P('/BUDGET/odds'), P('/Archive/Query')], [false, false, false]);
  one('a trailing slash is not the allowed one (the relay routes the literal path)', [P('/health/'), P('/budget/odds/')], [false, false]);
  one('a parent of an allowed path is not allowed', [P('/budget'), P('/analytics'), P('/archive'), P('/')], [false, false, false, false]);
  // The URL parser resolves these to another path before the request leaves, so each is judged by the path it would be SENT as.
  const SENT = (r) => new URL(RELAY + r).pathname;
  const sneaky = ['/budget/odds/%2e%2e/%2e%2e/debug/x', '/health/%2E%2E/cfl/odds-probs', '/health/.%2e/odds', '/health/%2e%2e/web-fetch', '/health/%2e%2e/%2e%2e/admin/bsd-game-join', '/health/./../odds', '/budget/odds/../../debug/x'];
  one('the traversal fixtures really are rewritten by the URL parser to other paths', sneaky.map(SENT), ['/debug/x', '/cfl/odds-probs', '/odds', '/web-fetch', '/admin/bsd-game-join', '/odds', '/debug/x']);
  one('...and every one is refused', sneaky.map(P), sneaky.map(() => false));
  one('dot segments that land ON an allowed path are refused too (the string typed is not the path sent)', [P('/health/../health'), P('/budget/./odds'), P('/x/../health'), P('/budget/%6fdds')], [false, false, false, false]);
  one('percent-encoding in a path is refused (an encoded slash, an encoded letter)', [P('/health%2f'), P('/%68ealth'), P('/analytics%2fstatus')], [false, false, false]);
  one('a fragment is refused', P('/health#/x'), false);
  one('a control character or space is refused', [P('/health\u0000x'), P('/health\u007fx'), P('/health x'), P('/health\tx'), P('/health\\x')], [false, false, false, false, false]);
  one('a scheme, a protocol-relative URL and userinfo are refused', [P('/https://evil.example/x'), P('//evil.example/health'), P('/@evil.example/health')], [false, false, false]);
  one('a non-string and a bare word are refused', [P(undefined), P(null), P(7), P('health'), P('')], [false, false, false, false, false]);
  one('a query string may carry percent-encoding and dots', P('/archive/query?team=St.%20Louis&date=2026-11-01..2026-11-02'), true);
  one('a route of 300 characters is read, one of 301 is refused', [P('/health?x=' + 'a'.repeat(290)), P('/health?x=' + 'a'.repeat(291))], [true, false]);
  one('routes are split on whitespace and de-duplicated', parseRoutes('/health /budget/odds\n/health  /archive/query?team=x'), ['/health', '/budget/odds', '/archive/query?team=x']);
  one('a comma inside a query value does not split the route', parseRoutes('/archive/query?sport=nba,nhl&limit=5'), ['/archive/query?sport=nba,nhl&limit=5']);
  one('an empty list is empty', parseRoutes(''), []);
  one('parseRoutes does not drop routes silently: 50 in, 50 out (the caller refuses the excess)', parseRoutes(Array.from({ length: 50 }, (_, i) => `/health?i=${i}`).join(' ')).length, 50);
  one('a non-string is an empty list', [parseRoutes(undefined), parseRoutes(null), parseRoutes(7)], [[], [], []]);
  const H = new Map([['content-type', 'application/json'], ['cf-cache-status', 'HIT'], ['set-cookie', 'secret']]);
  const e1 = entryFrom('/x', 200, H, '{"a":1}', 12);
  one('a JSON body is parsed', [e1.json, e1.body, e1.ok, e1.bytes], [true, { a: 1 }, true, 7]);
  one('only the listed headers are kept', Object.keys(e1.headers).sort(), ['cf-cache-status', 'content-type']);
  one('a text body stays text', entryFrom('/x', 200, new Map(), 'unauthorized', 1).body, 'unauthorized');
  one('a non-2xx is not ok and keeps its status', [entryFrom('/x', 401, new Map(), 'unauthorized', 1).ok, entryFrom('/x', 401, new Map(), 'unauthorized', 1).status], [false, 401]);
  one('ok is exactly 2xx: 199 and 300 and 302 and 399 and 400 are not', [199, 200, 299, 300, 302, 399, 400].map((c) => entryFrom('/x', c, new Map(), '{}', 1).ok), [false, true, true, false, false, false, false]);
  one('a zero-byte body is flagged empty; a one-byte body is not', [entryFrom('/x', 200, new Map(), '', 1).empty, entryFrom('/x', 200, new Map(), '1', 1).empty], [true, false]);
  one('a redirect keeps its Location, so the artifact says where it pointed', entryFrom('/x', 302, new Map([['location', 'https://elsewhere.example/x']]), '', 1).headers, { location: 'https://elsewhere.example/x' });
  const big = 'x'.repeat(MAX_BODY + 10);
  const e2 = entryFrom('/x', 200, new Map(), big, 1);
  one('a big body is truncated and says so, with the real size', [e2.truncated, e2.body.length, e2.bytes, e2.json], [true, MAX_BODY, MAX_BODY + 10, false]);
  const euro = entryFrom('/x', 200, new Map(), '\u20ac'.repeat(100000), 1);
  one('the cap counts BYTES: 100000 three-byte characters are 300000 bytes, truncated, and what is kept fits', [euro.bytes, euro.truncated, Buffer.byteLength(euro.body, 'utf8') <= MAX_BODY], [300000, true, true]);
  const nested = '['.repeat(2000) + ']'.repeat(2000);
  const en = entryFrom('/x', 200, new Map(), nested, 1);
  const deep = entryFrom('/x', 200, new Map(), '['.repeat(20000) + ']'.repeat(20000), 1);
  one('a body that nests 2000 deep is kept as JSON and the artifact line stays small; one 20000 deep does not throw and is kept as text', [en.json, serialize({ entries: [en] }).length < 50000, deep.json, typeof deep.body], [true, true, false, 'string']);
  const grows = '[' + '1e9,'.repeat(60000) + '1e9]';
  const eg = entryFrom('/x', 200, new Map(), grows, 1);
  one('a JSON body under the cap that would serialise over it (1e9 becomes 1000000000) is kept as text', [Buffer.byteLength(grows) < MAX_BODY, JSON.stringify(JSON.parse(grows)).length > MAX_BODY, eg.json, typeof eg.body], [true, true, false, 'string']);
  const rt = { label: 'l', summary: { a: 1 }, entries: [e1, entryFrom('/y', 404, new Map(), 'no', 2)] };
  one('serialize round-trips through JSON.parse and keeps one entry per line', [JSON.stringify(JSON.parse(serialize(rt))) === JSON.stringify(rt), serialize(rt).split('\n').filter((l) => l.startsWith('  {')).length], [true, 2]);
  const failing = await readRoute('/health', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
  one('a request that throws is an entry with the reason, not a crash', [failing.ok, failing.status, failing.error], [false, null, 'ECONNREFUSED']);
  let sent = null;
  await readRoute('/health', async (u, o) => { sent = { u, h: o.headers, m: o.method, r: o.redirect }; return { status: 200, headers: new Map(), text: async () => '{}' }; });
  one('the method is GET and the URL is the relay\'s', [sent.m, sent.u.startsWith(RELAY + '/health')], ['GET', true]);
  one('no credential is sent: no header carries the relay secret, whatever the environment holds', Object.keys(sent.h).some((k) => /relay|auth|secret|key|token/i.test(k)), false);
  one('redirects are not followed (a redirect must not take the request to another host)', sent.r, 'manual');
  one('every allowed path, appended to the relay base, stays on the relay\'s host', ALLOWED.every((p) => new URL(RELAY + p).host === new URL(RELAY).host), true);

  // The whole script as a process, in a temp dir, against a local server that counts requests: refused routes must make NO request, exit 1, and be in the
  // artifact as refused. A look that refused everything must not read as a look. The environment carries a secret and the old override flag: neither may matter.
  const SENTINEL = 'SENTINEL-DO-NOT-SEND-7f3a';
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    if (req.url.startsWith('/analytics/status')) { res.statusCode = 200; return res.end(''); }                     // a 200 with nothing in it
    if (req.url.startsWith('/analytics/degraded')) { res.statusCode = 302; res.setHeader('location', 'http://elsewhere.invalid/x'); return res.end(); } // a redirect that must not be followed
    res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmp = mkdtempSync(path.join(tmpdir(), 'relay-read-'));
  const runIt = (env) => new Promise((resolve) => {
    // The caller's proxy settings must not matter (a runner may export them), and every secret-looking variable carries the sentinel the server looks for in ALL headers.
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: tmp, env: { ...process.env, NODE_USE_ENV_PROXY: '', HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '', NO_PROXY: '127.0.0.1', RELAY_BASE: base, RELAY_SHARED_SECRET: SENTINEL, FIELD_MCP_SECRET: SENTINEL, GITHUB_TOKEN: SENTINEL, GH_TOKEN: SENTINEL, ALLOW_UNLISTED: 'true', ...env } });
    let t = ''; ch.stdout.on('data', (d) => { t += d; }); ch.stderr.on('data', (d) => { t += d; });
    const killer = setTimeout(() => ch.kill('SIGKILL'), env.KILL_MS || 15000);
    ch.on('close', (code) => { clearTimeout(killer); resolve({ status: code, stdout: t }); });
  });
  const artifacts = () => readdirSync(path.join(tmp, 'outbox')).sort().map((f) => JSON.parse(readFileSync(path.join(tmp, 'outbox', f), 'utf8')));
  try {
    const r = await runIt({ ROUTES: '/cfl/odds-probs /debug/x /v2/games?sport=nhl', LABEL: 'self test!' });
    const a1 = artifacts();
    one('an all-refused dispatch exits 1', r.status, 1);
    one('...makes no request at all, even with the old override flag in the environment', hits.length, 0);
    one('...writes one artifact with every route refused and no status or error', [a1.length, a1[0].entries.map((e) => [e.refused === true, 'status' in e, 'error' in e])], [1, [[true, false, false], [true, false, false], [true, false, false]]]);
    one('...the summary says 0 read, 3 refused', [a1[0].summary.read_ok, a1[0].summary.refused, a1[0].summary.failed], [0, 3, 0]);
    one('...the artifact has no allow_unlisted field (there is no such switch)', 'allow_unlisted' in a1[0], false);
    one('...and the label was sanitised', /^self-test-$/.test(a1[0].label), true);
    const r2 = await runIt({ ROUTES: '/health /budget/odds?date=2026-11-01', LABEL: 'ok' });
    one('two allowed routes: exit 0 and exactly two requests', [r2.status, hits.length], [0, 2]);
    one('...and no header of either request carries any secret from the environment, under any name', hits.some((h) => JSON.stringify(h.headers).includes(SENTINEL)), false);
    one('...the query string reaches the relay', hits[1].url, '/budget/odds?date=2026-11-01');
    const r3 = await runIt({ ROUTES: '/health /v2/games?sport=nhl', LABEL: 'mixed' });
    const a3 = artifacts().find((a) => a.label === 'mixed');
    one('one allowed and one refused: the allowed one is read, the refused one is not, and the run is red', [r3.status, hits.length, a3.summary.read_ok, a3.summary.refused], [1, 3, 1, 1]);
    const closed = http.createServer(); await new Promise((r) => closed.listen(0, '127.0.0.1', r)); const closedBase = `http://127.0.0.1:${closed.address().port}`; await new Promise((r) => closed.close(r));
    const r4 = await runIt({ ROUTES: '/health', LABEL: 'down', RELAY_BASE: closedBase });
    one('a route whose port refuses the connection exits 1 as failed, not refused', [r4.status, /FAILED  \/health/.test(r4.stdout)], [1, true]);
    const hung = http.createServer(() => {}); await new Promise((r) => hung.listen(0, '127.0.0.1', r));
    const t0 = Date.now();
    const r7 = await runIt({ ROUTES: '/health', LABEL: 'hung', RELAY_BASE: `http://127.0.0.1:${hung.address().port}`, RELAY_READ_TIMEOUT_MS: '300', KILL_MS: 8000 });
    one('a server that never answers is cut off by the per-route timeout: exit 1 as failed, well inside 8 s', [r7.status, /FAILED  \/health/.test(r7.stdout), Date.now() - t0 < 6000], [1, true, true]);
    hung.closeAllConnections(); hung.close();
    const r8 = await runIt({ ROUTES: '/analytics/status /analytics/degraded', LABEL: 'odd' });
    const a8 = artifacts().find((a) => a.label === 'odd');
    one('an empty 200 is flagged empty and counted among the ok ones; a 302 is not followed, keeps its Location, and fails', [r8.status, a8.entries[0].empty, a8.summary.empty_ok, a8.entries[1].status, a8.entries[1].ok, a8.entries[1].headers.location, hits.filter((h) => h.url.startsWith('/x')).length], [1, true, 1, 302, false, 'http://elsewhere.invalid/x', 0]);
    const hb = hits.length;
    const r10 = await runIt({ ROUTES: '/health', LABEL: 'slash', RELAY_BASE: base + '/' });
    one('a RELAY_BASE with a trailing slash is normalised: the request is /health, not //health', [r10.status, hits.slice(hb).map((h) => h.url)], [0, ['/health']]);
    const r9 = await runIt({ ROUTES: '/health /health /health /budget/odds', LABEL: 'dup' });
    const a9 = artifacts().find((a) => a.label === 'dup');
    one('duplicates are counted, not hidden: 4 submitted, 2 requested, 2 dropped, one request each', [r9.status, a9.submitted, a9.requested, a9.duplicates_dropped, a9.summary.read_ok], [0, 4, 2, 2, 2]);
    const r5 = await runIt({ ROUTES: '', LABEL: 'x' });
    one('no routes exits 2', r5.status, 2);
    const before = hits.length;
    const r6 = await runIt({ ROUTES: Array.from({ length: MAX_ROUTES + 2 }, (_, i) => `/health?i=${i}`).join(' '), LABEL: 'many' });
    const a6 = artifacts().find((a) => a.label === 'many');
    one('routes over the cap are refused visibly, not dropped: MAX_ROUTES read, 2 refused, the run is red, requested says all', [r6.status, hits.length - before, a6.summary.read_ok, a6.summary.refused, a6.requested], [1, MAX_ROUTES, MAX_ROUTES, 2, MAX_ROUTES + 2]);
    one('...the refusal names the cap', /cap of 10/.test(a6.entries[MAX_ROUTES].why), true);
  } finally { srv.close(); rmSync(tmp, { recursive: true, force: true }); }
  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${total}/${total}`);
  console.log(`COVERAGE: the policy over ${NEVER.length} named routes that must be refused and ${sneaky.length} traversal fixtures, the entry shaping, and the process against a local server. It does NOT reach the relay.`);
  process.exit(bad ? 1 : 0);
}

const submitted = (typeof process.env.ROUTES === 'string' ? process.env.ROUTES : '').split(/\s+/).filter(Boolean).length;
const all = parseRoutes(process.env.ROUTES);
const routes = all.slice(0, MAX_ROUTES);
const label = String(process.env.LABEL || 'read').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60) || 'read';
if (!all.length) { console.error('relay-read: ROUTES is empty'); process.exit(2); }
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = { label, stamp, relay: RELAY, submitted, duplicates_dropped: submitted - all.length, requested: all.length, entries: [] };
let refused = 0, failed = 0;
for (const r of routes) {
  const p = routePolicy(r);
  if (!p.ok) { refused++; out.entries.push({ route: r, refused: true, why: p.why }); console.log(`REFUSED  ${r}\n         ${p.why}`); continue; }
  const e = await readRoute(r, fetch);
  if (!e.ok) failed++;
  out.entries.push(e);
  console.log(`${e.ok ? 'OK     ' : 'FAILED '} ${r}  ->  ${e.status === null ? e.error : `HTTP ${e.status}, ${e.bytes} bytes${e.empty ? ' (EMPTY BODY)' : ''}${e.truncated ? ' (TRUNCATED)' : ''}, ${e.ms} ms`}`);
}
for (const r of all.slice(MAX_ROUTES)) { refused++; out.entries.push({ route: r, refused: true, why: `beyond the cap of ${MAX_ROUTES} routes per dispatch` }); console.log(`REFUSED  ${r}\n         beyond the cap of ${MAX_ROUTES} routes per dispatch`); }
out.summary = { submitted, requested: all.length, read_ok: all.length - refused - failed, refused, failed, empty_ok: out.entries.filter((e) => e.ok && e.empty).length };
mkdirSync('outbox', { recursive: true });
const file = `outbox/relay-read-${label}-${stamp}.json`;
writeFileSync(file, serialize(out));
console.log(`\nwrote ${file}: ${out.summary.read_ok} read, ${refused} refused, ${failed} failed, ${out.summary.empty_ok} empty, of ${all.length} requested (${submitted} submitted)`);
// Refused and failed routes make the run red: a look that did not look must not read as a look.
process.exit(refused || failed ? 1 : 0);
