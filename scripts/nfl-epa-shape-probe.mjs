// nfl-epa-shape-probe.mjs — PRE-BUILD probe for NFL EPA wiring (P1-1/P1-2).
//
// Verifies the inherited-from-Drive (May 27) claims that the NFL EPA code will
// depend on, against LIVE data, before a line of client code is written:
//
//   1. ESPN NFL summary carries drives.previous[].plays[] with per-play
//      start.{down,distance,yardsToEndzone}, type.text, scoringPlay, and
//      end.{down,distance,yardsToEndzone} — the exact fields _computeESPNPlayEPA
//      reads. (Rule 72: the doc is 11 weeks old and its own case study is about
//      trusting ESPN field assumptions.)
//   2. The LIVE relay /espn-summary/sports/football/nfl/summary?event=<id> route
//      serves that payload (the exact URL the client will fetch).
//   3. A per-play home/away score field exists for the card's homePts/awayPts.
//
// Runs on a GH Actions runner (unrestricted egress). Sandbox returns HTTP 000
// to ESPN and 403 to *.workers.dev, so this cannot run in-session — CI-as-proxy.
//
// Output: a PASS/FAIL line per assertion + a dumped sample play, to stdout
// (committed to outbox/nfl-epa-shape-probe-<TS>.log by archive-gap-probe.yml).

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SB = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

let pass = 0, fail = 0;
const A = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  cond ? pass++ : fail++;
};

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  const txt = await r.text();
  let body = null;
  try { body = JSON.parse(txt); } catch { /* leave null */ }
  return { status: r.status, body, txt };
}

// ── 1. Find an NFL game id that actually has plays ──────────────────────────
// Aug 15 2026 = NFL preseason. Sweep the last ~14 days of scoreboard for a game
// with completed/live drives so plays[] is populated.
async function findGameWithPlays() {
  const today = new Date();
  for (let back = 0; back <= 14; back++) {
    const d = new Date(today.getTime() - back * 86400000);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const { status, body } = await getJSON(`${SB}?dates=${ymd}`);
    if (status !== 200 || !body?.events?.length) continue;
    for (const ev of body.events) {
      const st = ev.status?.type?.state;           // 'pre' | 'in' | 'post'
      if (st === 'pre') continue;                  // no plays before kickoff
      return { id: ev.id, name: ev.name, date: ymd, state: st };
    }
  }
  return null;
}

const game = await findGameWithPlays();
if (!game) {
  console.log('  FAIL  no in/post NFL game found in last 14 days — cannot probe play shape');
  console.log(`\n== RESULT: 0 passed, 1 failed ==`);
  process.exit(1);
}
console.log(`Game: ${game.name} (id=${game.id}, ${game.date}, state=${game.state})\n`);

// ── 2. Fetch the summary via the LIVE relay — the exact client URL ──────────
const relayUrl = `${RELAY}/espn-summary/sports/football/nfl/summary?event=${game.id}`;
const { status, body: summary } = await getJSON(relayUrl);
A('relay /espn-summary returns 200', status === 200, `HTTP ${status}`);
A('summary has drives object', !!summary?.drives, summary?.drives ? 'present' : 'MISSING');

// ── 3. Extract plays exactly as _fetchNFLGameEpa will ───────────────────────
const drives = summary?.drives || {};
const prev = Array.isArray(drives.previous) ? drives.previous : [];
const curr = drives.current;
A('drives.previous is a non-empty array', prev.length > 0, `len=${prev.length}`);

const allPlays = [];
for (const dr of prev) for (const p of (dr.plays || [])) allPlays.push(p);
if (curr?.plays) allPlays.push(...curr.plays);
A('at least one play extracted', allPlays.length > 0, `plays=${allPlays.length}`);

// Find a normal snap (has start.down) to validate the EPA-relevant fields.
const snap = allPlays.find(p => p?.start && p.start.down >= 1 && p.start.down <= 4);
A('found a snap with start.down 1-4', !!snap);

if (snap) {
  A('play.start.down present', typeof snap.start.down === 'number', String(snap.start?.down));
  A('play.start.distance present', typeof snap.start.distance === 'number', String(snap.start?.distance));
  A('play.start.yardsToEndzone present (== yardline_100, no conversion)',
    typeof snap.start.yardsToEndzone === 'number', String(snap.start?.yardsToEndzone));
  A('play.start.yardsToEndzone in [1,99]',
    snap.start.yardsToEndzone >= 1 && snap.start.yardsToEndzone <= 99, String(snap.start?.yardsToEndzone));
  A('play.type.text present (SKIP_TYPES + FG/miss detection)',
    typeof snap.type?.text === 'string', JSON.stringify(snap.type?.text));
  A('play.scoringPlay is boolean', typeof snap.scoringPlay === 'boolean', String(snap.scoringPlay));
  A('play.end present with .yardsToEndzone (normal-play EP_end)',
    !!snap.end && typeof snap.end.yardsToEndzone === 'number',
    snap.end ? `end.yTE=${snap.end.yardsToEndzone} end.down=${snap.end.down} end.dist=${snap.end.distance}` : 'NO end');
}

// Per-play score field for homePts/awayPts (doc assumed play.homeScore/awayScore).
const scored = allPlays.find(p => p && (p.homeScore !== undefined || p.awayScore !== undefined));
A('a play carries homeScore/awayScore', !!scored,
  scored ? `homeScore=${scored.homeScore} awayScore=${scored.awayScore}` : 'NEITHER FIELD FOUND ON ANY PLAY');

// isTurnover — the doc read play.isTurnover. Confirm whether it exists at all.
const anyTurnoverField = allPlays.some(p => p && 'isTurnover' in p);
A('play.isTurnover field exists on plays (turnover branch)', anyTurnoverField,
  anyTurnoverField ? 'present' : 'ABSENT — turnover branch needs a different signal');

// ── Dump one full sample snap so the real shape is on the record ────────────
if (snap) {
  console.log('\n-- SAMPLE SNAP (trimmed) --');
  console.log(JSON.stringify({
    type: snap.type, scoringPlay: snap.scoringPlay, isTurnover: snap.isTurnover,
    start: snap.start, end: snap.end, homeScore: snap.homeScore, awayScore: snap.awayScore,
    text: (snap.text || '').slice(0, 80),
  }, null, 2));
}

console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
process.exit(fail > 0 ? 1 : 0);
