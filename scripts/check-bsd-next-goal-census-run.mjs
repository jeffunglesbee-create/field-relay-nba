#!/usr/bin/env node
// Rule 90 for the I/O half of scripts/bsd-next-goal-census.mjs.
//
// check-bsd-next-goal-census.mjs proves the COUNTS. This proves the RUN: the part that spends a vendor's allowance, pages a
// ledger that grows while it is read, reads a store through a relay, holds a secret and writes a committed file. It starts a
// stub vendor and a stub relay on local ports, runs the real census against them (BSD_BASE, RELAY_URL), and asserts, from what
// the stubs RECEIVED and from the files the census WROTE:
//
//   - the exact BSD requests (a count, the pages at offsets 0, 200, 400 ..., a closing count), each with the token, and that
//     a 429 or a 401 stops the run and no token means no request
//   - the relay is asked for a listing, followed by its cursor, and for incidents.json of ledger events only
//   - a ledger that grows while it is paged is de-duplicated and its drift reported; a cap on reads is reported as a cap
//   - a failing second list page, a 404, a 500 and a non-JSON read each leave an artifact that says so
//   - -latest.json advances only on a census that read ledger rows and R2 keys
//   - the artifact holds counts and no event id, team or player, and never the token
//   - an analysis that throws still leaves the call log
//
// WHAT IT DOES NOT COVER: the real vendor and relay (a live run is the only test of those), TLS, and GitHub Actions.
// SAMPLE-COVERAGE-A (Rule 91): scenarios and assertions are printed; fewer than the minimum cannot pass.
//
// Usage: node scripts/check-bsd-next-goal-census-run.mjs [--source <census.mjs>]

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MIN_SCENARIOS = 15;
export const MIN_ASSERTIONS = 62;

const argv = process.argv.slice(2);
const srcIdx = argv.indexOf('--source');
const SOURCE = path.resolve(srcIdx >= 0 ? argv[srcIdx + 1] : 'scripts/bsd-next-goal-census.mjs');
const TOKEN = 'test-token-0123456789';

const { call, goal, ftCapture, liveCapture, htCapture, key, listPage, page, worldKeys, worldCalls, worldReads } =
  await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-census-synthetic.mjs')).href);

let scenarios = 0, assertions = 0, failed = 0;
let finished = false;
process.on('exit', (code) => {
  if (!finished) { console.log(`FAIL  the check did not run to its end (exit ${code}, ${scenarios} scenarios, ${assertions} assertions)`); process.exitCode = 1; }
});
const stable = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
const eq = (label, got, want) => {
  assertions++;
  if (stable(got) !== stable(want)) { failed++; console.log(`FAIL  ${label}\n        got  ${stable(got)}\n        want ${stable(want)}`); }
};
const scenario = async (name, fn) => { scenarios++; try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.stack || e.message}`); } };

// ---- the stub vendor: a newest-first ledger of `total` calls, with optional growth while it is paged
function bsdStub({ rows = worldCalls(), grow = null, fail = null, serve = null, delay = 0 } = {}) {
  const state = { rows: rows.slice(), pagesServed: 0 };
  const route = (u) => {
    if (fail) { const f = fail(u); if (f) return f; }
    if (u.pathname !== '/api/v2/next-goal/calls/') return [404, { detail: 'nf' }];
    const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset'));
    if (limit > 1) { state.pagesServed++; if (grow && state.pagesServed === grow.afterPage) for (let i = 0; i < grow.add; i++) state.rows.unshift(call({ id: 100000 + i, ev: 101 })); }
    const out = [200, { count: state.rows.length, next: null, previous: null, results: state.rows.slice(offset, serve === null ? offset + limit : Math.min(offset + limit, serve)) }];
    if (delay) out.push({}, delay);
    return out;
  };
  return { route, state };
}
// ---- the stub relay: a paged listing and incidents.json reads
function relayStub({ keys = worldKeys(), reads = null, pageSize = 1000, failListPage = null, slowList = 0, redirectList = false } = {}) {
  const table = reads || new Map([...worldReads(), ['109', { status: 200, json: ftCapture([], 0, 0) }]]);
  let served = 0;
  const route = (u) => {
    if (u.pathname === '/bsd/r2/list') {
      served++;
      if (failListPage && served === failListPage) return [500, { error: 'boom' }];
      if (redirectList) return [302, '', { location: '/bsd/r2/list?prefix=bsd%2F&limit=1000' }];
      const cur = u.searchParams.get('cursor'), start = cur ? Number(cur) : 0;
      const end = Math.min(start + Math.min(pageSize, Number(u.searchParams.get('limit') || 1000)), keys.length);
      const out = [200, listPage(keys.slice(start, end), { cursor: end < keys.length ? String(end) : null })];
      if (slowList) out.push({}, slowList);
      return out;
    }
    if (u.pathname === '/bsd/r2/read') {
      const k = String(u.searchParams.get('key'));
      const m = k.match(/^bsd\/[^/]+\/(\d+)\/incidents\.json$/);
      const r = m && table.get(m[1]);
      if (!r) return [404, { error: 'not found', key: k }];
      if (r.status !== 200) return [r.status, { error: 'x' }];
      return [200, typeof r.json === 'string' ? r.json : r.json];
    }
    return [404, { error: 'Unknown BSD route' }];
  };
  return { route };
}

async function serve(route, log) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    log.push({ key: u.pathname + u.search, auth: req.headers.authorization ?? null });
    const out = route(u);
    const send = () => {
      const [status, body, headers] = out;
      res.writeHead(status, { 'content-type': 'application/json', ...(headers || {}) });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (out[3]) setTimeout(send, out[3]); else send();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function runCensus({ bsd = bsdStub(), relay = relayStub(), token = TOKEN, budget = '', readCap = '', deadline = '', src = 'x = { bsdLeagueId: 1 }; y = { bsdLeagueId: 2 };' } = {}) {
  const bsdLog = [], relayLog = [];
  const b = await serve(bsd.route, bsdLog), r = await serve(relay.route, relayLog);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngc-run-'));
  if (src !== null) { fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src', 'index.js'), src); }
  const env = { ...process.env, BSD_BASE: b.base, RELAY_URL: r.base, CALL_BUDGET: budget, READ_CAP: readCap, RUN_DEADLINE_SECONDS: deadline };
  if (token === null) delete env.BSD_API_TOKEN; else env.BSD_API_TOKEN = token;
  const child = spawn(process.execPath, [SOURCE], { cwd: dir, env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((res) => child.on('close', res));
  await new Promise((res) => b.server.close(res)); await new Promise((res) => r.server.close(res));
  const out = path.join(dir, 'outbox');
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  const stamped = files.filter((f) => /^bsd-next-goal-census-2.*\.json$/.test(f));
  const result = { code, stdout, stderr, bsdLog, relayLog, files, stamped, stampedFirst: stamped.length ? read(stamped[0]) : null,
    latest: files.includes('bsd-next-goal-census-latest.json') ? read('bsd-next-goal-census-latest.json') : null,
    raw: files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n') };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}
const reads = (log) => log.filter((x) => x.key.startsWith('/bsd/r2/read')).map((x) => decodeURIComponent(x.key.split('key=')[1])).sort();
const lists = (log) => log.filter((x) => x.key.startsWith('/bsd/r2/list'));
const manyCalls = (n) => Array.from({ length: n }, (_, i) => call({ id: n - i, ev: 101, outcome: 'hit', rm: 55 }));

await scenario('1 an open run: the BSD requests, the relay requests, the counts, one artifact, latest advanced', async () => {
  const r = await runCensus();
  eq('exit 0', r.code, 0);
  eq('3 BSD requests: a count, one page, a closing count, each with the token', [r.bsdLog.map((x) => x.key), r.bsdLog.every((x) => x.auth === `Token ${TOKEN}`)], [['/api/v2/next-goal/calls/?limit=1', '/api/v2/next-goal/calls/?limit=200&offset=0', '/api/v2/next-goal/calls/?limit=1'], true]);
  eq('the relay was listed once, with the whole prefix and the largest page', [lists(r.relayLog).length, lists(r.relayLog)[0].key], [1, '/bsd/r2/list?prefix=bsd%2F&limit=1000']);
  eq('incidents.json was read for the ledger events that have one, and for no other', reads(r.relayLog), [101, 102, 103, 104, 105, 106, 108, 109].map((id) => `bsd/${{ 103: 'mls', 108: 'other' }[id] || 'epl'}/${id}/incidents.json`).sort());
  eq('relay requests carry no token', r.relayLog.every((x) => x.auth === null), true);
  eq('one stamped artifact and a latest', [r.stamped.length, r.latest !== null], [1, true]);
  const a = r.latest.analysis;
  eq('the counts', [a.ledger.verdict, a.ledger.uniqueCalls, a.r2.verdict, a.r2.keys, a.reads.attempted, a.reads.parsed, a.reads.notFound404, a.reads.failedOrBlocked, a.reads.parseFailures, a.reads.capped], ['COMPLETE', 16, 'COMPLETE', 13, 8, 5, 1, 1, 1, false]);
  eq('the funnel', [a.calls.verdict, a.calls.inTrackedLeague, a.calls.withIncidentsKey, a.calls.withFullTimeCapture, a.calls.gradeable, a.calls.gradeableBySlug], ['ANSWERED', 15, 14, 6, 6, { epl: 4, mls: 1, other: 1 }]);
  eq('the tracked league ids were read from src/index.js in the working directory', [a.calls.inTrackedLeague, a.calls.withIncidentsKeyOutsideTrackedLeagues], [15, 1]);
  eq('the artifact says what was asked', [r.latest.bsdCallsMade, r.latest.callBudget, r.latest.readCap, r.latest.readsMade, r.latest.stopped, r.latest.analysisError, r.latest.reachedTarget, r.latest.tokenPresent], [3, 16, 1500, 8, null, null, true, true]);
  eq('the artifact states its deadline', r.latest.deadlineSeconds, 420);
  eq('nothing was left out', r.latest.analysis.calls.partialBecause, []);
  eq('the coverage line is in the artifact and in the log', [r.latest.coverageLine.includes('calls: 6 gradeable of 16'), r.stdout.includes('=== COVERAGE ==='), /gradeable 6 of 16/.test(r.stdout)], [true, true, true]);
  eq('the log has a line per BSD request', [/bsd 1\/16 count_first -> 200/.test(r.stdout), /bsd 3\/16 count_last -> 200/.test(r.stdout)], [true, true]);
  eq('the artifact holds counts: no event id, team, player or ledger row, and never the token', [/Alpha|Beta|"player"|"team"|event_date|score_at_call|"101"|"event_id"/.test(r.raw), r.raw.includes(TOKEN), r.stdout.includes(TOKEN), r.stderr.includes(TOKEN)], [false, false, false, false]);
  eq('the BSD log has no response bodies', r.latest.bsdLog.every((c) => !('json' in c)), true);
});

await scenario('2 a ledger of 450 calls is paged at offsets 0, 200 and 400', async () => {
  const r = await runCensus({ bsd: bsdStub({ rows: manyCalls(450) }) });
  eq('5 BSD requests: a count, three pages, a closing count', r.bsdLog.map((x) => x.key), ['/api/v2/next-goal/calls/?limit=1', '/api/v2/next-goal/calls/?limit=200&offset=0', '/api/v2/next-goal/calls/?limit=200&offset=200', '/api/v2/next-goal/calls/?limit=200&offset=400', '/api/v2/next-goal/calls/?limit=1']);
  eq('450 unique calls over 3 pages, complete', [r.latest.analysis.ledger.uniqueCalls, r.latest.analysis.ledger.pages, r.latest.analysis.ledger.verdict, r.latest.analysis.ledger.duplicates], [450, 3, 'COMPLETE', 0]);
  eq('exactly 200 calls fills a page: the next page is asked for and found empty', (await runCensus({ bsd: bsdStub({ rows: manyCalls(200) }) })).bsdLog.map((x) => x.key.replace('/api/v2/next-goal/calls/', '')), ['?limit=1', '?limit=200&offset=0', '?limit=200&offset=200', '?limit=1']);
});

await scenario('3 a ledger that grows while it is paged: duplicates dropped, the drift reported', async () => {
  const r = await runCensus({ bsd: bsdStub({ rows: manyCalls(450), grow: { afterPage: 2, add: 2 } }) });
  const l = r.latest.analysis.ledger;
  eq('the second page shifted by two: two duplicates, 450 unique calls, drift 2, still complete', [l.duplicates, l.uniqueCalls, l.reportedFirst, l.reportedLast, l.drift, l.verdict], [2, 450, 450, 452, 2, 'COMPLETE']);
  eq('the line says reported 450 then 452', /reported 450 then 452/.test(r.latest.coverageLine), true);
});

await scenario('4 no token: no BSD request, the ledger UNKNOWN, the relay still read, latest not advanced', async () => {
  for (const [label, token] of [['empty', ''], ['unset', null], ['whitespace', ' \n ']]) {
    const r = await runCensus({ token });
    eq(`${label}: exit 0, 0 BSD requests, the ledger UNKNOWN with the reason, no latest`, [r.code, r.bsdLog.length, r.stampedFirst.analysis.ledger.verdict, /no BSD_API_TOKEN/.test(r.stampedFirst.analysis.ledger.why), r.latest, r.stampedFirst.tokenPresent], [0, 0, 'UNKNOWN', true, null, false]);
    eq(`${label}: the relay was listed and no incidents.json was read (no ledger events to want)`, [lists(r.relayLog).length, reads(r.relayLog).length], [1, 0]);
  }
  const bad = await runCensus({ token: 'abc def ghijk' });
  eq('a malformed token is refused before any request and never printed', [bad.code, bad.bsdLog.length, bad.relayLog.length, bad.files, bad.stderr.includes('abc def')], [1, 0, 0, [], false]);
  const nl = await runCensus({ token: `${TOKEN}\n` });
  eq('a trailing newline is trimmed', nl.bsdLog.every((x) => x.auth === `Token ${TOKEN}`) && nl.bsdLog.length === 3, true);
});

await scenario('5 a 429 or a 401 stops the run before the next page', async () => {
  const r429 = await runCensus({ bsd: bsdStub({ rows: manyCalls(450), fail: (u) => (u.searchParams.get('offset') === '200' ? [429, { detail: 'slow' }] : null) }) });
  eq('the 429 on the second page: 3 requests, stopped 429, the ledger PARTIAL with 200 calls, latest not advanced', [r429.bsdLog.length, r429.stampedFirst.stopped, r429.stampedFirst.analysis.ledger.verdict, r429.stampedFirst.analysis.ledger.uniqueCalls, r429.latest, r429.stampedFirst.reachedTarget], [3, '429', 'PARTIAL', 200, null, false]);
  eq('...and the reason names the page', /ledger page 1 answered 429/.test(r429.stampedFirst.analysis.ledger.why), true);
  const r401 = await runCensus({ bsd: bsdStub({ fail: () => [401, { detail: 'bad' }] }) });
  eq('a 401 on the first call: 1 request, stopped 401, the ledger UNKNOWN, no latest', [r401.bsdLog.length, r401.stampedFirst.stopped, r401.stampedFirst.analysis.ledger.verdict, r401.latest], [1, '401', 'UNKNOWN', null]);
  eq('a 403 on the first call: 1 request, the ledger UNKNOWN naming 403, no latest', await (async () => { const r = await runCensus({ bsd: bsdStub({ fail: () => [403, { code: 'unlimited_required' }] }) }); return [r.bsdLog.length, /answered 403/.test(r.stampedFirst.analysis.ledger.why), r.latest]; })(), [1, true, null]);
});

await scenario('6 CALL_BUDGET binds, and a bad value falls back to 16', async () => {
  const r = await runCensus({ bsd: bsdStub({ rows: manyCalls(450) }), budget: '3' });
  eq('3 BSD requests then none; the ledger PARTIAL; the artifact says 3 of 3', [r.bsdLog.filter((x) => x.auth).length, r.stampedFirst.callBudget, r.stampedFirst.analysis.ledger.verdict], [3, 3, 'PARTIAL']);
  for (const bad of ['abc', '0', '-2', '1.5']) {
    const b = await runCensus({ budget: bad });
    eq(`CALL_BUDGET "${bad}" falls back to 16`, [b.latest.callBudget, b.bsdLog.length], [16, 3]);
  }
});

await scenario('7 READ_CAP binds: the cap is reported and the calls it left unread say so', async () => {
  const r = await runCensus({ readCap: '2' });
  eq('2 reads, capped, the line says CAPPED, the census is PARTIAL and latest does not advance', [reads(r.relayLog).length, r.stampedFirst.analysis.reads.capped, /\(CAPPED\)/.test(r.stampedFirst.coverageLine), r.stampedFirst.readCap, r.stampedFirst.analysis.calls.verdict, r.latest], [2, true, true, 2, 'PARTIAL', null]);
  eq('the unread events are counted by reason', (r.stampedFirst.analysis.calls.notGradeableBecause['incidents.json not read (cap or deadline)'] || 0) > 0, true);
  eq('a bad READ_CAP falls back to 1500', (await runCensus({ readCap: 'x' })).stampedFirst.readCap, 1500);
});

await scenario('8 the relay: a listing that needs its cursor, a failing second page, an unlistable relay', async () => {
  const paged = await runCensus({ relay: relayStub({ pageSize: 5 }) });
  eq('13 keys at 5 a page: 3 list requests, the second and third carry the cursor, the listing is complete', [lists(paged.relayLog).length, lists(paged.relayLog)[0].key.includes('cursor='), lists(paged.relayLog)[1].key.includes('cursor=5'), lists(paged.relayLog)[2].key.includes('cursor=10'), paged.latest.analysis.r2.verdict, paged.latest.analysis.r2.keys, paged.latest.analysis.r2.pages], [3, false, true, true, 'COMPLETE', 13, 3]);
  const part = await runCensus({ relay: relayStub({ pageSize: 5, failListPage: 2 }) });
  eq('a failing second page: PARTIAL with the keys so far and the reason; the census still ran and latest does not advance', [part.stampedFirst.analysis.r2.verdict, part.stampedFirst.analysis.r2.keys, part.stampedFirst.analysis.r2.why, part.stampedFirst.analysis.calls.verdict, part.code, part.latest], ['PARTIAL', 5, 'list page 2 answered 500', 'PARTIAL', 0, null]);
  const dead = await runCensus({ relay: relayStub({ failListPage: 1 }) });
  eq('a relay that cannot list: no keys, so nothing definite: latest not advanced, the artifact kept', [dead.latest, dead.stamped.length, dead.stampedFirst.analysis.r2.verdict, dead.stampedFirst.reachedTarget], [null, 1, 'PARTIAL', false]);
});

await scenario('9 a read that answers 404, 500 or something that is not JSON is counted and named', async () => {
  const table = new Map([['101', { status: 200, json: ftCapture([goal(5)], 1, 0) }], ['102', { status: 200, json: 'this is not json' }], ['103', { status: 500 }]]);
  const r = await runCensus({ relay: relayStub({ reads: table }) });
  eq('101 parsed; 102 (200, not JSON) and 103 (500) failed; the rest 404', [r.latest.analysis.reads.parsed, r.latest.analysis.reads.failedOrBlocked, r.latest.analysis.reads.notFound404], [1, 2, 5]);
  eq('the reasons carry the status', [r.latest.analysis.calls.notGradeableBecause['incidents.json read failed (status 500)'], r.latest.analysis.calls.notGradeableBecause['incidents.json read failed (status 200)']], [2, 2]);
  eq('a failed read is an answer: the census is still ANSWERED', r.latest.analysis.calls.verdict, 'ANSWERED');
});

await scenario('10 the run deadline marks the rest blocked and still writes the artifact', async () => {
  const r = await runCensus({ deadline: '1', relay: relayStub({ slowList: 1500 }) });
  eq('exit 0 and an artifact', [r.code, r.stamped.length, r.stampedFirst.deadlineSeconds], [0, 1, 1]);
  eq('the listing was slow, so every read was blocked by the deadline and counted, and the census is PARTIAL', [r.stampedFirst.analysis.reads.failedOrBlocked, r.stampedFirst.analysis.reads.blockedByDeadline, r.stampedFirst.analysis.reads.parsed, reads(r.relayLog).length, r.stampedFirst.analysis.calls.verdict, r.stampedFirst.analysis.calls.partialBecause], [8, 8, 0, 0, 'PARTIAL', ['reads were blocked by the run deadline']]);
});

await scenario('11 an analysis that throws still leaves the call log (a capture of 200,000 incidents overflows the spread in Math.max)', async () => {
  // If this stops throwing because the census gained a loop, find another way to make the analysis throw:
  // the try/catch in main() needs a test, since a throw there would erase every request the run made.
  const huge = `{"incidents":[${'{"type":"goal","minute":1},'.repeat(200000)}{"type":"goal","minute":2}]}`;
  const table = new Map([['101', { status: 200, json: huge }]]);
  const r = await runCensus({ relay: relayStub({ reads: table }) });
  eq('exit 0 and an artifact', [r.code, r.stamped.length], [0, 1]);
  eq('the error is recorded, the log is kept, the line says it failed', [typeof r.stampedFirst.analysisError, r.stampedFirst.bsdLog.length, /^ANALYSIS FAILED/.test(r.stampedFirst.coverageLine)], ['string', 3, true]);
  eq('an analysis error is not a result: latest does not advance', [r.latest, r.stampedFirst.reachedTarget], [null, false]);
  eq('the operator log says so', /ANALYSIS_ERROR/.test(r.stdout), true);
});

await scenario('13 the BSD deadline: a slow vendor leaves a partial ledger and an artifact', async () => {
  const r = await runCensus({ deadline: '1', bsd: bsdStub({ delay: 700 }) });
  eq('exit 0 and an artifact; the closing count was blocked by the deadline', [r.code, r.stamped.length, r.stampedFirst.bsdLog.filter((c) => /deadline 1 s passed/.test(c.blocked || '')).length], [0, 1, 1]);
  eq('the ledger is PARTIAL because its closing count was not read, and latest does not advance', [r.stampedFirst.analysis.ledger.verdict, r.stampedFirst.analysis.ledger.why, r.latest], ['PARTIAL', 'the closing count was not read', null]);
});

await scenario('14 a redirect is one request, never twenty, from the vendor and from the relay', async () => {
  const b = await runCensus({ bsd: bsdStub({ fail: () => [302, '', { location: '/api/v2/next-goal/calls/?limit=1' }] }) });
  eq('the vendor redirects: 1 request, the ledger UNKNOWN, no latest', [b.bsdLog.length, b.stampedFirst.analysis.ledger.verdict, b.latest], [1, 'UNKNOWN', null]);
  const q = await runCensus({ relay: relayStub({ redirectList: true }) });
  eq('the relay redirects: 1 list request, the listing incomplete, no latest', [lists(q.relayLog).length, q.stampedFirst.analysis.r2.verdict, q.latest], [1, 'PARTIAL', null]);
});

await scenario('15 a ledger that serves fewer rows than it reports, and a closing count that fails', async () => {
  const short = await runCensus({ bsd: bsdStub({ rows: manyCalls(450), serve: 250 }) });
  eq('250 unique calls of 450 reported: PARTIAL with the reason, no latest', [short.stampedFirst.analysis.ledger.verdict, short.stampedFirst.analysis.ledger.why, short.latest], ['PARTIAL', '250 unique rows of 450 reported', null]);
  let n = 0;
  const noClose = await runCensus({ bsd: bsdStub({ fail: (u) => (u.searchParams.get('limit') === '1' && ++n === 2 ? [500, {}] : null) }) });
  eq('a failing closing count: the ledger is PARTIAL with that reason (a ledger not known to be stable is not complete)', [noClose.stampedFirst.analysis.ledger.verdict, noClose.stampedFirst.analysis.ledger.why, noClose.latest], ['PARTIAL', 'the closing count was not read', null]);
});

await scenario('12 only the ledger\'s events are read, an id under two slugs is read once, and a listing with unparsable keys is not fatal', async () => {
  const keys = [...worldKeys(), key('epl', 999), key('mls', 101, 'incidents.json'), { key: 'bsd/odds/', size: 1, uploaded: 'x' }];
  const r = await runCensus({ relay: relayStub({ keys }) });
  eq('an R2 event that is not in the ledger is never read', reads(r.relayLog).some((k) => k.includes('/999/')), false);
  eq('event 101 under two slugs is read once, through the first slug listed', reads(r.relayLog).filter((k) => k.includes('/101/')), ['bsd/epl/101/incidents.json']);
  eq('the unparsable keys are counted and the id under two slugs is reported', [r.latest.analysis.r2.keysNotMatchingTheLayout, r.latest.analysis.r2.idsUnderMoreThanOneSlug], [3, 1]);
});

console.log(`\nscenarios ${scenarios}, assertions ${assertions}, failed ${failed}   (source: ${path.relative(process.cwd(), SOURCE)})`);
if (scenarios < MIN_SCENARIOS) { console.log(`FAIL  only ${scenarios} scenarios ran; MIN_SCENARIOS is ${MIN_SCENARIOS}`); failed++; }
if (assertions < MIN_ASSERTIONS) { console.log(`FAIL  only ${assertions} assertions ran; MIN_ASSERTIONS is ${MIN_ASSERTIONS}`); failed++; }
finished = true;
process.exit(failed === 0 ? 0 : 1);
