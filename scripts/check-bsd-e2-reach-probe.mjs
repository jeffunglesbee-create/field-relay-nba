#!/usr/bin/env node
// Check for scripts/bsd-e2-reach-probe.mjs: the REAL probe is run against a stub vendor and a stub relay (BSD_BASE, RELAY_URL), and every
// assertion is read off what the stubs received and what the probe wrote. Expected values are derived by hand from the world below.
//   node scripts/check-bsd-e2-reach-probe.mjs [--source scripts/bsd-e2-reach-probe.mjs] [--fail-fast]
// The mutation harness (mutate-bsd-e2-reach-probe.mjs) aims --source at broken copies and requires this check to go red.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const FAIL_FAST = argv.includes('--fail-fast');
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const SOURCE = path.resolve(flag('--source', 'scripts/bsd-e2-reach-probe.mjs'));
const TOKEN = 'test-token-0123456789';

// The exit hook is registered BEFORE the imports: a probe that exits at import time must not end this check green.
let scenarios = 0, assertions = 0, failed = 0, finished = false;
process.on('exit', (code) => {
  if (!finished) { console.log(`FAIL  the check did not run to its end (exit ${code}, ${scenarios} scenarios, ${assertions} assertions)`); process.exitCode = 1; }
});
const stable = (v) => JSON.stringify(v, (k, val) => (val === undefined ? '<<undefined>>' : val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
const eq = (label, got, want) => {
  assertions++;
  if (stable(got) !== stable(want)) { failed++; console.log(`FAIL  ${label}\n        got  ${stable(got)}\n        want ${stable(want)}`); if (FAIL_FAST) { finished = true; process.exit(1); } }
};
const scenario = async (name, fn) => { scenarios++; try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.stack || e.message}`); } };

const { call, key, listPage, ftCapture, goal } = await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-census-synthetic.mjs')).href);
const { matchesOf } = await import(pathToFileURL(SOURCE).href);

// ---- the world: seven ledger calls on six matches, each landing somewhere different
const g = (o) => ({ ...call({ id: o.id, ev: o.ev, outcome: 'hit', rm: 20, league: o.league, at: o.at }), side: 'home' });
const calls = () => [
  g({ id: 1, ev: 201, league: 1, at: '2026-10-25T15:30:00Z' }),   // epl: the archive row has an espn id
  g({ id: 2, ev: 201, league: 1, at: '2026-10-26T00:20:00Z' }),   // the same match, a second call, the next UTC day
  g({ id: 3, ev: 202, league: 2, at: '2026-10-25T20:00:00Z' }),   // mls: the row has a NUMBER bsd id and no espn id
  g({ id: 4, ev: 203, league: 1, at: '2026-11-02T12:00:00Z' }),   // eflchamp: no row anywhere
  g({ id: 5, ev: 204, league: 2, at: '2026-09-12T12:00:00Z' }),   // europa: no row
  g({ id: 6, ev: 205, league: 1, at: '2026-10-25T09:00:00Z' }),   // seriea: no row, after the boundary
  g({ id: 7, ev: 206, league: 1, at: '2026-10-25T10:00:00Z' }),   // laliga: two rows
];
const keys = () => [key('epl', 201), key('mls', 202), key('eflchamp', 203), key('europa', 204), key('seriea', 205), key('laliga', 206)];
const cap = (id) => ({ ...ftCapture([goal(20, true)], 1, 0), event_id: id });
const reads = () => new Map([201, 202, 203, 204, 205, 206].map((id) => [String(id), cap(id)]));
const day = (rows, post) => ({ ok: true, date: 'x', games: post === undefined ? { regular: rows } : { regular: rows, postseason: post } });
const DAYS = () => new Map([
  ['2026-09-11', day([])], ['2026-09-12', day([])], ['2026-10-24', day([])],
  ['2026-10-25', day([
    { id: 'r201', sport: 'EPL', bsd_event_id: '201', espn_event_id: '9001', odds: '{"big":"payload"}' },
    { id: 'r202', sport: 'MLS', bsd_event_id: 202, espn_event_id: null },
    { id: 'r206a', sport: 'La Liga', bsd_event_id: '206', espn_event_id: '9006' },
    { id: 'r206b', sport: 'La Liga', bsd_event_id: '206', espn_event_id: null },
    { id: 'g1', sport: 'golf', bsd_event_id: null, espn_event_id: 'golf_1' },
    { id: 'u1', sport: 'UEFA Champions League', bsd_event_id: null, espn_event_id: '5' },
  ])],
  ['2026-10-26', day([], [])], ['2026-11-01', day([])], ['2026-11-02', day([])],
]);

function bsdStub() {
  const rows = calls();
  return { route: (u) => {
    if (u.pathname !== '/api/v2/next-goal/calls/') return [404, { detail: 'nf' }];
    const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset'));
    return [200, { count: rows.length, next: null, previous: null, results: rows.slice(offset, offset + limit) }];
  } };
}
function relayStub({ days = DAYS(), answer = null } = {}) {
  return { route: (u) => {
    if (u.pathname === '/bsd/r2/list') return [200, listPage(keys(), {})];
    if (u.pathname === '/bsd/r2/read') { const m = String(u.searchParams.get('key')).match(/^bsd\/[^/]+\/(\d+)\/incidents\.json$/); const r = m && reads().get(m[1]); return r ? [200, r] : [404, { error: 'not found' }]; }
    const m = u.pathname.match(/^\/context\/date\/(\d{4}-\d{2}-\d{2})$/);
    if (m) { if (answer) { const a = answer(m[1]); if (a) return a; } return days.has(m[1]) ? [200, days.get(m[1])] : [404, { error: 'no day' }]; }
    return [404, { error: 'Unknown route' }];
  } };
}
async function serve(route, log) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    log.push({ key: u.pathname + u.search });
    const out = route(u);
    const send = () => { res.writeHead(out[0], { 'content-type': 'application/json' }); res.end(typeof out[1] === 'string' ? out[1] : JSON.stringify(out[1])); };
    if (out[3]) setTimeout(send, out[3]); else send();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function run({ bsd = bsdStub(), relay = relayStub(), token = TOKEN, dayCap = '' } = {}) {
  const bsdLog = [], relayLog = [];
  const b = await serve(bsd.route, bsdLog), r = await serve(relay.route, relayLog);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2r-run-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'x = { bsdLeagueId: 1 }; y = { bsdLeagueId: 2 };');
  const env = { ...process.env, BSD_BASE: b.base, RELAY_URL: r.base, READ_CAP: '', CALL_BUDGET: '', RUN_DEADLINE_SECONDS: '', FETCH_TIMEOUT_SECONDS: '', DAY_CAP: dayCap };
  delete env.GITHUB_ACTIONS;
  if (token === null) delete env.BSD_API_TOKEN; else env.BSD_API_TOKEN = token;
  const child = spawn(process.execPath, [SOURCE], { cwd: dir, env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((res) => child.on('close', res));
  b.server.closeAllConnections(); r.server.closeAllConnections();
  await new Promise((res) => b.server.close(res)); await new Promise((res) => r.server.close(res));
  const out = path.join(dir, 'outbox');
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const stamped = files.filter((f) => /^bsd-e2-reach-2.*\.json$/.test(f));
  const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  const result = { code, stdout, stderr, bsdLog, relayLog, files, art: stamped.length ? read(stamped[0]) : null, latest: files.includes('bsd-e2-reach-latest.json'),
    raw: files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n'), dayReads: relayLog.filter((x) => x.key.startsWith('/context/date/')).map((x) => x.key.slice(14)).sort() };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

// ---- matchesOf
await scenario('matchesOf', async () => {
  const it = (key2, slug, at) => ({ key: key2, tags: { slug }, call: { called_at: at } });
  eq('matchesOf: one entry per event, its distinct valid UTC days sorted, a bad date adds no day, a missing slug is kept missing',
    matchesOf([it('1', 'epl', '2026-10-26T00:10:00Z'), it('1', 'epl', '2026-10-25T20:00:00Z'), it('1', 'epl', '2026-10-25T21:00:00Z'), it('2', 'mls', 'garbage'), { key: '3', tags: {}, call: { called_at: '2026-10-25T01:00:00Z' } }]),
    [{ key: '1', slug: 'epl', callDays: ['2026-10-25', '2026-10-26'] }, { key: '2', slug: 'mls', callDays: [] }, { key: '3', slug: undefined, callDays: ['2026-10-25'] }]);
});

// ---- the whole probe
await scenario('a complete run', async () => {
  const r = await run();
  const a = r.art;
  eq('exit 0 and a stamped artifact and -latest.json', [r.code, r.files.length, r.latest], [0, 2, true]);
  eq('reached its target', [a.reachedTarget, a.notReachedBecause], [true, null]);
  eq('seven calls on six matches', [a.calls, a.matches], [7, 6]);
  eq('seven distinct days read, once each, through the relay', r.dayReads, ['2026-09-11', '2026-09-12', '2026-10-24', '2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02']);
  eq('days needed, cap, statuses', [a.daysNeeded, a.dayCap, a.dayReadStatuses], [7, 300, { 200: 7 }]);
  eq('every match placed once: one 2, two or more 1, none 3, unread 0, no day 0', [a.reach.one, a.reach.many, a.reach.zero, a.reach.unread, a.reach.noDay, a.reach.partitions], [2, 1, 3, 0, 0, true]);
  eq('the one-row matches: the epl row has an espn id, the mls row (a number bsd id) has none', a.reach.oneRow, { withEspnId: 1, withoutEspnId: 1 });
  eq('the three zeros each have their named reason', a.reach.zeroReasons, { 'eflchamp: no archive rows': 1, "ucl or europa: archive rows, outside the join's sports": 1, 'other unjoined': 1 });
  eq('by slug', Object.fromEntries(Object.entries(a.reach.bySlug).map(([k, v]) => [k, [v.zero, v.one, v.many]])), { epl: [0, 1, 0], mls: [0, 1, 0], eflchamp: [1, 0, 0], europa: [1, 0, 0], seriea: [1, 0, 0], laliga: [0, 0, 1] });
  eq('the label counts read the rows once each', [a.labels.rows, a.labels.byLabel.EPL, a.labels.byLabel.MLS, a.labels.targetLabelRows['UEFA Champions League'], a.labels.targetLabelRows['EFL Championship']],
    [6, { rows: 1, withBsd: 1, withEspn: 1, withBoth: 1 }, { rows: 1, withBsd: 1, withEspn: 0, withBoth: 0 }, 1, 0]);
  eq('the coverage line carries every denominator', /7 gradeable calls on 6 distinct matches/.test(a.coverageLine) && /one 2 \(with an espn id 1, without 1\), two or more 1, none 3/.test(a.coverageLine) && /days read 7 of 7 needed \(cap 300\)/.test(a.coverageLine), true);
  eq('counts only: no team, no token, no per-match day list or event id as a value, no row payload in the artifact', [/Alpha|Beta/.test(r.raw), r.raw.includes(TOKEN), /"callDays"|"20[1-6]"/.test(r.raw), r.raw.includes('big')], [false, false, false, false]);
  eq('the BSD side stayed inside the census budget and no /context/date read failed', [r.bsdLog.length <= 16, r.stderr], [true, '']);
});

await scenario('a day that cannot be read is unread, never zero', async () => {
  const r = await run({ relay: relayStub({ answer: (d) => (d === '2026-10-25' ? [500, { error: 'boom' }] : null) }) });
  const a = r.art;
  eq('not reached, no -latest.json', [r.code, a.reachedTarget, r.latest], [0, false, false]);
  eq('the matches that needed 10-25 are unread (201, 202, 205, 206), the other two are still placed', [a.reach.unread, a.reach.zero, a.reach.one, a.reach.many], [4, 2, 0, 0]);
  eq('the reason says so, and the 500 is in the status tally', [/matches needed a day that was not read/.test(a.notReachedBecause), a.dayReadStatuses['500']], [true, 1]);
  eq('the coverage line counts the days actually read', /days read 6 of 7 needed/.test(a.coverageLine), true);
});

await scenario('a read that is not the contract is unread', async () => {
  const r = await run({ relay: relayStub({ answer: (d) => (d === '2026-10-24' ? [200, { ok: false }] : null) }) });
  eq('10-24 is needed by four matches; each is unread, none is a zero for it', [r.art.reachedTarget, r.art.reach.unread], [false, 4]);
});

await scenario('the day cap', async () => {
  const over = await run({ dayCap: '3' });
  eq('over the cap: no /context/date read, not reached, says why', [over.dayReads.length, over.art.reachedTarget, /over the cap of 3/.test(over.art.notReachedBecause), over.art.reach], [0, false, true, null]);
  const exact = await run({ dayCap: '7' });
  eq('exactly at the cap: the days are read', [exact.dayReads.length, exact.art.reachedTarget], [7, true]);
});

await scenario('a 429 stops the reads', async () => {
  const slow = DAYS();
  const r = await run({ relay: relayStub({ answer: (d) => (d === '2026-09-11' ? [429, { error: 'slow down' }] : [200, slow.get(d), {}, 250]) }) });
  eq('stopped on 429, not reached, some matches unread', [r.art.dayReadStopped, r.art.reachedTarget, r.art.reach.unread > 0], ['429', false, true]);
  eq('only the four reads already in flight were made: nothing was requested after the 429', r.dayReads.length, 4);
});

await scenario('no gradeable calls', async () => {
  const open = [call({ id: 1, ev: 201, outcome: 'open', rm: null, league: 1 })];
  const r = await run({ bsd: { route: (u) => (u.pathname === '/api/v2/next-goal/calls/' ? [200, { count: 1, next: null, previous: null, results: open }] : [404, {}]) } });
  eq('an empty population never reaches the target', [r.code, r.art.reachedTarget, r.latest, r.dayReads.length, r.art.notReachedBecause], [0, false, false, 0, 'the census found no gradeable calls']);
});

await scenario('no token', async () => {
  const r = await run({ token: null });
  eq('no /context/date read, an artifact that says why, no crash, no -latest.json', [r.dayReads.length, r.code, r.art.reachedTarget, r.art.notReachedBecause === null, r.latest], [0, 0, false, false, false]);
  eq('and the reason is the census, not a thrown analysis', [/the census is/.test(r.art.notReachedBecause), r.art.analysisError], [true, null]);
});

finished = true;
console.log(failed === 0 ? `ok ${scenarios} scenarios, ${assertions} assertions` : `${failed} FAILED (${scenarios} scenarios, ${assertions} assertions)`);
process.exit(failed === 0 ? 0 : 1);
