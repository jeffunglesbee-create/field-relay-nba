#!/usr/bin/env node
// READ-ONLY. CC-CMD-2026-09-14-cup-competitions-under-mls, Task 0.
//
// 243 postseason rows across five cup competitions carry `sport = 'MLS'` and
// have never held a line. The CC-CMD's question was "is there an Odds API sport
// key for these?" and its stated artifact is the map's contents beside the five
// league names. That artifact is already answerable from source and the answer
// is none of them:
//
//   ARCHIVE_SPORT_TO_ODDS_KEY holds 16 keys, every one a league or a sport.
//   No cup appears. src/odds-sport-keys.js:41.
//
// BUT OUR MAP LACKING A KEY IS NOT THE VENDOR LACKING ONE, and only the vendor
// can answer that. /v4/sports is free — `oddsBillablePath` in src/index.js
// excludes it explicitly, so this costs no credit (Rule 78, checked in source
// rather than assumed).
//
// AND THE REFRAME THAT MADE THIS WORTH PROBING FIRST: the archive already knows
// which competition each row belongs to. `league` holds it. runOddsBackfillForDate
// SELECTs `league` (src/index.js:6721) and then buckets on
// `bucketOf(row.sport)` alone (6747), so the column that would answer the
// question is fetched and discarded. If the vendor covers a cup, the fix is a
// bucketing change and NO D1 WRITE AT ALL — not the 243-row relabel the CC-CMD
// was scoped around.
//
// NO WRITE PATH. SELECT only, enforced.
import { writeFileSync } from 'node:fs';
import { ARCHIVE_SPORT_TO_ODDS_KEY, archiveSportToOddsKey } from '../src/odds-sport-keys.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this probe issues SELECT only');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 400)}`);
  return b.results || [];
}

(async () => {
  say(`=== cup competitions vs odds keys  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  // --- 1. the archive's own grouping, re-measured rather than quoted
  // The CC-CMD's table is a prior session's measurement (Rule 72: an inherited
  // claim is a hypothesis). This asks the archive again.
  const groups = await d1(
    `SELECT sport, COALESCE(league,'(null)') AS league, COUNT(*) AS rows,
            SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS opening,
            SUM(CASE WHEN closing_odds IS NOT NULL THEN 1 ELSE 0 END) AS closing,
            MIN(date) AS first_date, MAX(date) AS last_date
       FROM postseason_games WHERE sport = 'MLS'
      GROUP BY sport, league ORDER BY rows DESC`);
  say(`\n--- 1. postseason_games where sport = 'MLS', grouped by league`);
  let total = 0, withOdds = 0;
  for (const g of groups) {
    total += g.rows; withOdds += (g.opening || 0) + (g.closing || 0);
    say(`    ${String(g.league).padEnd(32)} ${String(g.rows).padStart(4)} rows   `
      + `opening ${g.opening}  closing ${g.closing}   ${g.first_date} → ${g.last_date}`);
  }
  say(`    ${total} row(s) across ${groups.length} league value(s); ${withOdds} odds value(s) in total`);

  // --- 2. what the archive map says about each league name
  say(`\n--- 2. ARCHIVE_SPORT_TO_ODDS_KEY, asked with the LEAGUE name`);
  say(`    the map holds ${Object.keys(ARCHIVE_SPORT_TO_ODDS_KEY).length} keys: `
    + Object.keys(ARCHIVE_SPORT_TO_ODDS_KEY).join(', '));
  for (const g of groups)
    say(`    ${String(g.league).padEnd(32)} -> ${archiveSportToOddsKey(g.league) ?? 'NO KEY'}`);

  // --- 3. the vendor's own list. Free: oddsBillablePath excludes /v4/sports.
  const res = await fetch(`${RELAY}/odds/v4/sports`, { headers: { 'User-Agent': UA } });
  if (!res.ok) { say(`\n--- 3. vendor sports list: HTTP ${res.status} — UNANSWERED`); }
  else {
    const list = await res.json().catch(() => []);
    const soccer = (Array.isArray(list) ? list : []).filter(s =>
      String(s.key || '').startsWith('soccer') || /cup|concacaf|leagues|open cup|championship/i.test(String(s.title || '')));
    say(`\n--- 3. vendor /v4/sports: ${Array.isArray(list) ? list.length : 0} sport(s), `
      + `${soccer.length} soccer or cup-titled`);
    // SUBSTRING MATCHING ON A TITLE ASSERTS A KEY IT HAS NOT EARNED, and the
    // first run of this probe did exactly that: "TELUS Canadian Championship"
    // contains "championship", the vendor's literal title for `soccer_efl_champ`
    // — the English second tier. Reported as a match, that is a substituted key,
    // the same class of defect HANDOFF records for 2026-09-13 (`Liberty` ->
    // `newyorkliberty`, six CFB rows carrying another sport's team).
    //
    // So EXACT TITLE EQUALITY DECIDES, and anything looser is printed as a
    // candidate for human eyes, never as an answer.
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    for (const g of groups) {
      const name = String(g.league || '');
      if (name === '(null)') continue;
      const exact = soccer.find(s => norm(s.title) === norm(name));
      say(`    ${name.padEnd(32)} -> ${exact ? `${exact.key}  (${exact.title}, active=${exact.active})` : 'NOT OFFERED BY THE VENDOR'}`);
      if (!exact) {
        // A shared token is a hint, not a verdict. Generic words are dropped so
        // "championship" and "cup" cannot carry a match on their own.
        const GENERIC = new Set(['cup', 'championship', 'league', 'liga', 'open', 'first', 'super', 'division', 'the']);
        const want = new Set(norm(name).split(' ').filter(t => t.length > 2 && !GENERIC.has(t)));
        const near = soccer.filter(s => norm(s.title).split(' ').some(t => want.has(t)));
        for (const c of near.slice(0, 3))
          say(`        candidate, NOT asserted: ${c.key}  (${c.title})`);
        if (!near.length) say(`        no candidate shares a distinctive word`);
      }
    }
    say(`\n    every soccer key the vendor offers, for a reader checking the match by eye:`);
    for (const s of soccer.slice(0, 40)) say(`      ${String(s.key).padEnd(34)} ${s.title}${s.active === false ? '  (inactive)' : ''}`);
    if (soccer.length > 40) say(`      … ${soccer.length - 40} more`);
  }

  say(`\nCOVERAGE: step 1 reads every postseason row with sport='MLS', no sampling.`);
  say(`    Step 3 lists at most 40 of the vendor's soccer keys; the per-league`);
  say(`    verdicts above are matched against all ${'of them'}.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`outbox/cup-competitions-odds-keys-${stamp}.log`, log.join('\n') + '\n');
  console.log(`\nwrote outbox/cup-competitions-odds-keys-${stamp}.log`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
