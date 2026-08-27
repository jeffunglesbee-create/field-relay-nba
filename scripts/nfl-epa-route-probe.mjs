// nfl-epa-route-probe.mjs — the deployed /nfl/epa/plays route, against the client.
//
// Done conditions 1 and 2 of CC-CMD-2026-08-27-relay-per-play-epa, in one run.
// CI because the sandbox 403s *.workers.dev and gets HTTP 000 to ESPN.
//
//   1. The route answers with a non-empty plays array whose every entry carries
//      finite epa / ep_start / ep_end and a boolean scoringPlay.
//   2. Those values equal what the CLIENT computes for the same plays, to 2dp,
//      over at least 10 enumerated pairs. The enumeration IS the artifact
//      (Rule 89) — "looks right" is not one.
//
// The client's reference is `_epLookup` / `_computeESPNPlayEPA` copied verbatim
// from jubilant-bassoon/src/legacy/field.js. scripts/nfl-epa-transcription-check
// already asserts the relay MODULE matches that code offline; this asserts the
// deployed ROUTE does, on real bytes, which the offline check cannot see.
//
// COST (Rule 78): three relay GETs. /espn-summary is 25s-cached and
// /nflverse/epa_table.json is 86400s-cached, both on caches.default — a table
// fetched today costs nothing. No direct ESPN API calls except the scoreboard
// sweep, which is public and unmetered.

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SB = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const TS = new Date().toISOString().replace(/[:.]/g, '-');

let pass = 0, fail = 0;
const A = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` :: ${detail}`}`);
  ok ? pass++ : fail++;
};
const getJSON = async (url) => {
  const r = await fetch(url);
  const t = await r.text();
  let b = null; try { b = JSON.parse(t); } catch { /* leave null */ }
  return { status: r.status, body: b, text: t };
};

// ── the client, verbatim ────────────────────────────────────────────────────
let _epTable = null;
function _epLookup(down, ytg, yl100) {
  if (!_epTable) return 0;
  const ytgBuckets = [1,2,3,4,5,6,7,8,9,10,11,15,20,25];
  const yl100Buckets = [1,6,11,16,21,26,31,36,41,46,51,56,61,66,71,76,81,86,91,96];
  const nearest = (v, arr) => arr.reduce((b, x) => Math.abs(x - v) < Math.abs(b - v) ? x : b);
  const ytgB = nearest(Math.min(Math.max(ytg, 1), 25), ytgBuckets);
  const yl100B = nearest(Math.max(1, Math.min(99, yl100)), yl100Buckets);
  return _epTable[`${down}_${ytgB}_${yl100B}`] ?? 0;
}
function _computeESPNPlayEPA(play) {
  if (!play?.start) return null;
  const SKIP = ['Kickoff','Extra Point','Two-Point Conversion','Timeout','Two Minute Warning','End of Period','End of Half','End of Game'];
  const ptext = play.type?.text || '';
  if (SKIP.some(t => ptext.includes(t))) return null;
  const down = play.start.down, ytg = play.start.distance, yl100 = play.start.yardsToEndzone;
  if (!down || !ytg || !yl100) return null;
  const epStart = _epLookup(down, ytg, yl100);
  if (play.scoringPlay) {
    const lc = ptext.toLowerCase();
    const epEnd = (lc.includes('field goal') && !lc.includes('miss')) ? 3 : 6.96;
    return { epa: Math.round((epEnd - epStart) * 100) / 100, ep_start: epStart, ep_end: epEnd };
  }
  if (play.isTurnover) {
    const epEnd = -_epLookup(1, 10, Math.max(1, Math.min(99, 100 - yl100)));
    return { epa: Math.round((epEnd - epStart) * 100) / 100, ep_start: epStart, ep_end: epEnd };
  }
  if (!play.end || play.end.yardsToEndzone === undefined || play.end.yardsToEndzone === null) return null;
  const epEnd = _epLookup(play.end.down, play.end.distance, play.end.yardsToEndzone);
  return { epa: Math.round((epEnd - epStart) * 100) / 100, ep_start: epStart, ep_end: epEnd };
}

// ── find a game that actually has plays ─────────────────────────────────────
async function findGameWithPlays() {
  const today = new Date();
  for (let back = 0; back <= 14; back++) {
    const d = new Date(today.getTime() - back * 86400000);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const { status, body } = await getJSON(`${SB}?dates=${ymd}`);
    if (status !== 200 || !body?.events?.length) continue;
    for (const ev of body.events) {
      if (ev.status?.type?.state === 'pre') continue;
      return { id: ev.id, name: ev.name, date: ymd, state: ev.status?.type?.state };
    }
  }
  return null;
}

const game = await findGameWithPlays();
if (!game) {
  // NOT a pass. No game is "not observable", and the run says so rather than
  // reporting green on an assertion it never made.
  console.log('::warning::no in/post NFL game in the last 14 days — the route was NOT exercised');
  console.log('\nNOT OBSERVABLE  0 checks run');
  process.exit(1);
}
console.log(`Game: ${game.name} (id=${game.id}, ${game.date}, state=${game.state})\n`);

// ── done condition 1: the route answers, with finite values ─────────────────
const routeUrl = `${RELAY}/nfl/epa/plays?event=${game.id}`;
const { status, body } = await getJSON(routeUrl);
A('the route returns 200', status === 200, `HTTP ${status}`);
A('the payload carries a plays array', Array.isArray(body?.plays), typeof body?.plays);
const plays = Array.isArray(body?.plays) ? body.plays : [];
A('the plays array is NOT empty', plays.length > 0, `${plays.length} play(s)`);
A('every entry has finite epa / ep_start / ep_end',
  plays.length > 0 && plays.every(p => Number.isFinite(p.epa) && Number.isFinite(p.ep_start) && Number.isFinite(p.ep_end)),
  `${plays.filter(p => !Number.isFinite(p.epa)).length} non-finite epa`);
A('every entry has a boolean scoringPlay',
  plays.length > 0 && plays.every(p => typeof p.scoringPlay === 'boolean'),
  `${plays.filter(p => typeof p.scoringPlay !== 'boolean').length} non-boolean`);
A('every entry carries its drive index',
  plays.length > 0 && plays.every(p => Number.isInteger(p.drive)),
  `currentDrive=${body?.currentDrive}`);

// ── done condition 2: it equals the client, enumerated ──────────────────────
const tableRes = await getJSON(`${RELAY}/nflverse/epa_table.json`);
A('the EP table is readable through the relay', tableRes.status === 200, `HTTP ${tableRes.status}`);
// .ep, not the document. The client does `_epTable = d.ep || d`, and the first
// version of the ROUTE skipped that unwrap — every lookup missed, `?? 0` came
// back, and this probe reported agreement because both sides were compared on a
// table only the client had unwrapped.
_epTable = tableRes.body?.ep ?? tableRes.body;
A('the EP table unwraps to a populated lookup',
  _epTable && Object.keys(_epTable).length > 100,
  `${_epTable ? Object.keys(_epTable).length : 0} key(s) — the document has ~8 top-level keys, the table ~1120`);

const sumRes = await getJSON(`${RELAY}/espn-summary/sports/football/nfl/summary?event=${game.id}`);
A('the summary is readable through the relay', sumRes.status === 200, `HTTP ${sumRes.status}`);
const drives = sumRes.body?.drives || {};
const prev = Array.isArray(drives.previous) ? drives.previous : [];
const all = drives.current ? prev.concat([drives.current]) : prev;

const reference = [];
all.forEach((d, i) => (d?.plays || []).forEach(p => {
  const r = _computeESPNPlayEPA(p);
  if (r) reference.push({ id: p.id ?? null, drive: i, ...r });
}));

A('the client reference produced plays to compare against', reference.length > 0, `${reference.length}`);
A('the route and the client agree on how many plays have an EPA',
  plays.length === reference.length, `route ${plays.length}, client ${reference.length}`);

const pairs = [];
let disagreements = 0;
for (let i = 0; i < Math.min(plays.length, reference.length); i++) {
  const a = plays[i], b = reference[i];
  const same = Math.abs(a.epa - b.epa) < 0.005
            && Math.abs(a.ep_start - b.ep_start) < 0.005
            && Math.abs(a.ep_end - b.ep_end) < 0.005;
  if (!same) disagreements++;
  if (pairs.length < 12) pairs.push({ i, id: a.id, drive: a.drive, relay: a.epa, client: b.epa, agree: same });
}
A('at least 10 pairs are available to enumerate', pairs.length >= 10, `${pairs.length}`);
A('every play agrees with the client to 2dp', disagreements === 0, `${disagreements} of ${plays.length} differ`);

// NON-VACUITY, and it is the assertion this probe was missing.
//
// The first run reported "ROUTE MATCHES CLIENT — 149 route plays, 149 client
// plays, 0 disagreements" while every epa was 0, because the route had not
// unwrapped the EP table and `?? 0` is a real number that compares equal to
// itself. "Finite" and "agrees" are both true of all-zeros. A route that
// returns zero for every play is not serving EPA, whatever it agrees with.
const nonZero = plays.filter(p => p.epa !== 0).length;
const startsSet = plays.filter(p => p.ep_start !== 0).length;
A('the route returns real EPA, not a field of zeros',
  nonZero > plays.length * 0.5,
  `${nonZero} of ${plays.length} plays have a non-zero epa`);
A('...and ep_start is a looked-up value, not the `?? 0` miss',
  startsSet > plays.length * 0.9,
  `${startsSet} of ${plays.length} plays have a non-zero ep_start`);

console.log('\n  Enumerated pairs (the artifact):');
console.log('  idx  drive  play id            relay epa   client epa   agree');
for (const p of pairs)
  console.log(`  ${String(p.i).padStart(3)}  ${String(p.drive).padStart(5)}  ${String(p.id).padEnd(18)} ${String(p.relay).padStart(9)}   ${String(p.client).padStart(10)}   ${p.agree ? 'yes' : 'NO'}`);

const out = {
  probed_at: new Date().toISOString(), game, route: routeUrl,
  route_plays: plays.length, client_plays: reference.length,
  disagreements, pairs,
  verdict: fail === 0 ? 'ROUTE MATCHES CLIENT' : 'FAILED',
};
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync('outbox', { recursive: true });
writeFileSync(`outbox/nfl-epa-route-probe-${TS}.json`, JSON.stringify(out, null, 2));

console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
process.exit(fail === 0 ? 0 : 1);
