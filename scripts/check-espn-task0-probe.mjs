#!/usr/bin/env node
// Check for scripts/espn-task0-probe.mjs: the REAL probe is run against a stub ESPN host and a stub relay (ESPN_BASE, RELAY_URL), and
// every assertion is read off what the stubs received and what the probe wrote. Expected values are derived by hand from the world below.
//   node scripts/check-espn-task0-probe.mjs [--source scripts/espn-task0-probe.mjs] [--fail-fast]
// The mutation harness (mutate-espn-task0-probe.mjs) aims --source at broken copies and requires this check to go red.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const FAIL_FAST = argv.includes('--fail-fast');
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const SOURCE = path.resolve(flag('--source', 'scripts/espn-task0-probe.mjs'));
const LIB = path.resolve('scripts/espn-task0-lib.mjs');

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

const { registryFromSource } = await import(pathToFileURL(LIB).href);
const REG = registryFromSource(fs.readFileSync('src/index.js', 'utf8'));
const SLUGS = ['epl', 'mls', 'ucl', 'eflchamp', 'laliga', 'europa', 'seriea', 'bundesliga', 'ligue1'];
const LEAGUE_OF = Object.fromEntries(SLUGS.map((s) => [REG[s], s]));      // espnLeague -> slug, from the relay's own registry text
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

// ---- the world: one finished match per league, built so every rule is exercised once
const goalRows = (o = {}) => [
  { type: { type: 'goal' }, team: o.noTeam ? undefined : { id: o.teamIds ? o.teamIds[0] : '11' }, clock: o.noClock ? undefined : { displayValue: "10'" }, scoringPlay: true, ownGoal: false, penaltyKick: false, text: 'SECRET-PLAYER-TEXT' },
  { type: { type: 'goal---header' }, team: o.noTeam ? undefined : { id: o.teamIds ? o.teamIds[1] : '11' }, clock: o.noClock ? undefined : { displayValue: "50'" }, scoringPlay: true, ownGoal: o.ownGoal === true, penaltyKick: false, text: 'SECRET-PLAYER-TEXT' },
  { type: { type: 'penalty---scored' }, team: o.noTeam ? undefined : { id: '22' }, clock: o.noClock ? undefined : { displayValue: "80'" }, scoringPlay: true, penaltyKick: true, text: 'SECRET-PLAYER-TEXT' },
  { type: { type: 'yellow-card' }, team: { id: '11' }, clock: { displayValue: "30'" } },
  ...(o.fourGoals ? [{ type: { type: 'goal' }, team: { id: '11' }, clock: { displayValue: "90'" }, scoringPlay: true }] : []),
];
const event = (id, date, completed, a, b, details) => ({ id, date, competitions: [{ status: { type: { completed } }, competitors: [{ homeAway: 'home', score: a, team: { id: '11' } }, { homeAway: 'away', score: b, team: { id: '22' } }], details }] });
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
function espnWorld(over = {}) {
  const scoreboard = (slug) => {
    if (over.scoreboard && over.scoreboard[slug]) return over.scoreboard[slug];
    const rows = goalRows(over.rows && over.rows[slug]);
    const noMatch = over.noMatch && over.noMatch.includes(slug);
    return [200, { events: noMatch ? [event('live', ago(0), false, '0', '0', [])]
      : [event('old', ago(9), true, '0', '0', []), event(`E-${slug}`, ago(2), true, '2', '1', rows), event('live', ago(0), false, '1', '0', []), event('noscore', ago(1), true, undefined, undefined, [])] }, { 'cache-control': 'max-age=60' }];
  };
  const summary = (slug) => {
    if (over.summary && over.summary[slug]) return over.summary[slug];
    return [200, { keyEvents: goalRows(over.rows && over.rows[slug]), header: { competitions: [{ details: [] }] }, boxscore: {} }];
  };
  return { scoreboard, summary };
}
const DAYROWS = { ok: true, date: '2026-10-25', games: { regular: [
  { id: 'a', sport: 'MLS', bsd_event_id: '5376', espn_event_id: null }, { id: 'b', sport: 'MLS', bsd_event_id: '5375', espn_event_id: null },
  { id: 'c', sport: 'NBA', bsd_event_id: null, espn_event_id: '401909861' }, { id: 'd', sport: 'EPL', bsd_event_id: '77', espn_event_id: '88' }] } };

async function serve(route, log) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    log.push({ path: u.pathname, query: u.search });
    const out = route(u);
    res.writeHead(out[0], { 'content-type': 'application/json', ...(out[2] || {}) });
    res.end(typeof out[1] === 'string' ? out[1] : JSON.stringify(out[1]));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function run({ world = espnWorld(), day = [200, DAYROWS], source = SOURCE, srcIndex = null } = {}) {
  const espnLog = [], relayLog = [];
  const e = await serve((u) => {
    const m = u.pathname.match(/^\/([^/]+)\/(scoreboard|summary)$/);
    const slug = m && LEAGUE_OF[m[1]];
    if (!slug) return [404, { error: 'no such league' }];
    return world[m[2]](slug, u);
  }, espnLog);
  const r = await serve((u) => (u.pathname === '/context/date/2026-10-25' ? day : [404, { error: 'no' }]), relayLog);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1p-run-'));
  let script = source;
  if (srcIndex !== null) {                                   // a copy of the probe beside a registry text of the test's choosing
    fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'src'));
    script = path.join(dir, 'scripts', 'espn-task0-probe.mjs');
    fs.copyFileSync(source, script); fs.copyFileSync(LIB, path.join(dir, 'scripts', 'espn-task0-lib.mjs'));
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), srcIndex);
  }
  const env = { ...process.env, ESPN_BASE: e.base, RELAY_URL: r.base, ESPN_SPACING_MS: '0' };
  const t0 = new Date();
  const child = spawn(process.execPath, [script], { cwd: dir, env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((res) => child.on('close', res));
  const t1 = new Date();
  e.server.closeAllConnections(); r.server.closeAllConnections();
  await new Promise((res) => e.server.close(res)); await new Promise((res) => r.server.close(res));
  const out = path.join(dir, 'outbox');
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const stamped = files.filter((f) => /^espn-task0-2.*\.json$/.test(f));
  const art = stamped.length ? JSON.parse(fs.readFileSync(path.join(out, stamped[0]), 'utf8')) : null;
  const raw = files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, stdout, stderr, espnLog, relayLog, files, art, latest: files.includes('espn-task0-latest.json'), raw, days: [ymd(t0), ymd(t1)] };
}
const kind = (log, k) => log.filter((x) => x.path.endsWith(`/${k}`));

await scenario('a complete run', async () => {
  const r = await run({ world: espnWorld({ rows: { ucl: { ownGoal: true } } }) });
  const a = r.art;
  eq('exit 0, a stamped artifact and -latest.json', [r.code, r.files.length, r.latest], [0, 2, true]);
  eq('reached its target, stopped nowhere', [a.reachedTarget, a.stopped, a.notReachedBecause], [true, null, null]);
  eq('nine scoreboards, nine summaries, one relay read: nineteen requests in all', [kind(r.espnLog, 'scoreboard').length, kind(r.espnLog, 'summary').length, r.relayLog.length, a.requestCount], [9, 9, 1, 19]);
  const q = r.espnLog.find((x) => x.path.endsWith('/scoreboard')).query;
  const m = /dates=(\d{8})-(\d{8})&limit=300$/.exec(q);
  eq('the window is the 14 days ending today (UTC), at limit 300', [m !== null, m && r.days.includes(m[2]), m && (Date.parse(`${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}`) - Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`)) / 86400000], [true, true, 14]);
  eq('the manifest keeps the status and the cache header of each read', [a.requests.find((x) => x.label === 'scoreboard epl').status, a.requests.find((x) => x.label === 'scoreboard epl').cacheControl], [200, 'max-age=60']);
  eq('the summary read asks for the chosen event, by id', kind(r.espnLog, 'summary')[0].query, '?event=E-epl');
  eq('the most recent finished match WITH a score is chosen, never the older or the unscored one', Object.values(a.leagues).map((l) => l.chosen.espnEventId).sort(), SLUGS.map((s) => `E-${s}`).sort());
  eq('E1 held in all nine, goal rows equalled the final score in all nine, the own goal is seen in ucl only', [a.e1.e1HeldOn.length, a.e1.goalRowsEqualFinalTotalOn.length, a.e1.ownGoalSeenOn], [9, 9, ['ucl']]);
  eq('E1 by list: the summary and the scoreboard both witness it in nine, the header list (empty here) in none', Object.fromEntries(Object.entries(a.e1.heldOnByList).map(([k, v]) => [k, v.length])), { 'scoreboard.competitions[0].details': 9, 'summary.header.competitions[0].details': 0, 'summary.keyEvents': 9 });
  eq('the goal shape of one list', { rows: a.leagues.epl.lists['summary.keyEvents'].shape.rows, goalRows: a.leagues.epl.lists['summary.keyEvents'].shape.goalRows, withTeamId: a.leagues.epl.lists['summary.keyEvents'].shape.withTeamId, teamIdIsACompetitor: a.leagues.epl.lists['summary.keyEvents'].shape.teamIdIsACompetitor, withClock: a.leagues.epl.lists['summary.keyEvents'].shape.withClock },
    { rows: 4, goalRows: 3, withTeamId: 3, teamIdIsACompetitor: 3, withClock: 3 });
  eq('a list the payload does not have is recorded as absent, not as empty', a.leagues.epl.lists['summary.header.competitions[0].details'].shape.rows, 0);
  eq('E2a: the relay read, by label', [a.e2a.status, a.e2a.shapeOk, a.e2a.rows, a.e2a.byLabel.MLS, a.e2a.byLabel.EPL, a.e2a.byLabel.NBA], [200, true, 4, { rows: 2, withBsd: 2, withEspn: 0, withBoth: 0 }, { rows: 1, withBsd: 1, withEspn: 1, withBoth: 1 }, { rows: 1, withBsd: 0, withEspn: 1, withBoth: 0 }]);
  eq('the coverage line carries every denominator', [/9 of 9 league scoreboards answered 200/.test(a.coverageLine), /9 had a finished match/.test(a.coverageLine), /held on 9 of 9/.test(a.coverageLine), /4 rows, 1 with BOTH/.test(a.coverageLine)], [true, true, true, true]);
  eq('no payload text is copied into the artifact, and the ESPN event ids (public) are', [r.raw.includes('SECRET-PLAYER-TEXT'), r.raw.includes('E-epl')], [false, true]);
});

await scenario('a league with no finished match', async () => {
  const r = await run({ world: espnWorld({ noMatch: ['ucl'], rows: { ucl: { ownGoal: true } } }) });
  eq('still reached: its scoreboard answered', [r.art.reachedTarget, r.art.e1.leaguesProbed, r.art.e1.leaguesWithAFinishedMatch], [true, 9, 8]);
  eq('no summary was read for it, and the league is not counted in E1', [kind(r.espnLog, 'summary').length, r.art.e1.e1HeldOn.includes('ucl'), r.art.leagues.ucl.chosen], [8, false, null]);
});

await scenario('a 403 stops the run', async () => {
  const r = await run({ world: espnWorld({ scoreboard: { mls: [403, { error: 'denied' }] } }) });
  eq('stopped on 403: epl scoreboard and summary, then the mls scoreboard, and nothing after', [r.art.stopped, kind(r.espnLog, 'scoreboard').length, kind(r.espnLog, 'summary').length], ['403', 2, 1]);
  eq('not reached, no -latest.json, the reason says so', [r.art.reachedTarget, r.latest, r.art.notReachedBecause], [false, false, 'stopped on 403']);
  eq('the relay read was blocked too, and is not reported as a shape', [r.relayLog.length, r.art.e2a.status], [0, null]);
});

await scenario('a 429 on a summary stops the run', async () => {
  const r = await run({ world: espnWorld({ summary: { epl: [429, { error: 'slow' }] } }) });
  eq('stopped on 429 after the first summary', [r.art.stopped, kind(r.espnLog, 'scoreboard').length, kind(r.espnLog, 'summary').length, r.art.reachedTarget], ['429', 1, 1, false]);
});

await scenario('a scoreboard that is not 200 is not answered, even when its body looks right', async () => {
  const r = await run({ world: espnWorld({ scoreboard: { laliga: [500, { events: [] }] } }) });
  eq('eight probed, not reached, no -latest.json, and the run went on to the other leagues', [r.art.e1.leaguesProbed, r.art.reachedTarget, r.latest, kind(r.espnLog, 'scoreboard').length], [8, false, false, 9]);
  eq('the coverage line does not say nine answered', /8 of 9 league scoreboards answered 200/.test(r.art.coverageLine), true);
});

await scenario('a 200 that is not the shape is not answered', async () => {
  const r = await run({ world: espnWorld({ scoreboard: { seriea: [200, { note: 'no events here' }] } }) });
  eq('eight probed, not reached', [r.art.e1.leaguesProbed, r.art.reachedTarget], [8, false]);
});

await scenario('a redirect is read as a status and never followed', async () => {
  const r = await run({ world: espnWorld({ scoreboard: { mls: [302, {}, { location: `/${REG.epl}/scoreboard` }] } }) });
  eq('mls is not answered: the 302 was not followed', [r.art.leagues.mls.scoreboard.status, r.art.e1.leaguesProbed, r.art.reachedTarget], [302, 8, false]);
});

await scenario('E1 is judged on the goal rows, condition by condition', async () => {
  const r = await run({ world: espnWorld({ rows: { bundesliga: { noTeam: true }, ligue1: { noClock: true }, europa: { teamIds: ['99', '99'] }, epl: { fourGoals: true } } }) });
  eq('a league whose goal rows have no team id, or no clock, or a team that is not a competitor, is not counted as E1 holding', [r.art.e1.e1HeldOn.length, ['bundesliga', 'ligue1', 'europa'].some((s) => r.art.e1.e1HeldOn.includes(s))], [6, false]);   // epl (four rows) still holds E1
  eq('the goal count equalled the score in eight: epl has four goal rows against a final score of three', [r.art.e1.goalRowsEqualFinalTotalOn.length, r.art.e1.goalRowsEqualFinalTotalOn.includes('epl')], [8, false]);
  eq('and the run was still a complete one', r.art.reachedTarget, true);
});

await scenario('a summary that is not JSON', async () => {
  const r = await run({ world: espnWorld({ summary: { epl: [200, 'this is not json'] } }) });
  eq('recorded, not a crash; the scoreboard list still witnesses E1 for epl, the summary list does so for the other eight only', [r.code, r.art.leagues.epl.summary.shapeOk, r.art.e1.e1HeldOn.length, r.art.e1.heldOnByList['summary.keyEvents'].length, r.art.e1.heldOnByList['scoreboard.competitions[0].details'].length], [0, false, 9, 8, 9]);
});

await scenario('the relay read', async () => {
  const notContract = await run({ day: [200, { ok: false }] });
  eq('a 200 that is not the contract shape is not reached', [notContract.art.e2a.shapeOk, notContract.art.reachedTarget, notContract.latest], [false, false, false]);
  const refused = await run({ day: [500, DAYROWS] });
  eq('a contract-shaped body behind a 500 is not reached either', [refused.art.e2a.status, refused.art.reachedTarget], [500, false]);
});

await scenario('a league the registry text does not have', async () => {
  const text = SLUGS.filter((s) => s !== 'ucl').map((s) => `'${s}': { sport: 'soccer', espnLeague: '${REG[s]}' },`).join('\n');
  const r = await run({ srcIndex: text });
  eq('exit 1, it names the league, and no request was made', [r.code, /ucl/.test(r.stderr), r.espnLog.length, r.relayLog.length], [1, true, 0, 0]);
});

finished = true;
console.log(failed === 0 ? `ok ${scenarios} scenarios, ${assertions} assertions` : `${failed} FAILED (${scenarios} scenarios, ${assertions} assertions)`);
process.exit(failed === 0 ? 0 : 1);
