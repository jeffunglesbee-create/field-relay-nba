#!/usr/bin/env node
// Rule 90 for the I/O half of scripts/bsd-next-goal-probe.mjs.
//
// check-bsd-next-goal-probe.mjs proves the ANALYSIS. This proves the RUN: the part that spends a
// vendor's allowance, writes a committed file and holds a secret. It starts a stub vendor on a local
// port, runs the real probe against it (BSD_BASE), and asserts, from what the stub RECEIVED and from the
// files the probe WROTE:
//
//   - the exact requests made on an open slate (18), that every one carried the (trimmed) token, and the
//     dates in them (a 90-day window and yesterday), against the clock
//   - a closed gate makes 3 requests, not 18; a 429 or a 401 stops the run before any body is read;
//     CALL_BUDGET binds exactly and a bad value falls back to 24; no token means no request
//   - a redirect is one request, not twenty; a socket reset, an HTML 502 and a slow vendor (the run
//     deadline) each still leave an artifact
//   - -latest.json advances only on a DEFINITE answer from the endpoint under test
//   - a vendor body that echoes the token never reaches a file, and the run fails loudly
//   - an analysis that throws still leaves the call log
//   - an empty list while matches are in play, and a finished row that is never the in-play pick
//
// WHAT IT DOES NOT COVER: the real vendor (a live run is the only test of that), TLS, and GitHub Actions.
// The stub speaks the documented shape and the real events/live vocabulary, not the real payloads.
//
// SAMPLE-COVERAGE-A (Rule 91): scenarios and assertions are printed; fewer than the minimum cannot pass.
//
// Usage: node scripts/check-bsd-next-goal-probe-run.mjs [--source <probe.mjs>]

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MIN_SCENARIOS = 22;
export const MIN_ASSERTIONS = 102;

const argv = process.argv.slice(2);
const srcIdx = argv.indexOf('--source');
const SOURCE = path.resolve(srcIdx >= 0 ? argv[srcIdx + 1] : 'scripts/bsd-next-goal-probe.mjs');
const TOKEN = 'test-token-0123456789';

const { ngRow, liveRow, finishedRow, page, cnt, THREE } = await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-synthetic.mjs')).href);

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

const LIVE = { count: 5, events: [liveRow({ id: 1 }), liveRow({ id: 2 }), liveRow({ id: 3, league: 8 }), liveRow({ id: 4, minute: 30, wsp: true }), liveRow({ id: 5, minute: 9 })] };
function openRoute(u) {
  const P = u.pathname, q = u.searchParams;
  if (P === '/api/v2/events/live/') return [200, LIVE];
  if (P === '/api/v2/next-goal/calls/') {
    if (q.get('offset')) return [200, page([{ event_id: 7, outcome: 'hit', resolved_at: '2026-01-05T10:00:00Z' }])];
    if (q.get('outcome')) return [200, cnt({ hit: 1100, miss: 380, nogoal: 8, unclear: 2, open: 10 }[q.get('outcome')])];
    if (q.get('date_from')) return [200, cnt(1500)];
    if (q.get('limit') === '200') return [200, page([{ event_id: 1, minute: 12, side: 'home', probability: 0.8, outcome: 'hit', resolved_at: '2026-11-21T19:00:00Z' }])];
    if (q.get('limit') === '1') return [200, cnt(9000)];
  }
  if (P === '/api/v2/next-goal/') {
    if (q.get('calls_only') === 'true') return [200, page([THREE[0], THREE[2]])];
    if (q.get('league_id') === '7') return [200, page([THREE[0], THREE[1]])];
    if (q.get('league_id')) return [200, page([])];
    return [200, page(THREE)];
  }
  const m = P.match(/^\/api\/v2\/next-goal\/(\d+)\/$/);
  if (m) {
    if (m[1] === '1') return [200, { ...THREE[0], available: true }];
    if (m[1] === '4') return [200, { event: { id: 4 }, available: false, reason: 'too_early' }];
    if (m[1] === '9') return [200, { event: { id: 9 }, available: false, reason: 'not_live' }];
    return [200, { event: { id: Number(m[1]) }, available: false, reason: 'too_early' }];
  }
  if (P === '/api/v2/events/') return [200, page([{ ...liveRow({ id: 8 }), status: 'notstarted', period: null }, finishedRow({ id: 9 })])];
  return [404, { detail: 'not found' }];
}
const withRoute = (overrides) => (u) => { for (const [test, out] of overrides) if (test(u)) return typeof out === 'function' ? out(u) : out; return openRoute(u); };
const ngList = (u) => u.pathname === '/api/v2/next-goal/' && !u.searchParams.get('calls_only') && !u.searchParams.get('league_id');
const live = (u) => u.pathname === '/api/v2/events/live/';
const calls = (u) => u.pathname.startsWith('/api/v2/next-goal/calls/');
const ledgerPage = (u) => u.pathname === '/api/v2/next-goal/calls/' && u.searchParams.get('limit') === '200';

async function runProbe({ route = openRoute, token = TOKEN, budget = '', deadline = '', src = null } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    requests.push({ key: u.pathname + u.search, auth: req.headers.authorization ?? null, accept: req.headers.accept ?? null });
    const out = route(u);
    const send = () => {
      if (!Array.isArray(out)) {
        if (out.destroy) { req.socket.destroy(); return; }
        if (out.partial429) { res.writeHead(429, { 'content-type': 'application/json', 'content-length': '300', 'retry-after': '30' }); res.write('{"detail":"par'); setTimeout(() => res.destroy(), 20); return; }
      }
      const [status, body, headers] = out;
      res.writeHead(status, { 'content-type': 'application/json', ...(headers || {}) });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const delay = Array.isArray(out) ? out[3] : out.delay;
    if (delay) setTimeout(send, delay); else send();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngp-run-'));
  if (src !== null) { fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src', 'index.js'), src); }
  const env = { ...process.env, BSD_BASE: base, CALL_BUDGET: budget, RUN_DEADLINE_SECONDS: deadline };
  if (token === null) delete env.BSD_API_TOKEN; else env.BSD_API_TOKEN = token;
  const before = Date.now();
  const child = spawn(process.execPath, [SOURCE], { cwd: dir, env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((r) => child.on('close', r));
  const after = Date.now();
  await new Promise((r) => server.close(r));
  const out = path.join(dir, 'outbox');
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  const stamped = files.filter((f) => /^bsd-next-goal-probe-2.*\.json$/.test(f));
  const result = { code, stdout, stderr, requests, files, before, after,
    latest: files.includes('bsd-next-goal-probe-latest.json') ? read('bsd-next-goal-probe-latest.json') : null,
    stamped, stampedFirst: stamped.length ? read(stamped[0]) : null,
    raw: files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n') };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}
const scenario = async (name, fn) => { scenarios++; try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.stack || e.message}`); } };
const shape = (requests) => requests.map((r) => r.key.replace(/date_from=\d{4}-\d{2}-\d{2}/g, 'date_from=D').replace(/date_to=\d{4}-\d{2}-\d{2}/g, 'date_to=D')).sort();
const dayAgo = (n, t) => new Date(t - n * 864e5).toISOString().slice(0, 10);
const dateIn = (requests, prefix, param) => { const r = requests.find((x) => x.key.startsWith(prefix)); const m = r && r.key.match(new RegExp(`${param}=(\\d{4}-\\d{2}-\\d{2})`)); return m ? m[1] : null; };

const OPEN_18 = [
  '/api/v2/events/?date_from=D&date_to=D&limit=50',
  '/api/v2/events/live/',
  '/api/v2/next-goal/1/', '/api/v2/next-goal/4/', '/api/v2/next-goal/9/',
  '/api/v2/next-goal/?calls_only=true&limit=200',
  '/api/v2/next-goal/?league_id=100008&limit=200',
  '/api/v2/next-goal/?league_id=7&limit=200',
  '/api/v2/next-goal/?limit=200',
  '/api/v2/next-goal/calls/?date_from=D&limit=1',
  '/api/v2/next-goal/calls/?date_from=D&outcome=hit&limit=1',
  '/api/v2/next-goal/calls/?date_from=D&outcome=miss&limit=1',
  '/api/v2/next-goal/calls/?date_from=D&outcome=nogoal&limit=1',
  '/api/v2/next-goal/calls/?date_from=D&outcome=open&limit=1',
  '/api/v2/next-goal/calls/?date_from=D&outcome=unclear&limit=1',
  '/api/v2/next-goal/calls/?limit=1',
  '/api/v2/next-goal/calls/?limit=1&offset=8999',
  '/api/v2/next-goal/calls/?limit=200',
].sort();

await scenario('1 an open slate: the 18 requests, each with the token, the right dates, one artifact, latest advanced', async () => {
  const r = await runProbe({ src: 'const V = { a: { bsdLeagueId: 1 }, b: { bsdLeagueId: 7 }, c: { bsdLeagueId: 12 }, d: { bsdLeagueId: null } };', route: withRoute([[live, [200, LIVE, { ratelimit: '"football";r=7400;t=100', 'content-type': 'application/json' }]], [ngList, (u) => [...openRoute(u).slice(0, 2), { 'x-ratelimit-remaining': '9', 'x-cache-status': 'HIT' }]]]) });
  eq('exit 0', r.code, 0);
  eq('18 requests', r.requests.length, 18);
  eq('every request carried the token and asked for JSON', [r.requests.every((x) => x.auth === `Token ${TOKEN}`), r.requests.every((x) => x.accept === 'application/json')], [true, true]);
  eq('the requests, as a sorted list', shape(r.requests), OPEN_18);
  const d90 = dateIn(r.requests, '/api/v2/next-goal/calls/?date_from=', 'date_from');
  eq('the ledger window starts 90 days before the run (either side of a UTC midnight)', [dayAgo(90, r.before), dayAgo(90, r.after)].includes(d90), true);
  const yd = dateIn(r.requests, '/api/v2/events/?', 'date_from');
  const yd2 = dateIn(r.requests, '/api/v2/events/?', 'date_to');
  eq('the finished list is yesterday, from and to', [[dayAgo(1, r.before), dayAgo(1, r.after)].includes(yd), yd === yd2], [true, true]);
  eq('the artifact names the window it used', r.latest.analysis.ledger.since, d90);
  eq('one stamped artifact and a latest', [r.stamped.length, r.latest !== null], [1, true]);
  eq('the artifact counts its own calls', [r.latest.callsMade, r.latest.callBudget, r.latest.tokenPresent, r.latest.stopped, r.latest.deadlineSeconds, r.latest.analysisError], [18, 24, true, null, 400, null]);
  eq('verdicts', [r.latest.analysis.gate.verdict, r.latest.analysis.idSpace.verdict, r.latest.analysis.filterCallsOnly.verdict, r.latest.analysis.filterLeagueId.verdict], ['OPEN', 'SAME_ID_SPACE', 'HONOURED', 'HONOURED']);
  eq('the no-read reasons came from the real calls', [r.latest.analysis.noReadInPlay.reason, r.latest.analysis.noReadFinished.reason], ['too_early', 'not_live']);
  eq('the ledger reproduction ran', r.latest.analysis.ledger.reproduction.verdict, 'ANSWERED');
  eq('the coverage line is in the artifact, with the in-play denominator', /events\/live: 5 rows, 5 in play, 4 at minute 10\+ \(3 with a read, 1 without\).*calls 18\/24/.test(r.latest.coverageLine), true);
  eq('FIELD league ids come from src/index.js in the working directory', r.latest.analysis.leagues.fieldTrackedLeagueIds, ['1', '7', '12']);
  eq('reached the target and a vendor 200', [r.latest.reachedTarget, r.latest.reachedVendor], [true, true]);
  eq('exactly one verbatim row per endpoint, not a dataset', [r.latest.samples.nextGoalRow.event.id, Array.isArray(r.latest.samples.nextGoalRow), r.latest.samples.callsRow.event_id, r.latest.samples.liveEventRow.id], [1, false, 1, 1]);
  eq('the token is nowhere in any file or output', [r.raw.includes(TOKEN), r.stdout.includes(TOKEN), r.stderr.includes(TOKEN)], [false, false, false]);
  eq('the call log has no response bodies', r.latest.calls.every((c) => !('json' in c)), true);
  eq('the log an operator reads has a line per call, the coverage and the verdicts', [/call 18\/24 /.test(r.stdout), r.stdout.includes('=== COVERAGE ==='), r.stdout.includes('=== VERDICTS ==='), /idSpace=SAME_ID_SPACE/.test(r.stdout)], [true, true, true, true]);
  eq('response header names are recorded', r.latest.responseHeaderNames.includes('content-type'), true);
  eq('the rate-limit headers the vendor sent are kept with their values, other headers are not', [r.latest.analysis.rateLimit.values.ratelimit, r.latest.analysis.rateLimit.values['x-ratelimit-remaining'], r.latest.analysis.rateLimit.headersSeenOnCalls, 'x-cache-status' in r.latest.analysis.rateLimit.values], ['"football";r=7400;t=100', '9', 2, false]);
});

await scenario('2 a closed gate: 3 requests, not 18, and the artifact says GATED', async () => {
  const r = await runProbe({ route: withRoute([[(u) => u.pathname.startsWith('/api/v2/next-goal'), [403, { code: 'unlimited_required', detail: 'Requires Football API Unlimited' }]]]) });
  eq('exit 0 (a gate is a finding)', r.code, 0);
  eq('3 requests: list, live, ledger count', shape(r.requests), ['/api/v2/events/live/', '/api/v2/next-goal/?limit=200', '/api/v2/next-goal/calls/?date_from=D&limit=1'].sort());
  eq('gate verdicts', [r.latest.analysis.gate.verdict, r.latest.analysis.gate.code, r.latest.analysis.gateCalls.verdict], ['GATED', 'unlimited_required', 'GATED']);
  eq('a definite answer: latest advanced', [r.latest !== null, r.latest.reachedTarget, r.latest.callsMade], [true, true, 3]);
});

await scenario('3 a 429 stops the run: nothing follows it, and latest does not advance', async () => {
  const r = await runProbe({ route: withRoute([[(u) => u.pathname === '/api/v2/next-goal/', [429, { detail: 'throttled' }, { 'retry-after': '30' }]]]) });
  eq('exit 0', r.code, 0);
  eq('2 requests (the pair issued together), then none', r.requests.length, 2);
  eq('stopped is recorded on the stamped artifact', r.stampedFirst.stopped, '429');
  eq('the calls that never ran say why', r.stampedFirst.analysis.gateCalls.why, 'run stopped on 429');
  eq('the retry-after header was kept, exactly', r.stampedFirst.analysis.rateLimit.values['retry-after'], '30');
  eq('no definite answer from the target: latest NOT advanced, though events/live answered 200', [r.latest, r.stampedFirst.reachedVendor, r.stampedFirst.reachedTarget], [null, true, false]);
  eq('the gate is RATE_LIMITED', r.stampedFirst.analysis.gate.verdict, 'RATE_LIMITED');
});

await scenario('4 a 401 stops the run and writes no latest', async () => {
  const r = await runProbe({ route: () => [401, { detail: 'Invalid token.' }] });
  eq('exit 0', r.code, 0);
  eq('2 requests then none', r.requests.length, 2);
  eq('stamped artifact kept as evidence, latest NOT advanced', [r.stamped.length, r.latest], [1, null]);
  eq('stopped on 401 and the artifact says so', [r.stampedFirst.stopped, r.stampedFirst.callsMade, r.stampedFirst.analysis.gate.verdict], ['401', 2, 'TOKEN_REFUSED']);
});

await scenario('5 CALL_BUDGET binds exactly, and a bad value falls back to 24', async () => {
  const r = await runProbe({ budget: '3' });
  eq('exactly 3 requests', r.requests.length, 3);
  eq('the artifact says 3 of 3', [r.latest.callsMade, r.latest.callBudget], [3, 3]);
  eq('a call the budget refused is UNKNOWN with the reason', /budget 3 exhausted/.test(JSON.stringify(r.latest.analysis.ledger.gate)), true);
  eq('the refused calls are in the call log as blocked', r.latest.calls.filter((c) => /budget 3 exhausted/.test(c.blocked || '')).length > 0, true);
  for (const bad of ['abc', '0', '-5', '2.5']) {
    const b = await runProbe({ budget: bad });
    eq(`CALL_BUDGET "${bad}" falls back to 24: the run is complete and says 24`, [b.requests.length, b.latest.callBudget], [18, 24]);
  }
});

await scenario('6 no token means no request, and a stamped artifact that says so', async () => {
  for (const [label, token] of [['empty', ''], ['unset', null], ['whitespace only', '  \n ']]) {
    const r = await runProbe({ token });
    eq(`${label}: exit 0, 0 requests, tokenPresent false, no latest`, [r.code, r.requests.length, r.stamped.length, r.latest, r.stampedFirst.tokenPresent, r.stampedFirst.callsMade], [0, 0, 1, null, false, 0]);
    eq(`${label}: the log says the token is absent and every call is blocked, not false`, [/BSD_API_TOKEN absent/.test(r.stdout), r.stampedFirst.analysis.gate.why], [true, 'no BSD_API_TOKEN in env']);
  }
});

await scenario('7 the token: trimmed, never written, and a malformed one is refused before any request', async () => {
  const nl = await runProbe({ token: `${TOKEN}\n` });
  eq('a trailing newline is trimmed: 18 requests, each with the clean token', [nl.requests.length, nl.requests.every((x) => x.auth === `Token ${TOKEN}`)], [18, true]);
  const leak = await runProbe({ route: withRoute([[(u) => u.pathname === '/api/v2/next-goal/', [403, { detail: `Invalid token ${TOKEN}` }]]]) });
  eq('a vendor body that echoes the token: the run fails loudly', leak.code, 1);
  eq('no artifact of any kind', leak.files, []);
  eq('and says why, without the token', [/refusing to write it/.test(leak.stderr), leak.stderr.includes(TOKEN), leak.stdout.includes(TOKEN)], [true, false, false]);
  const enc = await runProbe({ token: 'ab/cd+ef1234xyz', route: withRoute([[(u) => u.pathname === '/api/v2/next-goal/', [403, { detail: 'bad ab%2Fcd%2Bef1234xyz' }]]]) });
  eq('the URL-encoded form of the token is refused too', [enc.code, enc.files], [1, []]);
  const sp = await runProbe({ token: 'abc def ghijk' });
  eq('a token with an interior space is refused before any request, and never printed', [sp.code, sp.requests.length, sp.files, /refusing to send it anywhere/.test(sp.stderr), sp.stderr.includes('abc def'), sp.stdout.includes('abc def')], [1, 0, [], true, false, false]);
});

await scenario('8 events/live as a bare array still joins', async () => {
  const r = await runProbe({ route: withRoute([[live, [200, LIVE.events]]]) });
  eq('exit 0', r.code, 0);
  eq('shape recorded', [r.latest.analysis.live.shape, r.latest.analysis.idSpace.verdict], ['array', 'SAME_ID_SPACE']);
});

await scenario('9 events/live unreadable (500): the run goes on, idSpace and coverage are UNKNOWN, no in-play pick', async () => {
  const r = await runProbe({ route: withRoute([[live, [500, { detail: 'boom' }]]]) });
  eq('exit 0, an artifact, latest advanced (the list answered)', [r.code, r.stamped.length, r.latest !== null], [0, 1, true]);
  eq('17 requests: no no-read pick without a live list', r.requests.length, 17);
  eq('verdicts', [r.latest.analysis.idSpace.why, r.latest.analysis.coverage.why, r.latest.analysis.gateLive.verdict, r.latest.analysis.shape.verdict], ['events/live was not read', 'events/live was not read', 'UPSTREAM_ERROR', 'ANSWERED']);
  eq('the no-read reason is true', r.latest.analysis.noReadInPlay.why, 'events/live was not read');
});

await scenario('10 events/live answers 429: the run stops after the pair, the list verdict stands', async () => {
  const r = await runProbe({ route: withRoute([[live, [429, { detail: 'slow down' }]]]) });
  eq('2 requests then none', r.requests.length, 2);
  eq('stopped 429; the list was OPEN so the target was reached and latest advances', [r.latest.stopped, r.latest.analysis.gate.verdict, r.latest.reachedTarget], ['429', 'OPEN', true]);
  eq('idSpace UNKNOWN', r.latest.analysis.idSpace.verdict, 'UNKNOWN');
});

await scenario('11 a redirect is one request, never twenty', async () => {
  const r = await runProbe({ route: () => [302, '', { location: '/api/v2/next-goal/?limit=200' }] });
  eq('exit 0', r.code, 0);
  eq('3 requests: list, live, ledger count, each answered once', r.requests.length, 3);
  eq('the redirect is a recorded error, not a followed hop', [/redirect|fetch failed/i.test(r.stampedFirst.calls[0].error || r.stampedFirst.calls[1].error || ''), r.stampedFirst.analysis.gate.verdict], [true, 'UNKNOWN']);
  eq('nothing definite: latest NOT advanced', r.latest, null);
});

await scenario('12 a 429 whose body then fails still stops the run', async () => {
  const r = await runProbe({ route: withRoute([[(u) => u.pathname === '/api/v2/next-goal/', { partial429: true }]]) });
  eq('exit 0', r.code, 0);
  eq('2 requests then none: the stop was set before the body was read', r.requests.length, 2);
  eq('stopped 429, the status survived the body error', [r.stampedFirst.stopped, r.stampedFirst.analysis.gate.verdict, typeof r.stampedFirst.analysis.gate.bodyError], ['429', 'RATE_LIMITED', 'string']);
});

await scenario('13 a socket reset on the list, an HTML 502 on events/live: each is recorded, the ledger still decides', async () => {
  const reset = await runProbe({ route: withRoute([[ngList, { destroy: true }]]) });
  eq('exit 0; the list is UNKNOWN with a request error; the ledger answered', [reset.code, reset.stampedFirst.analysis.gate.verdict, /request error/.test(reset.stampedFirst.analysis.gate.why), reset.stampedFirst.analysis.gateCalls.verdict], [0, 'UNKNOWN', true, 'OPEN']);
  eq('a definite answer from the ledger advances latest', reset.latest !== null, true);
  const html = await runProbe({ route: withRoute([[ngList, [502, '<html>bad gateway</html>']]]) });
  eq('an HTML 502: UPSTREAM_ERROR with the body kept, trimmed', [html.stampedFirst.analysis.gate.verdict, html.stampedFirst.analysis.gate.nonJson], ['UPSTREAM_ERROR', '<html>bad gateway</html>']);
});

await scenario('14 the run deadline marks the rest UNKNOWN and still writes the artifact', async () => {
  const r = await runProbe({ deadline: '1', route: withRoute([[(u) => ngList(u) || live(u), (u) => [...openRoute(u), {}, 1400]]]) });
  eq('exit 0', r.code, 0);
  eq('only the two slow calls were made', r.requests.length, 2);
  eq('the rest are blocked by the deadline, and the artifact says so', [r.stampedFirst.deadlineSeconds, r.stampedFirst.calls.filter((c) => /deadline 1 s passed/.test(c.blocked || '')).length > 5, r.stampedFirst.analysis.gateCalls.why], [1, true, 'run deadline 1 s passed']);
  eq('the list answered: a definite target, latest advanced', r.latest !== null, true);
});

await scenario('15 an empty list while matches are in play: the no-read pick is made and coverage answers', async () => {
  const inPlay = { count: 4, events: [finishedRow({ id: 101 }), liveRow({ id: 201, minute: 30 }), liveRow({ id: 202, minute: 70, wsp: true }), liveRow({ id: 203, minute: 5 })] };
  const r = await runProbe({ route: withRoute([[ngList, [200, page([])]], [live, [200, inPlay]]]) });
  eq('exit 0', r.code, 0);
  eq('14 requests: list, live, the in-play pick, finished list and pick, nine ledger calls', r.requests.length, 14);
  eq('the pick is the first unread in-play match at minute 10+', r.requests.some((x) => x.key === '/api/v2/next-goal/201/'), true);
  eq('coverage ANSWERED: 0 of 2 at minute 10+ have a read', [r.latest.analysis.coverage.verdict, r.latest.analysis.coverage.inPlayAtMinute10Plus, r.latest.analysis.coverage.withReadAtMinute10Plus], ['ANSWERED', 2, 0]);
  eq('the pick answered', [r.latest.analysis.noReadInPlay.verdict, r.latest.analysis.noReadInPlay.reason, r.latest.analysis.noReadInPlay.id], ['ANSWERED', 'too_early', 201]);
  eq('no list rows: no filter or one-match calls', [r.requests.some((x) => x.key.includes('calls_only')), r.requests.some((x) => x.key.includes('league_id')), r.requests.some((x) => x.key === '/api/v2/next-goal/1/')], [false, false, false]);
});

await scenario('16 the real feed: a finished row is never the in-play pick, and with every match read nothing is picked', async () => {
  const feed = { count: 3, events: [finishedRow({ id: 101 }), liveRow({ id: 201, minute: 44 }), liveRow({ id: 202, minute: 12 })] };
  const r = await runProbe({ route: withRoute([[ngList, [200, page([ngRow({ id: 201 }), ngRow({ id: 202 })])]], [live, [200, feed]]]) });
  eq('exit 0, 17 requests: no no-read pick', [r.code, r.requests.length], [0, 17]);
  eq('no /next-goal/<finished id>/ request except the yesterday-list pick', r.requests.filter((x) => x.key === '/api/v2/next-goal/101/').length, 0);
  eq('the in-play no-read answer is UNKNOWN, honestly', [r.latest.analysis.noReadInPlay.verdict, /no in-play match without a read/.test(r.latest.analysis.noReadInPlay.why)], ['UNKNOWN', true]);
  eq('coverage: 2 of 2 at minute 10+ have a read', [r.latest.analysis.coverage.inPlayAtMinute10Plus, r.latest.analysis.coverage.withReadAtMinute10Plus, r.latest.analysis.coverage.byClass], [2, 2, { finished: 1, inplay: 2 }]);
});

await scenario('17 an analysis that throws still leaves the call log (a payload nested 8000 deep overflows the date scan)', async () => {
  // If this stops throwing because the scan gained a depth limit, find another way to make `analyse` throw:
  // the try/catch in main() needs a test, since a throw there would erase every call the run made.
  const deep = '{"a":'.repeat(8000) + '1' + '}'.repeat(8000);
  const r = await runProbe({ route: withRoute([[ledgerPage, [200, `{"count":1,"next":null,"previous":null,"results":[{"event_id":1,"x":${deep}}]}`]]]) });
  eq('exit 0 and an artifact', [r.code, r.stamped.length], [0, 1]);
  eq('the error is recorded, the call log is kept, the line says it failed', [typeof r.stampedFirst.analysisError, r.stampedFirst.calls.length >= 17, /^ANALYSIS FAILED/.test(r.stampedFirst.coverageLine)], ['string', true, true]);
  eq('an analysis error is not a result: latest does not advance', [r.latest, r.stampedFirst.reachedTarget], [null, false]);
  eq('the operator log says so', /ANALYSIS_ERROR=/.test(r.stdout), true);
});

await scenario('18 a closed ledger is still tried, a gated list does not skip it', async () => {
  const r = await runProbe({ route: withRoute([[(u) => u.pathname === '/api/v2/next-goal/' , [403, { code: 'unlimited_required' }]], [calls, [200, cnt(0)]]]) });
  eq('list GATED, ledger answered 200 with 0: the ledger count calls follow, no list-dependent calls', [r.stampedFirst.analysis.gate.verdict, r.stampedFirst.analysis.gateCalls.verdict, r.requests.some((x) => x.key.includes('calls_only')), r.requests.some((x) => x.key.includes('outcome=hit'))], ['GATED', 'OPEN', false, true]);
  eq('an empty ledger is not a division by zero', r.stampedFirst.analysis.ledger.reproduction.verdict, 'ANSWERED');
});

await scenario('19 a ledger of one row has no last-offset call, and a ledger of zero none either', async () => {
  const one = await runProbe({ route: withRoute([[(u) => u.pathname === '/api/v2/next-goal/calls/' && u.searchParams.get('limit') === '1' && !u.searchParams.get('outcome') && !u.searchParams.get('date_from') && !u.searchParams.get('offset'), [200, cnt(1)]]]) });
  eq('count 1: no offset call, 17 requests', [one.requests.some((x) => x.key.includes('offset=')), one.requests.length], [false, 17]);
  const zero = await runProbe({ route: withRoute([[(u) => u.pathname === '/api/v2/next-goal/calls/' && u.searchParams.get('limit') === '1' && !u.searchParams.get('outcome') && !u.searchParams.get('date_from') && !u.searchParams.get('offset'), [200, cnt(0)]]]) });
  eq('count 0: no offset call, 17 requests', [zero.requests.some((x) => x.key.includes('offset=')), zero.requests.length], [false, 17]);
});

await scenario('22 a list whose first row has no id gets no one-match call', async () => {
  const r0 = ngRow({ id: 5 }); r0.event.id = null;
  const r = await runProbe({ route: withRoute([[ngList, [200, page([r0])]]]) });
  eq('exit 0, and no /next-goal/null/ request', [r.code, r.requests.some((x) => x.key.includes('/next-goal/null'))], [0, false]);
});

await scenario('21 a row too large to keep as a sample is omitted, not fatal', async () => {
  const r = await runProbe({ route: withRoute([[ledgerPage, [200, page([{ event_id: 1, outcome: 'hit', note: 'x'.repeat(25000) }])]]]) });
  eq('exit 0, an artifact, the answer intact', [r.code, r.stamped.length, r.latest.analysis.ledger.reproduction.verdict], [0, 1, 'ANSWERED']);
  eq('the oversize row is replaced by a note with its size', [/^a row of 250\d\d characters$/.test(r.latest.samples.callsRow.omitted), r.latest.samples.nextGoalRow.event.id], [true, 1]);
  eq('and a deeply nested one likewise', typeof (await runProbe({ route: withRoute([[ledgerPage, [200, `{"count":1,"next":null,"previous":null,"results":[{"event_id":1,"x":${'{"a":'.repeat(8000) + '1' + '}'.repeat(8000)}}]}`]]]) })).stampedFirst.samples.callsRow.omitted, 'string');
});

await scenario('20 the league_id and one-match calls use the list: league by most common, one match by the first row', async () => {
  const rows = [ngRow({ id: 31, league: 12 }), ngRow({ id: 32, league: 7 }), ngRow({ id: 33, league: 12 })];
  const r = await runProbe({ route: withRoute([[ngList, [200, page(rows)]], [live, [200, { count: 3, events: [liveRow({ id: 31, league: 12 }), liveRow({ id: 32 }), liveRow({ id: 33, league: 12 })] }]]]) });
  eq('league 12 is the most common, the control is above the maximum, the first row is asked about', [r.requests.some((x) => x.key === '/api/v2/next-goal/?league_id=12&limit=200'), r.requests.some((x) => x.key === '/api/v2/next-goal/?league_id=100012&limit=200'), r.requests.some((x) => x.key === '/api/v2/next-goal/31/')], [true, true, true]);
});

console.log(`\nscenarios ${scenarios}, assertions ${assertions}, failed ${failed}   (source: ${path.relative(process.cwd(), SOURCE)})`);
if (scenarios < MIN_SCENARIOS) { console.log(`FAIL  only ${scenarios} scenarios ran; MIN_SCENARIOS is ${MIN_SCENARIOS}`); failed++; }
if (assertions < MIN_ASSERTIONS) { console.log(`FAIL  only ${assertions} assertions ran; MIN_ASSERTIONS is ${MIN_ASSERTIONS}`); failed++; }
finished = true;
process.exit(failed === 0 ? 0 : 1);
