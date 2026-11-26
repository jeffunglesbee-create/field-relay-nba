#!/usr/bin/env node
// Check for scripts/espn-reference-grade.mjs: the REAL runner is run against a stub vendor (BSD), a stub relay (the R2 captures and /context/date) and a
// stub ESPN, with the laboratory's REAL cores (--lab DIR). Every assertion is read off what the stubs received and what the runner wrote. Expected
// values are derived by hand from the world below.
//   node scripts/check-espn-reference-grade-run.mjs --lab lab [--source scripts/espn-reference-grade.mjs] [--fail-fast]
// scripts/mutate-espn-reference-grade.mjs aims --source at broken copies and requires this check to go red.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const FAIL_FAST = argv.includes('--fail-fast');
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const SOURCE = path.resolve(flag('--source', 'scripts/espn-reference-grade.mjs'));
const LAB = path.resolve(flag('--lab', 'lab'));
const TOKEN = 'test-token-0123456789';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// The exit hook is registered BEFORE the imports: a runner that exits at import time must not be able to end this check green.
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

if (!fs.existsSync(path.join(LAB, 'scripts/espn-reference-grade-core.mjs'))) { console.log(`FAIL  no laboratory checkout at ${LAB} (looked for scripts/espn-reference-grade-core.mjs); pass --lab DIR`); process.exit(1); }
const lab = await import(pathToFileURL(path.join(LAB, 'scripts/fixtures/bsd-next-goal-grade-synthetic.mjs')).href);
const { call, key, listPage } = await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-census-synthetic.mjs')).href);
const { REASONS: CORE } = await import(pathToFileURL(path.join(LAB, 'scripts/espn-reference-grade-core.mjs')).href);

// ---- the world: seven ledger calls on six matches, each landing somewhere different
const AT = '2026-10-25T20:00:00Z';
const gcall = (o) => ({ ...call({ id: o.id, ev: o.ev, outcome: o.outcome, rm: o.rm, league: o.league, at: AT }), side: o.side, score_at_call: o.score || { home: 0, away: 0 } });
const calls = () => [
  gcall({ id: 1, ev: 77201, league: 1, side: 'home', outcome: 'hit', rm: 20 }),                          // epl: ESPN's first goal is home's: agree
  gcall({ id: 2, ev: 77201, league: 1, side: 'home', outcome: 'hit', rm: 55, score: { home: 1, away: 0 } }),   // ESPN's second goal is away's: miss against a ledger hit: disagree
  gcall({ id: 3, ev: 77202, league: 2, side: 'away', outcome: 'miss', rm: 30 }),                         // mls: ESPN's first goal is home's, so away is a miss, the ledger says miss: agree (the only call that is not home and hit)
  gcall({ id: 4, ev: 77203, league: 1, side: 'home', outcome: 'hit', rm: 10 }),                          // eflchamp: no archive row
  gcall({ id: 5, ev: 77204, league: 2, side: 'home', outcome: 'hit', rm: 10 }),                          // laliga: a row, no ESPN id
  gcall({ id: 6, ev: 77205, league: 1, side: 'home', outcome: 'hit', rm: 10 }),                          // seriea: ESPN answers 404
  gcall({ id: 7, ev: 77206, league: 2, side: 'home', outcome: 'hit', rm: 10 }),                          // bundesliga: ESPN's final score differs from the capture's
];
const cap = (id, steps, final) => lab.capture(lab.timeline(steps), { eventId: id, final });
const CAPS = { 77201: cap(77201, [['home', 20], ['away', 55]], [1, 1]), 77202: cap(77202, [['home', 30]], [1, 0]), 77203: cap(77203, [['home', 10]], [1, 0]), 77204: cap(77204, [['home', 10]], [1, 0]), 77205: cap(77205, [['home', 10]], [1, 0]), 77206: cap(77206, [['home', 10]], [1, 0]) };
const keys = () => [key('epl', 77201), key('mls', 77202), key('eflchamp', 77203), key('laliga', 77204), key('seriea', 77205), key('bundesliga', 77206)];
const archive = () => new Map([
  ['2026-10-24', []],
  ['2026-10-25', [
    { id: 'r201', sport: 'EPL', bsd_event_id: '77201', espn_event_id: 'E88201' },
    { id: 'r202a', sport: 'MLS', bsd_event_id: '77202', espn_event_id: null }, { id: 'r202b', sport: 'MLS', bsd_event_id: '77202', espn_event_id: 'E88202' },
    { id: 'r204', sport: 'La Liga', bsd_event_id: '77204', espn_event_id: null },
    { id: 'r205', sport: 'Serie A', bsd_event_id: '77205', espn_event_id: 'E88205' },
    { id: 'r206', sport: 'Bundesliga', bsd_event_id: '77206', espn_event_id: 'E88206' },
  ]],
]);
const goal = (team, display, own = false) => ({ scoringPlay: true, ownGoal: own, penaltyKick: false, team: { id: team, displayName: 'SECRET-TEAM' }, clock: { value: 1, displayValue: display }, participants: [{ athlete: { displayName: 'SECRET-PLAYER' } }] });
const summary = (rows, h, a, id) => ({ header: { ...(id === undefined ? {} : { id }), competitions: [{ details: [...rows, { scoringPlay: false, team: { id: 'H' }, clock: { displayValue: "1'" } }],
  competitors: [{ id: 'H', homeAway: 'home', score: String(h), team: { id: 'H', displayName: 'SECRET-TEAM' } }, { id: 'A', homeAway: 'away', score: String(a), team: { id: 'A', displayName: 'SECRET-TEAM' } }] }] } });
const espnWorld = () => ({
  E88201: [200, summary([goal('H', "20'"), goal('A', "55'")], 1, 1, 'E88201')],
  E88202: [200, summary([goal('H', "30'")], 1, 0)],
  E88205: [404, { code: 404 }],
  E88206: [200, summary([goal('H', "10'"), goal('A', "30'"), goal('H', "70'")], 2, 1)],
});

function bsdStub(rows = calls()) {
  return { route: (u) => {
    if (u.pathname !== '/api/v2/next-goal/calls/') return [404, { detail: 'nf' }];
    const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset'));
    return [200, { count: rows.length, next: null, previous: null, results: rows.slice(offset, offset + limit) }];
  } };
}
function relayStub({ days = archive(), answer = null, keyList = keys(), caps = CAPS } = {}) {
  return { route: (u) => {
    if (u.pathname === '/bsd/r2/list') return [200, listPage(keyList, {})];
    if (u.pathname === '/bsd/r2/read') { const m = String(u.searchParams.get('key')).match(/^bsd\/[^/]+\/(\d+)\/incidents\.json$/); const r = m && caps[m[1]]; return r ? [200, r] : [404, { error: 'not found' }]; }
    const m = u.pathname.match(/^\/context\/date\/(\d{4}-\d{2}-\d{2})$/);
    if (m) { if (answer) { const a = answer(m[1]); if (a) return a; } return days.has(m[1]) ? [200, { ok: true, date: m[1], games: { regular: days.get(m[1]), postseason: [] } }] : [404, { error: 'no day' }]; }
    return [404, { error: 'Unknown route' }];
  } };
}
function espnStub(world) {
  return { route: (u) => {
    const m = u.pathname.match(/^\/([^/]+)\/summary$/);
    const ev = u.searchParams.get('event');
    if (!m || ev === null) return [404, { error: 'nope' }];
    const w = world[ev];
    return w === undefined ? [404, { code: 404 }] : w;
  } };
}
async function serve(route, log) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    log.push({ path: u.pathname, query: u.search, event: u.searchParams.get('event'), t: Date.now() });
    const out = route(u);
    if (out === null) return;   // a server that never answers
    res.writeHead(out[0], { 'content-type': 'application/json', ...(out[2] || {}) });
    res.end(typeof out[1] === 'string' ? out[1] : JSON.stringify(out[1]));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function run({ bsd = bsdStub(), relay = relayStub(), espn = espnStub(espnWorld()), token = TOKEN, labDir = LAB, env = {}, actions = false, labSha = 'a'.repeat(40) } = {}) {
  const bsdLog = [], relayLog = [], espnLog = [];
  const b = await serve(bsd.route, bsdLog), r = await serve(relay.route, relayLog), e = await serve(espn.route, espnLog);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erg-run-'));
  const childEnv = { ...process.env, BSD_BASE: b.base, RELAY_URL: r.base, ESPN_BASE: e.base, ESPN_SPACING_MS: '0', ESPN_TIMEOUT_MS: '', READ_CAP: '', CALL_BUDGET: '', RUN_DEADLINE_SECONDS: '', FETCH_TIMEOUT_SECONDS: '', DAY_CAP: '', ESPN_READ_CAP: '', LAB_DIR: labDir, ...env };
  if (actions) { childEnv.GITHUB_ACTIONS = 'true'; childEnv.GITHUB_SHA = 'f'.repeat(40); childEnv.GITHUB_RUN_ID = '4242'; } else { delete childEnv.GITHUB_ACTIONS; delete childEnv.GITHUB_SHA; delete childEnv.GITHUB_RUN_ID; }
  if (labSha === null) delete childEnv.LAB_SHA; else childEnv.LAB_SHA = labSha;
  if (labDir === null) delete childEnv.LAB_DIR;
  if (token === null) delete childEnv.BSD_API_TOKEN; else childEnv.BSD_API_TOKEN = token;
  const child = spawn(process.execPath, [SOURCE], { cwd: dir, env: childEnv });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const killer = setTimeout(() => child.kill('SIGKILL'), 25000);
  const code = await new Promise((res) => child.on('close', res));
  clearTimeout(killer);
  for (const s of [b, r, e]) s.server.closeAllConnections();
  await Promise.all([b, r, e].map((s) => new Promise((res) => s.server.close(res))));
  const out = path.join(dir, 'outbox');
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const stamped = files.filter((f) => /^espn-reference-grade-2.*\.json$/.test(f));
  const art = stamped.length ? JSON.parse(fs.readFileSync(path.join(out, stamped[0]), 'utf8')) : null;
  const raw = files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, stdout, stderr, bsdLog, relayLog, espnLog, files, art, latest: files.includes('espn-reference-grade-latest.json'), raw };
}
const sums = (r) => [r.bsdLog.length, r.relayLog.length, r.espnLog.length];

await scenario('a complete run', async () => {
  const r = await run();
  const a = r.art, g = a.grade;
  eq('exit 0, a stamped artifact and -latest.json', [r.code, r.files.length, r.latest], [0, 2, true]);
  eq('reached its target, stopped nowhere', [a.reachedTarget, a.notReachedBecause, a.stopped], [true, null, null]);
  eq('seven calls on six matches', [a.calls, a.matches], [7, 6]);
  eq('3 graded (2 agree, 1 disagree), 4 not applicable, every call placed once', [g.population, g.graded, g.agree, g.disagree, g.notApplicable.total, g.partitions], [7, 3, 2, 1, 4, true]);
  eq('each not-applicable call under its own named reason (the reach reasons come from the relay lib, the rest from the core)', g.notApplicable.byReason,
    { 'no ESPN id for the match: eflchamp: no archive row of the league on the call days': 1, 'no ESPN id for the match: rows carry no ESPN id': 1, [CORE.noTimeline]: 1, [CORE.finalDiffers]: 1 });
  eq('reach: four matches reached, and the two that were not say why', a.reachCounts, { reached: 4, 'eflchamp: no archive row of the league on the call days': 1, 'rows carry no ESPN id': 1 });
  eq('ESPN: four summaries read (one for each match reached), 3 answered 200 and 1 answered 404, 3 summaries in the shape, none failed; the event id matched once and was absent twice', [a.espnReads.made, a.espnReads.statuses, a.espnReads.summariesRead, a.espnReads.timelinesRead, a.espnReads.stopped, a.espnReads.capped, a.espnReads.failed, a.espnReads.eventIds], [4, { 200: 3, 404: 1 }, 3, undefined, null, false, 0, { matched: 1, absent: 2 }]);
  eq("ESPN: each summary asked of the league the relay's registry gives its directory, by the id the archive row carried, and no match that was not reached was asked", r.espnLog.map((x) => `${x.path}?event=${x.event}`).sort(), ['/eng.1/summary?event=E88201', '/ger.1/summary?event=E88206', '/ita.1/summary?event=E88205', '/usa.1/summary?event=E88202']);
  eq('the distances: all three graded calls sit at 0 minutes from the ESPN goal, and BSD\'s own reading of the goal agrees with ESPN on all three', [g.distance, g.agreeByBsdOnGoal], [{ 'agree @ 0': 2, 'disagree @ 0': 1 }, { 'agree / BSD agrees with ESPN': 2, 'disagree / BSD agrees with ESPN': 1 }]);
  eq('by slug: epl 2 graded (1 agree, 1 disagree), mls 1 graded', [g.bySlug.epl, g.bySlug.mls], [{ calls: 2, graded: 2, agree: 1, disagree: 1, notApplicable: 0 }, { calls: 1, graded: 1, agree: 1, disagree: 0, notApplicable: 0 }]);
  eq('the days: two read, both 200, and the census is ANSWERED over 7 gradeable calls', [a.daysNeeded, a.dayReadStatuses, a.census, g.conventions], [2, { 200: 2 }, { verdict: 'ANSWERED', gradeable: 7 }, { none: 3 }]);
  eq('step A: the two matches whose ESPN timeline and capture could be compared are identical', [g.stepA.matchesCompared, g.stepA.identical], [2, 2]);
  eq('the guard: one equal (epl, mls), one differing (bundesliga: capture 1-0, ESPN 2-1)', g.finalGuard, { equal: 2, differs: 1 });
  eq('the coverage line carries every denominator', [/graded 3 of 7 calls on 6 matches/.test(a.coverageLine), /matches 6: reached 4, not reached \[eflchamp: no archive row of the league on the call days 1; rows carry no ESPN id 1\]/.test(a.coverageLine), /ESPN summaries read 3 of 4 reached \(event id matched 1, absent 2, differing 0\); reached matches sharing an ESPN id 0/.test(a.coverageLine), a.sharedEspnIds], [true, true, true, 0]);
  eq('both cores are recorded by the hash of the file that was loaded, and by rule version; the laboratory commit is the one given in LAB_SHA, and the runner commit is absent outside the Actions',
    [a.cores.bsdCoreSha256, a.cores.espnCoreSha256, a.cores.espnCoreRule, a.cores.bsdCoreRule, a.cores.labSha, a.runner.gitSha],
    [sha(path.join(LAB, 'scripts/bsd-next-goal-grade-core.mjs')), sha(path.join(LAB, 'scripts/espn-reference-grade-core.mjs')), g.ruleVersion, (await import(pathToFileURL(path.join(LAB, 'scripts/bsd-next-goal-grade-core.mjs')).href)).RULE_VERSION, 'a'.repeat(40), null]);
  eq('the runner records the hash of itself and of each script it stands on', [a.runner.runnerSha256, a.runner.libSha256, a.runner.censusSha256, a.runner.graderSha256, a.runner.reachSha256],
    [sha(SOURCE), sha('scripts/espn-task0-lib.mjs'), sha('scripts/bsd-next-goal-census.mjs'), sha('scripts/bsd-next-goal-grade.mjs'), sha('scripts/bsd-e2-reach-probe.mjs')]);
  eq('counts only: no token, no team or player name from ESPN or the ledger, no ESPN or BSD event id in the artifact', [r.raw.includes(TOKEN), /SECRET-|Alpha|Beta/.test(r.raw), new RegExp(['77201', '77202', '77203', '77204', '77205', '77206', 'E88201', 'E88202', 'E88205', 'E88206', 'r20[1-6]'].join('|')).test(r.raw)], [false, false, false]);
  eq('the BSD side stayed inside the census budget, and nothing wrote to stderr', [r.bsdLog.length <= 16, r.stderr], [true, '']);
});

await scenario('what is read, and what stops it', async () => {
  const stop = await run({ espn: espnStub({ ...espnWorld(), E88201: [429, { code: 429 }] }) });
  eq('a 429 on an ESPN read stops the run: one read, the rest not read, not reached, no -latest.json', [stop.art.espnReads.stopped, stop.art.espnReads.made, stop.art.reachedTarget, stop.latest, /ESPN answered 429/.test(stop.art.notReachedBecause)], ['429', 1, false, false, true]);
  eq('the reads that were not made are counted as not made', stop.art.espnReads.statuses, { 429: 1, '(not read: stopped)': 3 });
  const capped = await run({ env: { ESPN_READ_CAP: '2' } });
  eq('the ESPN read cap stops the run too: two reads, capped, not reached', [capped.art.espnReads.made, capped.art.espnReads.capped, capped.art.reachedTarget, capped.latest], [2, true, false, false]);
  const forbidden = await run({ espn: espnStub({ ...espnWorld(), E88201: [403, { code: 403 }] }) });
  eq('a 403 on an ESPN read stops the run as a 429 does', [forbidden.art.espnReads.stopped, forbidden.art.espnReads.made, forbidden.art.reachedTarget, forbidden.latest], ['403', 1, false, false]);
  const atCap = await run({ env: { DAY_CAP: '2' } });
  eq('the day cap is inclusive: two days needed, DAY_CAP 2, the run completes', [atCap.art.reachedTarget, atCap.latest, atCap.art.daysNeeded], [true, true, 2]);
  const overCap = await run({ env: { DAY_CAP: '1' } });
  eq('one day under what is needed: no /context/date read, no ESPN read, not reached, no -latest.json', [overCap.relayLog.filter((x) => x.path.startsWith('/context/date')).length, overCap.espnLog.length, overCap.art.reachedTarget, overCap.latest, /over the cap of 1/.test(overCap.art.notReachedBecause)], [0, 0, false, false, true]);
  const bsd429 = await run({ bsd: { route: () => [429, { detail: 'throttled' }] } });
  eq('a 429 from BSD: nothing is read from /context/date or ESPN, the artifact says so, no -latest.json', [bsd429.espnLog.length, bsd429.relayLog.filter((x) => x.path.startsWith('/context/date')).length, bsd429.art.reachedTarget, bsd429.latest, bsd429.art.stopped], [0, 0, false, false, '429']);
  const noDay = await run({ relay: relayStub({ answer: (d) => (d === '2026-10-25' ? [500, { error: 'boom' }] : null) }) });
  eq('a /context/date day that cannot be read: every match is "a day it needs was not read", no ESPN read is made, not reached', [noDay.art.reachCounts, noDay.espnLog.length, noDay.art.reachedTarget], [{ 'a day the match needs was not read': 6 }, 0, false]);
  const noLeague = await run({
    bsd: bsdStub([gcall({ id: 9, ev: 207, league: 1, side: 'home', outcome: 'hit', rm: 10 })]),
    relay: relayStub({ keyList: [key('zzleague', 207)], caps: { 207: cap(207, [['home', 10]], [1, 0]) }, days: new Map([['2026-10-24', []], ['2026-10-25', [{ id: 'r207', sport: 'EPL', bsd_event_id: '207', espn_event_id: 'E207' }]]]) }) });
  eq('a directory the relay registry has no ESPN league for: reached, but no ESPN request is made, it is counted, and the call is not graded', [noLeague.art.reachCounts, noLeague.espnLog.length, noLeague.art.espnReads.statuses, noLeague.art.grade.graded, noLeague.art.grade.notApplicable.byReason], [{ reached: 1 }, 0, { '(no ESPN league for the directory)': 1 }, 0, { [CORE.noTimeline]: 1 }]);
  eq('... and that is a read that did not answer, so the run did not reach its target', [noLeague.art.espnReads.failed, noLeague.art.reachedTarget, noLeague.latest], [1, false, false]);
  const empty = await run({ bsd: bsdStub([]) });
  eq('a ledger with no calls: no /context/date or ESPN read, the artifact says why, no -latest.json', [empty.espnLog.length, empty.relayLog.filter((x) => x.path.startsWith('/context/date')).length, empty.art.reachedTarget, empty.latest, empty.art.notReachedBecause], [0, 0, false, false, 'the census found no gradeable calls']);
  const throttledDay = await run({ relay: relayStub({ answer: (d) => (d === '2026-10-25' ? [429, { ok: true, date: d, games: { regular: archive().get(d), postseason: [] } }] : null) }) });
  eq('a 429 on a /context/date read whose body is still a valid day: the rows are there, the day was throttled, and that is not a result', [throttledDay.art.dayReadStatuses, throttledDay.art.reachedTarget, throttledDay.latest, /day was not read/.test(throttledDay.art.notReachedBecause)], [{ 200: 1, 429: 1 }, false, false, true]);
  const html502 = await run({ espn: espnStub({ ...espnWorld(), E88205: [502, '<html>bad gateway</html>'] }) });
  eq('a 502 whose body is not JSON is a 502, not "200 non-JSON": the status is what it is, and it is a read that did not answer', [html502.art.espnReads.statuses['502'], html502.art.espnReads.statuses['200 non-JSON'], html502.art.espnReads.failed], [1, undefined, 1]);
  const fiveHundred = await run({ espn: espnStub({ ...espnWorld(), E88201: [500, summary([goal('H', "20'"), goal('A', "55'")], 1, 1, 'E88201')] }) });
  eq('a 500 whose body is a valid summary is still a 500: counted as that, not parsed, no timeline, and the run is not a result', [fiveHundred.art.espnReads.statuses['500'], fiveHundred.art.grade.graded, fiveHundred.art.espnReads.failed, fiveHundred.art.reachedTarget, fiveHundred.latest], [1, 1, 1, false, false]);
  const otherEvent = await run({ espn: espnStub({ ...espnWorld(), E88201: [200, summary([goal('H', "20'"), goal('A', "55'")], 1, 1, 'E99999')] }) });
  eq('a summary that says it is for another event is not graded as the match: counted as "200 other event", the event id counted as differing, and the run is not a result', [otherEvent.art.espnReads.statuses['200 other event'], otherEvent.art.espnReads.eventIds, otherEvent.art.grade.graded, otherEvent.art.reachedTarget], [1, { differs: 1, absent: 2 }, 1, false]);
  const numericId = await run({ espn: espnStub({ ...espnWorld(), E88201: [200, summary([goal('H', "20'"), goal('A', "55'")], 1, 1, 88201)] }) });
  eq('an event id that is the number 88201 and not the text E88201 differs from it', [numericId.art.espnReads.eventIds.differs], [1]);
  const sharedDays = archive();
  sharedDays.set('2026-10-25', sharedDays.get('2026-10-25').map((x) => (x.id === 'r205' ? { ...x, espn_event_id: 'E88201' } : x)));
  const shared = await run({ relay: relayStub({ days: sharedDays }) });
  eq('two reached matches that carry one ESPN id are counted as sharing it (both of them), in the artifact and in the line', [shared.art.sharedEspnIds, /reached matches sharing an ESPN id 2/.test(shared.art.coverageLine)], [2, true]);
  const noToken = await run({ token: null });
  eq('no token: the census is not answered, nothing is read from ESPN or /context/date, an artifact says why', [noToken.espnLog.length, noToken.relayLog.filter((x) => x.path.startsWith('/context/date')).length, noToken.art.reachedTarget, /the census is/.test(noToken.art.notReachedBecause)], [0, 0, false, true]);
  const redirect = await run({ espn: espnStub({ ...espnWorld(), E88205: [302, {}, { location: '/ita.1/summary?event=E88201' }] }) });
  eq('a redirect is read as a status and never followed: 302 counted, E88201 asked once', [redirect.art.espnReads.statuses['302'], redirect.espnLog.filter((x) => x.event === 'E88201').length], [1, 1]);
  const html = await run({ espn: espnStub({ ...espnWorld(), E88202: [200, '<html>not json</html>'] }) });
  eq('a 200 that is not JSON is counted as that, and the match has no timeline', [html.art.espnReads.statuses['200 non-JSON'], html.art.grade.notApplicable.byReason[CORE.noTimeline]], [1, 2]);
  const stall = await run({ env: { ESPN_TIMEOUT_MS: '400' }, espn: espnStub({ ...espnWorld(), E88205: null }) });
  eq('an ESPN read that never answers is cut off at the timeout: the run finishes, the others are read, the stall is counted as an error', [stall.code, stall.art.espnReads.made, Object.keys(stall.art.espnReads.statuses).filter((k) => /^error:/.test(k)).length, stall.art.espnReads.statuses['200'], stall.art.reachedTarget, stall.art.espnReads.failed, /answered neither 200 nor 404/.test(stall.art.notReachedBecause)], [0, 4, 1, 3, false, 1, true]);
  const spaced = await run({ env: { ESPN_SPACING_MS: '' } });
  const gaps = spaced.espnLog.slice(1).map((x, i) => x.t - spaced.espnLog[i].t);
  eq('with the default spacing, consecutive ESPN reads are about a second apart (three gaps, each at least 950 ms)', [spaced.espnLog.length, gaps.length, gaps.every((g) => g >= 950)], [4, 3, true]);
  const badEnv = await run({ env: { DAY_CAP: '0' } });
  eq('DAY_CAP 0 is refused before anything is spent', [badEnv.code, sums(badEnv), /DAY_CAP must be a whole number/.test(badEnv.stderr)], [1, [0, 0, 0], true]);
  const badEnv2 = await run({ env: { ESPN_READ_CAP: 'many' } });
  eq('ESPN_READ_CAP "many" is refused before anything is spent', [badEnv2.code, sums(badEnv2), /ESPN_READ_CAP must be a whole number/.test(badEnv2.stderr)], [1, [0, 0, 0], true]);
  const bad = await run({ espn: espnStub({ ...espnWorld(), E88202: [200, { not: 'the summary' }] }) });
  eq('a 200 that is not the summary shape is no timeline, and says so', [bad.art.espnReads.statuses['200 not the summary shape'], bad.art.grade.notApplicable.byReason[CORE.noTimeline]], [1, 2]);
});

await scenario('nothing is spent when the cores are not what the runner needs', async () => {
  const none = await run({ labDir: null });
  eq('no LAB_DIR: exit 1, no request of any kind, and it says why', [none.code, sums(none), /LAB_DIR is not set/.test(none.stderr)], [1, [0, 0, 0], true]);
  const wrong = await run({ labDir: path.join(os.tmpdir(), 'no-such-lab-dir') });
  eq('a LAB_DIR that is not a checkout: exit 1, no request of any kind', [wrong.code, sums(wrong), /does not exist/.test(wrong.stderr)], [1, [0, 0, 0], true]);
  const lacking = fs.mkdtempSync(path.join(os.tmpdir(), 'erg-lab-'));
  fs.mkdirSync(path.join(lacking, 'scripts'));
  fs.copyFileSync(path.join(LAB, 'scripts/bsd-next-goal-grade-core.mjs'), path.join(lacking, 'scripts/bsd-next-goal-grade-core.mjs'));
  fs.writeFileSync(path.join(lacking, 'scripts/espn-reference-grade-core.mjs'), "export const RULE_VERSION = 'x'\nexport function coverageLine () { return 'x' }\n");
  const missing = await run({ labDir: lacking });
  eq('a core that lacks gradeAgainstEspn: exit 1 naming it, no request of any kind', [missing.code, sums(missing), /gradeAgainstEspn/.test(missing.stderr)], [1, [0, 0, 0], true]);
  fs.writeFileSync(path.join(lacking, 'scripts/espn-reference-grade-core.mjs'), "export function coverageLine () { return 'x' }\nexport function gradeAgainstEspn () { return {} }\n");
  const noRule = await run({ labDir: lacking });
  eq('a core without RULE_VERSION: exit 1, no request of any kind', [noRule.code, sums(noRule), /RULE_VERSION/.test(noRule.stderr)], [1, [0, 0, 0], true]);
  const noSha = await run({ actions: true, labSha: null });
  eq('under the Actions a 40-hex LAB_SHA is required: exit 1, no request', [noSha.code, sums(noSha)], [1, [0, 0, 0]]);
  const short = await run({ actions: true, labSha: 'abc1234' });
  eq('a short SHA is not a SHA', [short.code, sums(short)], [1, [0, 0, 0]]);
  const ok = await run({ actions: true, labSha: 'c'.repeat(40) });
  eq('under the Actions with a full SHA: the commit and the run are recorded', [ok.code, ok.art.cores.labSha, ok.art.runner.gitSha, ok.art.runner.runId], [0, 'c'.repeat(40), 'f'.repeat(40), '4242']);
  // The runner adds the sums up again; it does not take the core's `partitions: true` on trust. A fake core returns numbers that are right (and the runner accepts it:
  // the positive control), then each of them wrong in exactly ONE place, so each case is refused by one rule and one only.
  const G = { partitions: true, population: 7, matches: 6, graded: 3, agree: 2, disagree: 1, notApplicable: { total: 4, byReason: { a: 3, b: 1 } },
    bySlug: { epl: { calls: 4, graded: 2, agree: 1, disagree: 1, notApplicable: 2 }, mls: { calls: 3, graded: 1, agree: 1, disagree: 0, notApplicable: 2 } } };
  const fake = (g, line = "'x'") => `export const RULE_VERSION = 'x'\nexport function coverageLine () { return ${line} }\nexport function gradeAgainstEspn () { return ${JSON.stringify(g)} }\n`;
  const withG = (f) => { const g = JSON.parse(JSON.stringify(G)); f(g); return g; };
  const put = (text) => fs.writeFileSync(path.join(lacking, 'scripts/espn-reference-grade-core.mjs'), text);
  put(fake(G));
  const fakeOk = await run({ labDir: lacking });
  eq('a core whose numbers add up is accepted (the positive control for the cases below)', [fakeOk.code, fakeOk.art.reachedTarget, fakeOk.latest], [0, true, true]);
  for (const [name, g, line, why] of [
    ['partitions is false though every number adds up', withG((x) => { x.partitions = false; }), undefined, /does not partition/],
    ['the coverage line is not text', G, '7', /does not partition, or a line that is not text/],
    ['the population is not the census one (3 calls, every sum consistent with 3)', withG((x) => { x.population = 3; x.graded = 1; x.agree = 1; x.disagree = 0; x.notApplicable = { total: 2, byReason: { a: 2 } }; x.bySlug = { epl: { calls: 3, graded: 1, agree: 1, disagree: 0, notApplicable: 2 } }; }), undefined, /is not the census/],
    ['the match count is not the census one (3 matches)', withG((x) => { x.matches = 3; }), undefined, /is not the census/],
    ['graded is not agree plus disagree (4 against 2 + 1)', withG((x) => { x.graded = 4; x.notApplicable = { total: 3, byReason: { a: 3 } }; x.bySlug.epl = { calls: 4, graded: 3, agree: 1, disagree: 1, notApplicable: 1 }; }), undefined, /do not add up/],
    ['the population is not graded plus not applicable (7 against 3 + 5)', withG((x) => { x.notApplicable = { total: 5, byReason: { a: 4, b: 1 } }; x.bySlug.epl = { calls: 4, graded: 2, agree: 1, disagree: 1, notApplicable: 3 }; x.bySlug.mls = { calls: 3, graded: 1, agree: 1, disagree: 0, notApplicable: 2 }; }), undefined, /do not add up/],
    ['the reasons do not add up to not applicable (3 against 4)', withG((x) => { x.notApplicable.byReason = { a: 3 }; }), undefined, /do not add up/],
    ['the reasons are fractions that add up to the right total (2.5 + 1.5)', withG((x) => { x.notApplicable.byReason = { a: 2.5, b: 1.5 }; }), undefined, /do not add up/],
    ['the directories do not add up to the calls (3 against 7)', withG((x) => { x.bySlug.epl.calls = 3; }), undefined, /do not add up/],
    ['the directories do not add up to graded', withG((x) => { x.bySlug.epl.graded = 3; }), undefined, /do not add up/],
    ['the directories do not add up to agree', withG((x) => { x.bySlug.epl.agree = 2; }), undefined, /do not add up/],
    ['the directories do not add up to disagree', withG((x) => { x.bySlug.epl.disagree = 0; }), undefined, /do not add up/],
    ['the directories do not add up to not applicable', withG((x) => { x.bySlug.epl.notApplicable = 1; }), undefined, /do not add up/],
    ['a reason count is text', withG((x) => { x.notApplicable.byReason = { a: '3', b: 1 }; }), undefined, /do not add up/],
    ['a directory entry is a number', withG((x) => { x.bySlug.epl = 4; }), undefined, /do not add up/],
    ['there is no directory table', withG((x) => { delete x.bySlug; }), undefined, /do not add up/],
    ['there is no reason table', withG((x) => { delete x.notApplicable.byReason; }), undefined, /do not add up/],
  ]) {
    put(fake(g, line));
    const r = await run({ labDir: lacking });
    eq(`a core that says partitions: true but ${name}: the artifact is written, it did not reach its target, no -latest.json, and the reason is the right rule's`, [r.code, r.art !== null, r.art && r.art.reachedTarget, r.latest, why.test(r.art && r.art.notReachedBecause)], [0, true, false, false, true]);
  }
  for (const [name, text] of [['throws', "export const RULE_VERSION = 'x'\nexport function coverageLine () { return 'x' }\nexport function gradeAgainstEspn () { throw new Error('boom ' + 'test-token-0123456789') }\n"], ]) {
    fs.writeFileSync(path.join(lacking, 'scripts/espn-reference-grade-core.mjs'), text);
    const r = await run({ labDir: lacking });
    eq(`a core that ${name}: the artifact is still written (the spend is evidence), it did not reach its target, no -latest.json, the token is not in anything`, [r.code, r.art !== null, r.art && r.art.reachedTarget, r.latest, r.raw.includes(TOKEN), r.stderr.includes(TOKEN)], [0, true, false, false, false, false]);
  }
});

finished = true;
console.log(failed === 0 ? `ok ${scenarios} scenarios, ${assertions} assertions` : `${failed} FAILED (${scenarios} scenarios, ${assertions} assertions)`);
process.exit(failed === 0 ? 0 : 1);
