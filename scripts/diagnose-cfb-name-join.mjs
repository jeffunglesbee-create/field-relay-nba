// Why did 95 vendor events match 0 of 80 archive games?
//
// RULE 42 ON THE NUMBER. A naming-convention difference produces a PARTIAL
// match — "Alabama", "Georgia", "Ohio State" spell identically in any system,
// so some of 80 would land. Exactly ZERO is a structural failure, not a
// cosmetic one, and building a fuzzy matcher before knowing which would be
// fixing the wrong layer.
//
// So this checks the FREE side first: does the archive even hold team names for
// those rows? Nulls, ids, or a different column would explain 0/80 instantly
// and cost nothing. Only if the archive side looks fine does the vendor half
// become worth 20 credits.
//
// --with-vendor re-fetches the same sport-date (20 credits) and prints the
// vendor's own home_team/away_team plus commence_time, because the other
// structural candidate is the DATE: the call asks for a historical snapshot at
// {date}T12:00:00Z, and a Saturday CFB slate kicks off long after noon UTC. If
// those 95 events carry commence_time values on a different date, the join
// never had a chance regardless of naming.
//
// READ-ONLY against D1. The vendor half is a GET.

import { backfillSportToOddsKey } from '../src/odds-sport-keys.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;   // no default: an unset secret must 401, not look set
const ODDS_KEY = process.env.ODDS_API_KEY;
const DATE  = process.argv.find(a => a.startsWith('--date='))?.split('=')[1] || '2026-09-12';
const SPORT = (process.argv.find(a => a.startsWith('--sport='))?.split('=')[1] || 'cfb').toLowerCase();
const WITH_VENDOR = process.argv.includes('--with-vendor');

async function d1(sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('SELECT only');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

console.log(`=== cfb name join diagnosis  ${SPORT} ${DATE}  utc=${new Date().toISOString()} ===\n`);

const rows = await d1(
  `SELECT id, home, away, start_time, espn_event_id
     FROM regular_season_games
    WHERE LOWER(sport) = ? AND date = ?
    ORDER BY id`, [SPORT, DATE]);

console.log(`archive rows: ${rows.length}`);
const nullHome = rows.filter(r => !r.home).length;
const nullAway = rows.filter(r => !r.away).length;
console.log(`  home IS NULL/empty : ${nullHome}`);
console.log(`  away IS NULL/empty : ${nullAway}`);

if (nullHome === rows.length || nullAway === rows.length) {
  console.log(`\nSTRUCTURAL: the archive holds no team names for these rows, so no`);
  console.log(`matcher could have joined them. The vendor half is not worth buying.`);
  process.exit(1);
}

console.log(`\n  first 10 archive pairs (raw -> normalised):`);
for (const r of rows.slice(0, 10)) {
  console.log(`      "${r.away}" @ "${r.home}"`);
  console.log(`        -> ${norm(r.away)} @ ${norm(r.home)}    start_time=${r.start_time ?? 'null'}`);
}

if (!WITH_VENDOR) {
  console.log(`\nThe archive side has names. Re-run with --with-vendor (20 credits) to`);
  console.log(`see what the vendor returns for the same sport-date and compare.`);
  console.log(`\nCOVERAGE: ${rows.length} archive rows for ${SPORT} on ${DATE}. No vendor call made.`);
  process.exit(0);
}

if (!ODDS_KEY) { console.error('missing ODDS_API_KEY'); process.exit(1); }

const sportKey = backfillSportToOddsKey(SPORT);
const url = `https://api.the-odds-api.com/v4/historical/sports/${encodeURIComponent(sportKey)}/odds`
  + `?apiKey=${ODDS_KEY}&regions=us&markets=h2h&oddsFormat=american&date=${DATE}T12:00:00Z`;
const res = await fetch(url);
console.log(`\nvendor ${sportKey} @ ${DATE}T12:00:00Z -> HTTP ${res.status} (20 credits spent)`);
if (!res.ok) process.exit(1);
const payload = await res.json();
const events = payload?.data || [];
console.log(`  snapshot timestamp : ${payload?.timestamp ?? 'none'}`);
console.log(`  events             : ${events.length}`);

// THE DATE CHECK, which is the candidate a name comparison would never surface.
const byDate = {};
for (const e of events) {
  const d = String(e.commence_time || '').slice(0, 10) || '(none)';
  byDate[d] = (byDate[d] || 0) + 1;
}
console.log(`\n  vendor events by commence_time DATE:`);
for (const [d, n] of Object.entries(byDate).sort()) {
  console.log(`      ${String(n).padStart(3)}  ${d}${d === DATE ? '   <- the date we asked about' : ''}`);
}

console.log(`\n  first 10 vendor pairs (raw -> normalised):`);
for (const e of events.slice(0, 10)) {
  console.log(`      "${e.away_team}" @ "${e.home_team}"   ${e.commence_time}`);
  console.log(`        -> ${norm(e.away_team)} @ ${norm(e.home_team)}`);
}

const vendorNames = new Set(events.flatMap(e => [norm(e.home_team), norm(e.away_team)]));
const archiveNames = new Set(rows.flatMap(r => [norm(r.home), norm(r.away)]));
const shared = [...archiveNames].filter(n => vendorNames.has(n));
console.log(`\n  distinct normalised names — archive ${archiveNames.size}, vendor ${vendorNames.size}`);
console.log(`  names present in BOTH: ${shared.length}`);
if (shared.length) console.log(`      e.g. ${shared.slice(0, 8).join(', ')}`);
// Capture BOTH sides as a fixture so the matcher can be iterated offline.
// Without this, every matcher attempt costs 20 credits; with it, the vendor
// payload is bought once and tried against as many times as it takes.
if (process.argv.includes('--dump')) {
  const fs = await import('node:fs');
  const path = `outbox/fixture-${SPORT}-${DATE}.json`;
  fs.writeFileSync(path, JSON.stringify({
    captured_at: new Date().toISOString(),
    sport: SPORT, date: DATE, sport_key: sportKey,
    snapshot_timestamp: payload?.timestamp ?? null,
    archive: rows.map(r => ({ id: r.id, home: r.home, away: r.away, start_time: r.start_time })),
    vendor: events.map(e => ({ id: e.id, home_team: e.home_team, away_team: e.away_team,
                               commence_time: e.commence_time })),
  }, null, 2) + '\n');
  console.log(`\n  wrote ${path} — ${rows.length} archive rows, ${events.length} vendor events.`);
  console.log(`  The matcher can now be developed against this at zero further cost.`);
}

console.log(`\n  If the overlap is large but 0 games matched, the defect is the PAIRING`);
console.log(`  (home/away orientation, or a date mismatch), not the names. If the`);
console.log(`  overlap is near zero, the two systems name teams differently and a`);
console.log(`  fuzzy matcher is the wrong fix — an id join is.`);
console.log(`\nCOVERAGE: one sport-date. 20 credits spent on exactly one vendor call.`);
