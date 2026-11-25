#!/usr/bin/env node
// Writes the archive rows a newly SEEDED league missed before it was seeded: for each date, ESPN's scoreboard for the league, completed events only, each POSTed to
// /archive/game with the field mapping of the cron's own collector ([ARCHIVE-YDAY], src/index.js) copied, not composed. Written for the EFL Championship (eng.2, label
// 'EFL Championship'), which the owner decided to seed on 2026-11-25 ("build both next"; docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Addendum 2026-11-25). The
// cron's catch-up only reaches yesterday, so a season already under way needs this once (the precedent: scripts/run-archive-gap-espn-backfill.mjs, which is hard-coded to
// two MLB/WNBA dates and is not touched).
//
// SAFETY, each one a measured hazard of this repo and not a habit:
//   * a game already archived by its ESPN event id with a score is SKIPPED (the collector's own dedup), so a re-run writes nothing twice;
//   * the id the route builds is `${sport}_${date}_${shortify(home)}_${shortify(away)}` from the LABEL, as the collector sends it, so these rows and the cron's are one namespace;
//   * ESPN answering 403 or 429 STOPS the run (it is not retried and not read as an empty day); a day that fails to read stops the run, it is never skipped;
//   * the route is not authenticated today and is ruled to be gated (docs/CC-CMD-2026-10-14-archive-game-unauthenticated-write.md); this sends X-FIELD-Relay anyway, so the
//     day it is gated this script keeps working, and it is listed there as a caller;
//   * nothing is written by --dry-run.
//
//   RELAY_SHARED_SECRET=... node scripts/run-archive-league-history-backfill.mjs --league eng.2 --label "EFL Championship" --from 2026-08-01 --to 2026-11-24 [--dry-run]
//   node scripts/run-archive-league-history-backfill.mjs --self-test
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev';
export const LABEL = /^[A-Za-z0-9 .'-]{1,60}$/;
export const LEAGUE = /^[a-z0-9._]{1,40}$/;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The relay's own ESPN base, read from the source so it cannot drift from what the cron uses. */
export function espnBaseFrom(text) {
  const m = /^const ESPN_API_BASE\s*=\s*'(https:\/\/[a-z0-9.-]+\/apis\/site\/v2)'/m.exec(text);
  if (m === null) throw new Error('ESPN_API_BASE was not found in src/index.js');
  return m[1];
}

/** Every UTC date from `from` to `to`, inclusive, oldest first; refuses a bad or reversed range and one longer than 366 days. */
export function datesBetween(from, to) {
  if (!isDate(from) || !isDate(to)) throw new Error(`not dates: ${from} .. ${to}`);
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (b < a) throw new Error(`the range is reversed: ${from} .. ${to}`);
  const days = Math.round((b - a) / 86400000) + 1;
  if (days > 366) throw new Error(`more than a year: ${days} days`);
  return Array.from({ length: days }, (_, i) => new Date(a + i * 86400000).toISOString().slice(0, 10));
}

/** The completed events of a scoreboard, as the collector reads them (src/index.js [ARCHIVE-YDAY]): the gate is status.type.completed === true, the sides are homeAway with the
 *  first two competitors as the fallback, the names are shortDisplayName then displayName, the score is the competitor's own. */
export function completedOf(board) {
  const out = [];
  for (const ev of Array.isArray(board?.events) ? board.events : []) {
    const comp = ev?.competitions?.[0];
    if (comp?.status?.type?.completed !== true) continue;
    const teams = comp?.competitors || [];
    const home = teams.find((t) => t.homeAway === 'home') || teams[0];
    const away = teams.find((t) => t.homeAway === 'away') || teams[1];
    out.push({
      home: home?.team?.shortDisplayName || home?.team?.displayName || '',
      away: away?.team?.shortDisplayName || away?.team?.displayName || '',
      homeScore: home?.score ?? null, awayScore: away?.score ?? null,
      startTime: comp?.date || null, venue: comp?.venue?.fullName || '', eventId: String(ev.id || ''),
    });
  }
  return out;
}

/** The body /archive/game takes, from the collector's own POST: `sport` is the LABEL (not ESPN's top-level sport), went_to_ot is null for a label the OT table does not map. */
export function bodyOf(label, date, g) {
  return { sport: label, league: label, date, home: g.home, away: g.away, home_score: g.homeScore, away_score: g.awayScore, venue: g.venue, start_time: g.startTime || null, source_id: g.eventId, went_to_ot: null };
}

async function jget(url, ms = 30000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'manual', headers: { Accept: 'application/json' } });
  return { status: r.status, json: r.status === 200 ? await r.json().catch(() => null) : null };
}

export async function run({ relay, secret, espnBase, league, label, dates, dry, d1, post = null, spacingMs = 400, log = console.log }) {
  const sum = { dates: dates.length, scoreboardsRead: 0, completed: 0, alreadyArchived: 0, written: 0, failedWrites: 0, noEventId: 0, stopped: null, statuses: Object.create(null) };
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const r = await jget(`${espnBase}/sports/soccer/${league}/scoreboard?dates=${date.replace(/-/g, '')}`);
    sum.statuses[r.status] = (sum.statuses[r.status] ?? 0) + 1;
    if (r.status === 403 || r.status === 429) { sum.stopped = `ESPN answered ${r.status} on ${date}`; break; }
    if (r.status !== 200 || r.json === null) { sum.stopped = `the scoreboard for ${date} did not answer 200 with JSON (${r.status})`; break; }
    sum.scoreboardsRead++;
    for (const g of completedOf(r.json)) {
      sum.completed++;
      if (g.eventId === '') { sum.noEventId++; continue; }
      const rows = await d1(`SELECT home_score FROM regular_season_games WHERE espn_event_id = ? UNION ALL SELECT home_score FROM postseason_games WHERE espn_event_id = ? LIMIT 1`, [g.eventId, g.eventId]);
      if (rows.length > 0 && rows[0].home_score !== null) { sum.alreadyArchived++; continue; }
      if (dry) continue;
      const res = await (post ?? ((body) => fetch(`${relay}/archive/game`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'manual' }).then((x) => x.status)))(bodyOf(label, date, g));
      if (res === 200) sum.written++; else sum.failedWrites++;
    }
    log(`${date}: ${sum.completed} completed so far, ${sum.written} written, ${sum.alreadyArchived} already archived`);
    if (i + 1 < dates.length && spacingMs > 0) await new Promise((x) => setTimeout(x, spacingMs));
  }
  return sum;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const league = flag('--league'), label = flag('--label'), from = flag('--from'), to = flag('--to');
  if (!league || !LEAGUE.test(league) || !label || !LABEL.test(label) || !from || !to) { console.error('--league, --label, --from and --to are required (and must look like a league slug, a label and dates)'); process.exit(1); }
  const dry = argv.includes('--dry-run');
  const secret = process.env.RELAY_SHARED_SECRET;
  if (!secret) { console.error('RELAY_SHARED_SECRET is not set'); process.exit(1); }
  const espnBase = espnBaseFrom(fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8'));
  const d1 = async (sql, params) => {
    const r = await fetch(`${RELAY}/d1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': secret }, body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30000), redirect: 'manual' });
    const b = await r.json().catch(() => null);
    if (r.status !== 200 || b === null || b.success === false || !Array.isArray(b.results)) throw new Error(`d1 HTTP ${r.status}`);
    return b.results;
  };
  const dates = datesBetween(from, to);
  const sum = await run({ relay: RELAY, secret, espnBase, league, label, dates, dry, d1 });
  const done = (await d1(`SELECT COUNT(*) AS n, COUNT(home_score) AS scored, COUNT(bsd_event_id) AS joined FROM regular_season_games WHERE sport = ? AND date BETWEEN ? AND ?`, [label, from, to]))[0];
  const out = { ts: new Date().toISOString(), league, label, from, to, dry, ...sum, archiveAfter: done };
  fs.mkdirSync('outbox', { recursive: true });
  const file = `outbox/archive-league-history-backfill-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${out.ts.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`COVERAGE: ${sum.dates} dates asked, ${sum.scoreboardsRead} scoreboards read, ${sum.completed} completed events, ${sum.alreadyArchived} already archived, ${sum.written} written, ${sum.failedWrites} failed writes, ${sum.noEventId} without an event id; archive now holds ${done.n} '${label}' rows in range (${done.scored} scored, ${done.joined} with a bsd_event_id)${sum.stopped ? `; STOPPED: ${sum.stopped}` : ''}`);
  if (sum.stopped || sum.failedWrites > 0) process.exit(1);
}

// ---------------------------------------------------------------- self-test
async function selfTest() {
  let n = 0, failed = 0;
  const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL  ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); } };
  const throws = (name, f, re) => { n++; let m = null; try { f(); } catch (e) { m = e.message; } if (!(m !== null && re.test(m))) { failed++; console.log(`FAIL  ${name}: ${m}`); } };
  eq('espnBaseFrom reads the constant', espnBaseFrom("x\nconst ESPN_API_BASE        = 'https://site.api.espn.com/apis/site/v2';\ny"), 'https://site.api.espn.com/apis/site/v2');
  throws('espnBaseFrom refuses a source without it', () => espnBaseFrom('const x = 1'), /not found/);
  throws('espnBaseFrom refuses a plain-http base', () => espnBaseFrom("const ESPN_API_BASE = 'http://site.api.espn.com/apis/site/v2';"), /not found/);
  eq('datesBetween: inclusive, oldest first, across a month end', datesBetween('2026-08-30', '2026-09-02'), ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  eq('datesBetween: one day', datesBetween('2026-09-02', '2026-09-02'), ['2026-09-02']);
  throws('datesBetween: reversed', () => datesBetween('2026-09-02', '2026-09-01'), /reversed/);
  throws('datesBetween: not a date', () => datesBetween('2026-02-30', '2026-03-02'), /not dates/);
  throws('datesBetween: more than a year', () => datesBetween('2025-01-01', '2026-06-01'), /more than a year/);
  const ev = (id, completed, h, a, hs, as) => ({ id, competitions: [{ date: '2026-09-12T14:00Z', status: { type: { completed } }, venue: { fullName: 'Ground' }, competitors: [{ homeAway: 'away', score: as, team: { shortDisplayName: a, displayName: `${a} FC` } }, { homeAway: 'home', score: hs, team: { displayName: `${h} Town` } }] }] });
  const board = { events: [ev(1, true, 'Leeds', 'Hull', '2', '0'), ev(2, false, 'A', 'B', '0', '0'), ev(3, true, 'C', 'D', '0', '0'), { id: 4, competitions: [] }] };
  eq('completedOf: finals only, home by homeAway, short name else display name, the competitor\'s own score as text, the event id as text',
    completedOf(board).map((g) => [g.eventId, g.home, g.away, g.homeScore, g.awayScore]), [['1', 'Leeds Town', 'Hull', '2', '0'], ['3', 'C Town', 'D', '0', '0']]);
  const two = completedOf({ events: [{ id: 7, competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: 'home', score: '1', team: { shortDisplayName: 'Leeds', displayName: 'Leeds United' } }, { homeAway: 'away', score: '0', team: { shortDisplayName: 'Hull', displayName: 'Hull City' } }] }] }] })[0];
  eq('completedOf: the home side listed FIRST is still home, the away side second is still away, and the short name wins over the display name on both', [two.home, two.away, two.homeScore, two.awayScore], ['Leeds', 'Hull', '1', '0']);
  eq('completedOf: a 0-0 final is a final (football has them)', completedOf(board).some((g) => g.eventId === '3'), true);
  eq('completedOf: a board with no events, or no board, is nothing', [completedOf({}), completedOf(null), completedOf({ events: 'x' })], [[], [], []]);
  eq('completedOf: with no homeAway the first two competitors are the sides', completedOf({ events: [{ id: 9, competitions: [{ status: { type: { completed: true } }, competitors: [{ score: '1', team: { shortDisplayName: 'X' } }, { score: '0', team: { shortDisplayName: 'Y' } }] }] }] })[0].home, 'X');
  const g0 = completedOf(board)[0];
  eq('bodyOf: the label is the sport and the league; the event id is source_id; went_to_ot is null', bodyOf('EFL Championship', '2026-09-12', g0),
    { sport: 'EFL Championship', league: 'EFL Championship', date: '2026-09-12', home: 'Leeds Town', away: 'Hull', home_score: '2', away_score: '0', venue: 'Ground', start_time: '2026-09-12T14:00Z', source_id: '1', went_to_ot: null });
  // a stub ESPN and a stub archive
  const noId = ev(undefined, true, 'G', 'H', '3', '1');
  const boards = { '20260912': [200, board], '20260913': [200, { events: [ev(5, true, 'E', 'F', '1', '1')] }], '20260919': [403, null], '20260918': [200, { events: [ev(6, true, 'I', 'J', '2', '2'), noId] }], '20260914': [429, null], '20260915': [200, { events: [] }], '20260916': [500, null] };
  const asked = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const day = u.searchParams.get('dates'); asked.push(`${u.pathname}?${day}`);
    const b = boards[day]; if (!b) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(b[0], { 'content-type': 'application/json' }); res.end(JSON.stringify(b[1] ?? {}));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const espnBase = `http://127.0.0.1:${server.address().port}/apis/site/v2`;
  const archived = new Set(['3']);   // event 3 is already archived and scored
  const d1 = async (_sql, params) => (params[0] === '6' ? [{ home_score: null }] : archived.has(params[0]) ? [{ home_score: 0 }] : []);
  const posts = [];
  const post = (status) => async (body) => { posts.push(body.source_id); return status; };
  const base = { relay: 'x', secret: 's', espnBase, league: 'eng.2', label: 'EFL Championship', d1, spacingMs: 0, log: () => {} };
  let s = await run({ ...base, dates: ['2026-09-12', '2026-09-13'], dry: false, post: post(200) });
  eq('run: asks the league scoreboard for each date, once', asked.slice(0, 2), ['/apis/site/v2/sports/soccer/eng.2/scoreboard?20260912', '/apis/site/v2/sports/soccer/eng.2/scoreboard?20260913']);
  eq('run: writes the finals not yet archived (1 and 5), skips event 3 (archived and scored), never writes the unfinished 2', [posts, s.written, s.alreadyArchived, s.completed], [['1', '5'], 2, 1, 3]);
  posts.length = 0; archived.add('1');
  s = await run({ ...base, dates: ['2026-09-12'], dry: false, post: post(200) });
  eq('run: a second run writes only what is still missing', [posts, s.written, s.alreadyArchived], [[], 0, 2]);
  posts.length = 0; archived.clear();
  s = await run({ ...base, dates: ['2026-09-12'], dry: true, post: post(200) });
  eq('run: --dry-run asks ESPN and the archive and writes nothing', [posts, s.written, s.scoreboardsRead], [[], 0, 1]);
  s = await run({ ...base, dates: ['2026-09-12'], dry: false, post: post(500) });
  eq('run: a refused write is counted as failed, not written', [s.written, s.failedWrites], [0, 2]);
  posts.length = 0;
  s = await run({ ...base, dates: ['2026-09-14', '2026-09-12'], dry: false, post: post(200) });
  eq('run: ESPN 429 STOPS the run before any later date is read or written', [s.stopped, posts, s.scoreboardsRead], ['ESPN answered 429 on 2026-09-14', [], 0]);
  posts.length = 0;
  s = await run({ ...base, dates: ['2026-09-19', '2026-09-12'], dry: false, post: post(200) });
  eq('run: ESPN 403 STOPS the run too, and nothing after it is read or written', [s.stopped, posts, s.scoreboardsRead], ['ESPN answered 403 on 2026-09-19', [], 0]);
  s = await run({ ...base, dates: ['2026-09-16', '2026-09-12'], dry: false, post: post(200) });
  eq('run: a scoreboard that answers 500 stops the run; the day is never skipped', [s.stopped?.includes('did not answer 200'), s.scoreboardsRead], [true, 0]);
  s = await run({ ...base, dates: ['2026-09-17'], dry: false, post: post(200) });
  eq('run: a date ESPN does not know (404) stops the run too', s.stopped?.includes('404'), true);
  posts.length = 0;
  s = await run({ ...base, dates: ['2026-09-18'], dry: false, post: post(200) });
  eq('run: an archived row with NO score is not archived (it is written), and an event with no id is counted and never written', [posts, s.written, s.noEventId, s.alreadyArchived], [['6'], 1, 1, 0]);
  s = await run({ ...base, dates: ['2026-09-15'], dry: false, post: post(200) });
  eq('run: a day with no events is read and writes nothing', [s.scoreboardsRead, s.written, s.stopped], [1, 0, null]);
  eq('label and league patterns: a quote or a semicolon is refused', [LABEL.test("x'; DROP"), LEAGUE.test('eng.2'), LEAGUE.test('ENG 2')], [false, true, false]);
  server.closeAllConnections(); await new Promise((r) => server.close(r));
  console.log(failed === 0 ? `ok ${n} assertions` : `${failed} of ${n} FAILED`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest().then((c) => process.exit(c));
  else main().catch((e) => { console.error('run-archive-league-history-backfill failed:', String(e && e.message ? e.message : e).replace(process.env.RELAY_SHARED_SECRET || '\u0000', '[redacted]')); process.exit(1); });
}
