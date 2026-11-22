#!/usr/bin/env node
// Rule 90 for the I/O half of scripts/bsd-next-goal-probe.mjs.
//
// check-bsd-next-goal-probe.mjs proves the ANALYSIS. This proves the RUN: the part that spends a
// vendor's allowance, writes a committed file and holds a secret. It starts a stub vendor on a local
// port, runs the real probe against it (BSD_BASE), and asserts, from what the stub RECEIVED and from the
// files the probe WROTE:
//
//   - the exact requests made on an open slate (18) and that every one carried the token
//   - a closed gate makes 3 requests, not 18, and the artifact says GATED
//   - a 429 or a 401 stops the run; no request follows it
//   - CALL_BUDGET binds exactly, and no token means no request
//   - -latest.json advances only on a run that got a 200
//   - a vendor body that echoes the token never reaches a file, and the run fails loudly
//
// WHAT IT DOES NOT COVER: the real vendor (a live run is the only test of that), TLS, timeouts longer
// than the stub answers in, and GitHub Actions. The stub speaks the documented shape, not the real one.
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

export const MIN_SCENARIOS = 8;
export const MIN_ASSERTIONS = 38;

const argv = process.argv.slice(2);
const srcIdx = argv.indexOf('--source');
const SOURCE = path.resolve(srcIdx >= 0 ? argv[srcIdx + 1] : 'scripts/bsd-next-goal-probe.mjs');
const TOKEN = 'test-token-0123456789';

const { ngRow, liveRow, page, cnt, THREE } = await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-synthetic.mjs')).href);

let scenarios = 0, assertions = 0, failed = 0;
const eq = (label, got, want) => {
  assertions++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
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
  }
  if (P === '/api/v2/events/') return [200, page([{ id: 9, status: 'finished' }, { id: 10, status: 'notstarted' }])];
  return [404, { detail: 'not found' }];
}

async function runProbe({ route = openRoute, token = TOKEN, budget = '' } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    requests.push({ key: u.pathname + u.search, auth: req.headers.authorization ?? null });
    const [status, body, headers] = route(u);
    res.writeHead(status, { 'content-type': 'application/json', ...(headers || {}) });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngp-run-'));
  const child = spawn(process.execPath, [SOURCE], { cwd: dir, env: { ...process.env, BSD_BASE: base, BSD_API_TOKEN: token, CALL_BUDGET: budget } });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((r) => child.on('close', r));
  await new Promise((r) => server.close(r));
  const out = path.join(dir, 'outbox');
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  return { code, stdout, stderr, requests, files, latest: files.includes('bsd-next-goal-probe-latest.json') ? read('bsd-next-goal-probe-latest.json') : null,
    stamped: files.filter((f) => /^bsd-next-goal-probe-2.*\.json$/.test(f)),
    stampedFirst: files.filter((f) => /^bsd-next-goal-probe-2.*\.json$/.test(f)).map(read)[0] ?? null, raw: files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n') };
}
const scenario = async (name, fn) => { scenarios++; try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.stack || e.message}`); } };
const shape = (requests) => requests.map((r) => r.key.replace(/date_from=\d{4}-\d{2}-\d{2}/g, 'date_from=D').replace(/date_to=\d{4}-\d{2}-\d{2}/g, 'date_to=D')).sort();

await scenario('1 an open slate: the 18 requests, each with the token, one artifact, latest advanced', async () => {
  const r = await runProbe();
  eq('exit 0', r.code, 0);
  eq('18 requests', r.requests.length, 18);
  eq('every request carried the token', r.requests.every((x) => x.auth === `Token ${TOKEN}`), true);
  eq('the requests, as a sorted list', shape(r.requests), [
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
  ].sort());
  eq('one stamped artifact and a latest', [r.stamped.length, r.latest !== null], [1, true]);
  eq('the artifact counts its own calls', [r.latest.callsMade, r.latest.callBudget, r.latest.tokenPresent, r.latest.stopped], [18, 24, true, null]);
  eq('verdicts', [r.latest.analysis.gate.verdict, r.latest.analysis.idSpace.verdict, r.latest.analysis.filterCallsOnly.verdict, r.latest.analysis.filterLeagueId.verdict], ['OPEN', 'SAME_ID_SPACE', 'HONOURED', 'HONOURED']);
  eq('the no-read reasons came from the real calls', [r.latest.analysis.noReadInPlay.reason, r.latest.analysis.noReadFinished.reason], ['too_early', 'not_live']);
  eq('the ledger reproduction ran', r.latest.analysis.ledger.reproduction.verdict, 'ANSWERED');
  eq('the coverage line is in the artifact', /calls 18\/24/.test(r.latest.coverageLine), true);
  eq('exactly one verbatim row per endpoint, not a dataset', [r.latest.samples.nextGoalRow.event.id, Array.isArray(r.latest.samples.nextGoalRow)], [1, false]);
  eq('the token is nowhere in any file', r.raw.includes(TOKEN), false);
  eq('the call log has no response bodies', r.latest.calls.every((c) => !('json' in c)), true);
});

await scenario('2 a closed gate: 3 requests, not 18, and the artifact says GATED', async () => {
  const route = (u) => (u.pathname.startsWith('/api/v2/next-goal') ? [403, { code: 'unlimited_required', detail: 'Requires Football API Unlimited' }] : openRoute(u));
  const r = await runProbe({ route });
  eq('exit 0 (a gate is a finding)', r.code, 0);
  eq('3 requests: list, live, ledger count', shape(r.requests), ['/api/v2/events/live/', '/api/v2/next-goal/?limit=200', '/api/v2/next-goal/calls/?date_from=D&limit=1'].sort());
  eq('gate verdicts', [r.latest.analysis.gate.verdict, r.latest.analysis.gate.code, r.latest.analysis.gateCalls.verdict], ['GATED', 'unlimited_required', 'GATED']);
  eq('latest advanced because events/live answered 200', r.latest !== null, true);
  eq('callsMade is 3', r.latest.callsMade, 3);
});

await scenario('3 a 429 stops the run: nothing follows it', async () => {
  const route = (u) => (u.pathname === '/api/v2/next-goal/' ? [429, { detail: 'throttled' }, { 'retry-after': '30' }] : openRoute(u));
  const r = await runProbe({ route });
  eq('exit 0', r.code, 0);
  eq('2 requests (the pair issued together), then none', r.requests.length, 2);
  eq('stopped is recorded', r.latest.stopped, '429');
  eq('the calls that never ran say why', r.latest.analysis.gateCalls.why, 'run stopped on 429');
  eq('the retry-after header was kept', r.latest.calls.length >= 2, true);
});

await scenario('4 a 401 stops the run and writes no latest when nothing returned 200', async () => {
  const r = await runProbe({ route: () => [401, { detail: 'Invalid token.' }] });
  eq('exit 0', r.code, 0);
  eq('2 requests then none', r.requests.length, 2);
  eq('stamped artifact kept as evidence, latest NOT advanced', [r.stamped.length, r.latest], [1, null]);
  eq('stopped on 401 and the artifact says so', [r.stampedFirst.stopped, r.stampedFirst.callsMade], ['401', 2]);
});

await scenario('5 CALL_BUDGET binds exactly', async () => {
  const r = await runProbe({ budget: '3' });
  eq('exactly 3 requests', r.requests.length, 3);
  eq('the artifact says 3 of 3', [r.latest.callsMade, r.latest.callBudget], [3, 3]);
  eq('a call the budget refused is UNKNOWN with the reason', /budget 3 exhausted/.test(JSON.stringify(r.latest.analysis.ledger.gate)), true);
});

await scenario('6 no token means no request, and a stamped artifact that says so', async () => {
  const r = await runProbe({ token: '' });
  eq('exit 0', r.code, 0);
  eq('0 requests', r.requests.length, 0);
  eq('tokenPresent false, no latest', [r.stamped.length, r.latest, r.stampedFirst.tokenPresent], [1, null, false]);
});

await scenario('7 a vendor body that echoes the token never reaches a file', async () => {
  const route = (u) => (u.pathname === '/api/v2/next-goal/' ? [403, { detail: `Invalid token ${TOKEN}` }] : openRoute(u));
  const r = await runProbe({ route });
  eq('the run fails loudly', r.code, 1);
  eq('no artifact of any kind', r.files, []);
  eq('and says why', /refusing to write it/.test(r.stderr), true);
});

await scenario('8 events/live as a bare array still joins', async () => {
  const route = (u) => (u.pathname === '/api/v2/events/live/' ? [200, LIVE.events] : openRoute(u));
  const r = await runProbe({ route });
  eq('exit 0', r.code, 0);
  eq('shape recorded', [r.latest.analysis.live.shape, r.latest.analysis.idSpace.verdict], ['array', 'SAME_ID_SPACE']);
});

console.log(`\nscenarios ${scenarios}, assertions ${assertions}, failed ${failed}   (source: ${path.relative(process.cwd(), SOURCE)})`);
if (scenarios < MIN_SCENARIOS) { console.log(`FAIL  only ${scenarios} scenarios ran; MIN_SCENARIOS is ${MIN_SCENARIOS}`); failed++; }
if (assertions < MIN_ASSERTIONS) { console.log(`FAIL  only ${assertions} assertions ran; MIN_ASSERTIONS is ${MIN_ASSERTIONS}`); failed++; }
process.exit(failed === 0 ? 0 : 1);
