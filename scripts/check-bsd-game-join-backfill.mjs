#!/usr/bin/env node
// Check for scripts/bsd-game-join-backfill.mjs: the REAL script is run against a stub relay that keeps the rows of each day and answers
// /context/date and POST /admin/bsd-game-join, and every assertion is read off what the stub received and what the script wrote.
//   node scripts/check-bsd-game-join-backfill.mjs [--source scripts/bsd-game-join-backfill.mjs] [--fail-fast]
// mutate-bsd-game-join-backfill.mjs aims --source at broken copies and requires this check to go red.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const FAIL_FAST = argv.includes('--fail-fast');
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const SOURCE = path.resolve(flag('--source', 'scripts/bsd-game-join-backfill.mjs'));
const SECRET = 'test-secret-0123456789';

let scenarios = 0, assertions = 0, failed = 0, finished = false;
process.on('exit', (code) => {
  if (!finished) { console.log(`FAIL  the check did not run to its end (exit ${code}, ${scenarios} scenarios, ${assertions} assertions)`); process.exitCode = 1; }
});
const stable = (v) => JSON.stringify(v, (k, val) => (val === undefined ? '<<undefined>>' : val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
const FULL = { FROM: '2026-02-01', TO: '2026-10-23' };   // the script's default range, written out so the check does not follow the script's constants
const eq = (label, got, want) => {
  assertions++;
  if (stable(got) !== stable(want)) { failed++; console.log(`FAIL  ${label}\n        got  ${stable(got)}\n        want ${stable(want)}`); if (FAIL_FAST) { finished = true; process.exit(1); } }
};
const scenario = async (name, fn) => { scenarios++; try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.stack || e.message}`); } };

// ---- the world: six days; each day's rows are kept, so a POST can change what the next read shows
const D = { clean: '2026-09-01', a: '2026-09-02', fine: '2026-09-03', b: '2026-09-04', c: '2026-09-05', unread: '2026-09-06' };
const soccer = (day, n, joined) => Array.from({ length: n }, (_, i) => ({ id: `${day}-s${i}`, sport: i % 2 ? 'MLS' : 'EPL', bsd_event_id: joined ? `J${i}` : null, espn_event_id: `E${i}` }));
function world(over = {}) {
  const days = new Map([
    [D.clean, [...soccer(D.clean, 2, true), { id: 'n1', sport: 'NBA', bsd_event_id: null }]],
    [D.a, [...soccer(D.a, 3, false), ...soccer('x' + D.a, 1, true), { id: 'n2', sport: 'NBA', bsd_event_id: null }]],        // 3 pending
    [D.fine, soccer(D.fine, 2, true)],
    [D.b, soccer(D.b, 2, false)],                                                                                       // 2 pending
    [D.c, soccer(D.c, 1, false)],                                                                                       // 1 pending
    [D.unread, null],
  ]);
  for (const [k, v] of Object.entries(over.days || {})) days.set(k, v);
  return { days, behave: over.behave || {}, calls: [] };
}
function relayRoute(w) {
  return (req, u, body) => {
    w.calls.push({ method: req.method, path: u.pathname, query: u.search, auth: req.headers['x-field-relay'] === undefined ? null : req.headers['x-field-relay'], body });
    if (req.method === 'POST' && u.pathname === '/admin/bsd-game-join') {
      if (req.headers['x-field-relay'] !== SECRET) return [401, 'Unauthorized'];
      const date = JSON.parse(body).date;
      const b = w.behave[date] === undefined ? { kind: 'ok', join: 99 } : w.behave[date];
      const rows = w.days.get(date) || [];
      const pending = rows.filter((r) => ['MLS', 'EPL'].includes(r.sport) && r.bsd_event_id === null);
      if (b.kind === 'leak') return [502, { ok: false, date, reason: `the route echoed ${SECRET}` }];
      if (b.kind === 'fail') return [502, { ok: false, date, reason: `BSD events for ${date} not fully read; nothing written` }];
      if (b.kind === 'refuse') return [401, 'Unauthorized'];
      if (b.kind === 'throttle') return [429, { ok: false, reason: 'slow down' }];
      const k = b.kind === 'noevents' ? 0 : Math.min(b.join === undefined ? 99 : b.join, pending.length);
      if (b.kind === 'ok') pending.slice(0, k).forEach((r, i) => { r.bsd_event_id = `B${i}`; });          // 'lie' and 'noevents' change nothing
      const claim = b.kind === 'lie' ? b.claim : k;
      return [200, { ok: true, date, pending: pending.length, written: claim, joined: claim, ambiguous: 0, refusedKickoff: 0, unjudgedKickoff: 0, eventsRead: b.kind === 'noevents' ? 0 : 60,
        upstreamPages: b.pages === undefined ? 5 : b.pages, cacheHits: 0, unmatched: pending.slice(k).map((r) => `${r.sport}: Home ${r.id} v Away`) }];
    }
    const m = u.pathname.match(/^\/context\/date\/(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      const rows = w.days.get(m[1]);
      if (rows === null) return [500, { error: 'boom' }];
      const all = rows === undefined ? [] : rows;                    // a day the world does not name is a clean, empty day
      return [200, { ok: true, date: m[1], games: { regular: all.filter((r) => !r._post), postseason: all.filter((r) => r._post) } }];
    }
    return [404, { error: 'unknown' }];
  };
}
async function run({ world: w = world(), env = {}, secret = SECRET, state = null } = {}) {
  w.calls.length = 0;                       // a world can be reused across runs (the rows persist); the request log is per run
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (d) => { data += d; });
    req.on('end', () => { const out = relayRoute(w)(req, new URL(req.url, 'http://stub'), data); res.writeHead(out[0], { 'content-type': 'application/json' }); res.end(typeof out[1] === 'string' ? out[1] : JSON.stringify(out[1])); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjb-run-'));
  fs.mkdirSync(path.join(dir, 'outbox'));
  if (state !== null) fs.writeFileSync(path.join(dir, 'outbox', 'bsd-join-backfill-state.json'), JSON.stringify(state));
  const e = { ...process.env, RELAY_URL: `http://127.0.0.1:${server.address().port}`, FROM: D.clean, TO: D.unread, MAX_DATES: '2', PAGE_CAP: '', DRY_RUN: '', ...env };
  if (secret === null) delete e.RELAY_SHARED_SECRET; else e.RELAY_SHARED_SECRET = secret;
  const child = spawn(process.execPath, [SOURCE], { cwd: dir, env: e });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((res) => child.on('close', res));
  server.closeAllConnections();
  await new Promise((res) => server.close(res));
  const files = {};
  for (const f of fs.readdirSync(path.join(dir, 'outbox'))) files[f] = fs.readFileSync(path.join(dir, 'outbox', f), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  const stamped = Object.keys(files).filter((f) => /^bsd-join-backfill-2.*\.json$/.test(f));
  return { code, stdout, stderr, calls: w.calls, posts: w.calls.filter((c) => c.method === 'POST'), files, names: Object.keys(files).sort(), art: stamped.length ? JSON.parse(files[stamped[0]]) : null,
    state: files['bsd-join-backfill-state.json'] ? JSON.parse(files['bsd-join-backfill-state.json']) : null, complete: files['bsd-join-backfill-complete.json'] ? JSON.parse(files['bsd-join-backfill-complete.json']) : null,
    raw: Object.values(files).join('\n'), w };
}
const posted = (r) => r.posts.map((p) => JSON.parse(p.body).date);

await scenario('a dry run', async () => {
  const r = await run({ secret: null, env: { DRY_RUN: 'true' } });
  eq('exit 0, no POST at all, only the artifact files', [r.code, r.posts.length, r.names.length], [0, 0, 2]);
  eq('the plan: the two OLDEST days with work, the clean day, the all-joined day and the unread day skipped', r.art.chosen, [D.a, D.b]);
  eq('the survey: 6 days, 5 read, 1 unread; 3 days with 4 in-scope rows to attempt (an MLS row on those days is joined as a side effect but is not what chooses a day), no out-of-scope day', [r.art.survey.daysInRange, r.art.survey.daysRead, r.art.survey.unreadDays, r.art.survey.daysToAttempt, r.art.survey.rowsToAttempt, r.art.survey.outOfScopeDays, r.art.survey.outOfScopeRows], [6, 5, [D.unread], 3, 4, 0, 0]);
  eq('a dry run says so, writes no state and no marker, and nothing is remaining-to-attempt-minus-chosen', [r.art.dryRun, r.state, r.complete, r.art.remainingToAttempt, r.art.complete], [true, null, null, 3, false]);
  eq('every survey read was a plain GET, never cache-busted', r.calls.every((c) => c.method === 'GET' && c.query === ''), true);
});

await scenario('MLS-only days are out of scope unless the owner widens it', async () => {
  const w = () => world({ days: { [D.fine]: [{ id: 'm1', sport: 'MLS', bsd_event_id: null }, { id: 'm2', sport: 'MLS', bsd_event_id: null }] } });
  const r = await run({ world: w(), secret: null, env: { DRY_RUN: 'true', MAX_DATES: '5' } });
  eq('the day with only MLS rows pending is not chosen, and is counted as out of scope with its rows', [r.art.chosen, r.art.survey.outOfScopeDays, r.art.survey.outOfScopeRows, r.art.survey.scopeSports], [[D.a, D.b, D.c], 1, 2, ['EPL', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1']]);
  const wide = await run({ world: w(), secret: null, env: { DRY_RUN: 'true', MAX_DATES: '5', INCLUDE_MLS: 'true' } });
  eq('with INCLUDE_MLS it is chosen, in date order, and nothing is out of scope', [wide.art.chosen, wide.art.survey.outOfScopeDays, wide.art.survey.scopeSports.includes('MLS')], [[D.a, D.fine, D.b, D.c], 0, true]);
});

await scenario('a real run: two dates, each verified', async () => {
  const w = world({ behave: { [D.b]: { kind: 'ok', join: 1 } } });          // a joins all 3; b joins 1 of 2 and leaves one unmatched
  const r = await run({ world: w });
  const a = r.art;
  eq('exit 0; POSTs for the two oldest pending days, in order, with the secret in the header and the date in the body', [r.code, posted(r), r.posts.map((p) => p.auth)], [0, [D.a, D.b], [SECRET, SECRET]]);
  eq('each POST body is exactly {"date": ...}', r.posts.map((p) => p.body), [`{"date":"${D.a}"}`, `{"date":"${D.b}"}`]);
  eq('each write was verified by a cache-busted re-read, and by nothing else', [r.calls.filter((c) => c.query.startsWith('?v=')).length, r.calls.filter((c) => c.query.startsWith('?v=')).map((c) => c.path)], [2, [`/context/date/${D.a}`, `/context/date/${D.b}`]]);
  eq('day a: 3 pending -> 0, written 3, verified', [a.dates[0].outcome, a.dates[0].pendingBefore, a.dates[0].pendingAfter, a.dates[0].response.written, a.dates[0].verify.verified], ['joined', 3, 0, 3, true]);
  eq('day b: 2 pending -> 1, written 1, verified, one unmatched name kept', [a.dates[1].outcome, a.dates[1].pendingBefore, a.dates[1].pendingAfter, a.dates[1].response.written, a.dates[1].verify.verified, a.dates[1].response.unmatched.length], ['joined', 2, 1, 1, true, 1]);
  eq('totals: 4 written, 10 pages, no stop, one day left to attempt, not complete', [a.written, a.pagesUsed, a.stoppedBecause, a.remainingToAttempt, a.complete], [4, 10, null, 1, false]);
  eq('the state holds both answered days, with what was left pending', [Object.keys(r.state.attempted).sort(), r.state.attempted[D.b].pendingAfter, r.state.attempted[D.a].pendingAfter], [[D.a, D.b], 1, 0]);
  eq('the artifact names, no marker, and the secret is in none of them', [r.names, r.complete, r.raw.includes(SECRET)], [['bsd-join-backfill-2' + a.ts.slice(1).replace(/[:.]/g, '-') + '.json', 'bsd-join-backfill-latest.json', 'bsd-join-backfill-state.json'].sort(), null, false]);
  eq('the coverage line carries every denominator', [/5 of 6 days read \(1 unread\)/.test(a.coverageLine), /scope 5 sports \(MLS not included\), regular-season rows choose a date: to attempt 3 days \/ 4 rows/.test(a.coverageLine), /2 dates posted, 4 rows written, 10 upstream pages \(cap 40\), 2 verified/.test(a.coverageLine), /remaining to attempt 1/.test(a.coverageLine)], [true, true, true, true]);
});

await scenario('a second run does not ask again about a day it already answered', async () => {
  const w = world({ behave: { [D.b]: { kind: 'ok', join: 0 } } });          // BSD events were read, none matched: day b keeps its rows pending
  const first = await run({ world: w });
  const second = await run({ world: w, state: first.state });
  eq('the first run recorded day b as answered with nothing written (none matched)', [first.art.dates[1].outcome, first.art.dates[1].verify.verified], ['none-matched', true]);
  eq('day b still has in-scope rows pending but is reported as attempted, not chosen; the next run takes day c', [posted(second), second.art.survey.attemptedStillPending, second.art.chosen], [[D.c], 1, [D.c]]);
  eq('day c is the last one to attempt, but day six is unread, so the run is NOT complete and writes no marker', [second.art.complete, second.complete, second.art.remainingToAttempt], [false, null, 0]);
});

await scenario('complete when nothing is left and nothing is unread', async () => {
  const w = world({ days: { [D.unread]: soccer(D.unread, 0, true) }, behave: { [D.b]: { kind: 'ok', join: 0 } } });
  const r = await run({ world: w, env: { ...FULL, MAX_DATES: '5', INCLUDE_MLS: 'true' } });
  eq('three days posted, all verified, nothing remaining, complete', [posted(r), r.art.remainingToAttempt, r.art.complete], [[D.a, D.b, D.c], 0, true]);
  eq('the marker says what is still pending: day b, its two rows, with both unmatched names', [r.complete.attempted, r.complete.stillPending.map((x) => [x.date, x.rows, x.unmatched.length])], [3, [[D.b, 2, 2]]]);
  const again = await run({ world: w, state: r.state, env: { ...FULL, MAX_DATES: '5', INCLUDE_MLS: 'true' } });
  eq('a later run has nothing to post and says complete again', [again.posts.length, again.art.complete], [0, true]);
});

await scenario('complete means the scheduled scope, not just the range that was asked for', async () => {
  const w = () => world({ days: { [D.unread]: soccer(D.unread, 0, true) }, behave: { [D.b]: { kind: 'ok', join: 0 } } });
  const narrow = await run({ world: w(), env: { MAX_DATES: '5', INCLUDE_MLS: 'true' } });          // FROM..TO is the six check days
  eq('a narrower range with nothing left is range-complete, and writes NO marker (it would stop the schedule for good)', [narrow.art.rangeComplete, narrow.art.complete, narrow.complete, /not the scheduled scope/.test(narrow.art.coverageLine)], [true, false, null, true]);
  const noMls = await run({ world: w(), env: { ...FULL, MAX_DATES: '5' } });                      // the full range, MLS not included
  eq('the full range without MLS is range-complete, and writes no marker either', [noMls.art.rangeComplete, noMls.art.complete, noMls.complete], [true, false, null]);
  const unreadDay = await run({ world: world({ behave: { [D.b]: { kind: 'ok', join: 0 } } }), env: { ...FULL, MAX_DATES: '5', INCLUDE_MLS: 'true' } });   // the world's day six answers 500
  eq('the full range and MLS, every pending day attempted, but one day UNREAD: not complete, no marker', [unreadDay.art.rangeComplete, unreadDay.art.complete, unreadDay.complete], [false, false, null]);
  const lateStart = await run({ world: w(), env: { FROM: '2026-03-01', TO: '2026-10-23', MAX_DATES: '5', INCLUDE_MLS: 'true' } });
  eq('a range that STARTS after the default start proves nothing about the earlier dates: no marker', [lateStart.art.rangeComplete, lateStart.art.complete, lateStart.complete], [true, false, null]);
  const earlyEnd = await run({ world: w(), env: { FROM: '2026-02-01', TO: '2026-09-30', MAX_DATES: '5', INCLUDE_MLS: 'true' } });
  eq('a range that ENDS before the default end proves nothing about the later dates: no marker', [earlyEnd.art.rangeComplete, earlyEnd.art.complete, earlyEnd.complete], [true, false, null]);
});

await scenario('a postseason-only day is not chosen unless the owner says so', async () => {
  const post = (id) => ({ id, sport: 'MLS', bsd_event_id: null, _post: true });
  const w = () => world({ days: { [D.fine]: [post('p1'), post('p2')] } });
  const r = await run({ world: w(), secret: null, env: { DRY_RUN: 'true', MAX_DATES: '5', INCLUDE_MLS: 'true' } });
  eq('the day whose only pending rows are tournament rows is not chosen, and is counted as out of scope', [r.art.chosen, r.art.survey.outOfScopeDays, r.art.survey.outOfScopeRows, r.art.survey.includePostseason], [[D.a, D.b, D.c], 1, 2, false]);
  const wide = await run({ world: w(), secret: null, env: { DRY_RUN: 'true', MAX_DATES: '5', INCLUDE_MLS: 'true', INCLUDE_POSTSEASON: 'true' } });
  eq('with INCLUDE_POSTSEASON it is chosen, and nothing is out of scope', [wide.art.chosen, wide.art.survey.outOfScopeDays, wide.art.survey.includePostseason], [[D.a, D.fine, D.b, D.c], 0, true]);
  const side = await run({ world: world({ days: { [D.c]: [{ id: 'e1', sport: 'EPL', bsd_event_id: null }, post('p3')] } }), env: { MAX_DATES: '5', INCLUDE_MLS: 'true' } });
  const c = side.art.dates.find((d) => d.date === D.c);
  eq('on a day that IS chosen (a regular row is pending) the route still joins the postseason row, and verification counts both tables: 2 pending -> 0', [c.pendingBefore, c.pendingAfter, c.response.written, c.verify.verified], [2, 0, 2, true]);
});

await scenario('a refusal stops at once', async () => {
  const r = await run({ world: world({ behave: { [D.a]: { kind: 'refuse' } } }) });
  eq('one POST, outcome refused, stopped, the other day not posted, the refused day not recorded as answered', [posted(r), r.art.dates[0].outcome, r.art.stoppedBecause, r.state], [[D.a], 'refused', 'the route refused the secret', null]);
});

await scenario('a 429 stops at once', async () => {
  const r = await run({ world: world({ behave: { [D.a]: { kind: 'throttle' } } }) });
  eq('one POST, stopped on 429', [posted(r), r.art.stoppedBecause], [[D.a], 'the route answered 429']);
});

await scenario('failed passes', async () => {
  const one = await run({ world: world({ behave: { [D.a]: { kind: 'fail' } } }), env: { MAX_DATES: '3' } });
  eq('one failed pass does not stop: the run goes on to the next two days', [posted(one), one.art.dates.map((d) => d.outcome), one.art.stoppedBecause], [[D.a, D.b, D.c], ['failed', 'joined', 'joined'], null]);
  eq('a failed day is NOT recorded as answered, so it is tried again', [Object.keys(one.state.attempted).sort()], [[D.b, D.c]]);
  eq('the failed day is still to attempt: one remains', one.art.remainingToAttempt, 1);
  eq('a failed pass is verified too: nothing changed, and that is what the day shows', [one.art.dates[0].pendingAfter, one.art.dates[0].verify.verified], [3, true]);
  const two = await run({ world: world({ behave: { [D.a]: { kind: 'fail' }, [D.b]: { kind: 'fail' } } }), env: { MAX_DATES: '3' } });
  eq('two in a row stop the run before the third', [posted(two), two.art.stoppedBecause], [[D.a, D.b], 'two failed passes in a row']);
});

await scenario('the secret never reaches a file', async () => {
  const r = await run({ world: world({ behave: { [D.a]: { kind: 'leak' } } }) });
  eq('a route that echoes the secret in its reason makes the script refuse to write it: exit 1, no file holds it, the log redacts it', [r.code, r.raw.includes(SECRET), r.stderr.includes(SECRET), /refusing to write/.test(r.stderr)], [1, false, false, true]);
});

await scenario('what the route says it wrote must be what the rows show', async () => {
  const r = await run({ world: world({ behave: { [D.a]: { kind: 'lie', claim: 2 } } }) });
  eq('the claim of 2 writes with no change in the rows is a mismatch: the run stops after that day, the second day is not posted', [posted(r), r.art.dates[0].verify.verified, r.art.stoppedBecause], [[D.a], false, 'what the route said it wrote is not what /context/date shows']);
});

await scenario('the upstream page cap', async () => {
  const r = await run({ world: world({ behave: { [D.a]: { kind: 'ok', join: 99, pages: 6 } } }), env: { PAGE_CAP: '5' } });
  eq('6 pages used against a cap of 5 with a second chosen date waiting: stop after the first day', [posted(r), r.art.pagesUsed, /reached the cap 5/.test(r.art.stoppedBecause)], [[D.a], 6, true]);
  const last = await run({ world: world({ behave: { [D.a]: { kind: 'ok', join: 99, pages: 6 } } }), env: { PAGE_CAP: '5', MAX_DATES: '1' } });
  eq('the same 6 pages against a cap of 5 on the ONLY chosen date: the tranche is over, not stopped (the workflow would otherwise go red at every normal end)', [posted(last), last.art.pagesUsed, last.art.stoppedBecause], [[D.a], 6, null]);
});

await scenario('BSD has no events for the day', async () => {
  const r = await run({ world: world({ behave: { [D.a]: { kind: 'noevents' } } }) });
  eq('an answered pass with nothing written: recorded as answered (not retried), the run goes on', [r.art.dates[0].outcome, r.art.dates[0].response.eventsRead, Object.keys(r.state.attempted).includes(D.a), r.art.stoppedBecause], ['bsd-has-no-events', 0, true, null]);
});

await scenario('refusals before any request', async () => {
  const noSecret = await run({ secret: null });
  eq('a real run without the secret exits 2 and makes no request', [noSecret.code, noSecret.calls.length], [2, 0]);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const late = await run({ env: { TO: tomorrow } });
  eq('a TO that reaches yesterday or later exits 1, no request', [late.code, late.calls.length, /scheduled join/.test(late.stderr)], [1, 0, true]);
  const many = await run({ env: { MAX_DATES: '11' } });
  eq('MAX_DATES over 10 exits 1, no request', [many.code, many.calls.length], [1, 0]);
  const mls = await run({ env: { INCLUDE_MLS: 'sometimes' } });
  eq('INCLUDE_MLS that is not true or false exits 1, no request', [mls.code, mls.calls.length], [1, 0]);
  const post = await run({ env: { INCLUDE_POSTSEASON: 'perhaps' } });
  eq('INCLUDE_POSTSEASON that is not true or false exits 1, no request', [post.code, post.calls.length], [1, 0]);
  const longRange = await run({ env: { FROM: '2025-01-01', TO: '2026-10-23' } });
  eq('a range over 400 days exits 1 with its own message, no request', [longRange.code, longRange.calls.length, /1 to 400 days/.test(longRange.stderr)], [1, 0, true]);
  const dry = await run({ env: { DRY_RUN: 'maybe' } });
  eq('DRY_RUN that is not true or false exits 1, no request', [dry.code, dry.calls.length], [1, 0]);
  const back = await run({ env: { FROM: D.unread, TO: D.clean } });
  eq('a backwards range exits 1 with its own message (not a crash), no request', [back.code, back.calls.length, /is not a range of 1 to 400 days/.test(back.stderr)], [1, 0, true]);
});

finished = true;
console.log(failed === 0 ? `ok ${scenarios} scenarios, ${assertions} assertions` : `${failed} FAILED (${scenarios} scenarios, ${assertions} assertions)`);
process.exit(failed === 0 ? 0 : 1);
