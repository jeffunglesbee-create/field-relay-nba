#!/usr/bin/env node
// READ-ONLY WATCH. Is a row's `league` naming a competition the vendor covers,
// while its `sport` sends the odds backfill somewhere else?
//
// WHY THIS EXISTS, and why it is not the fix for the 243 rows that prompted it.
//
// 243 postseason rows across five cup competitions carry sport='MLS'.
// runOddsBackfillForDate SELECTs `league` (src/index.js:6721) and then buckets
// on `bucketOf(row.sport)` alone (6747) — the column that names the competition
// is fetched and discarded. That looked like the fix until the vendor was
// asked: MEASURED 2026-09-15, /v4/sports offers 86 sports and NONE of the five
// is among them. CONCACAF Champions Cup, Leagues Cup, U.S. Open Cup, TELUS
// Canadian Championship, Campeones Cup — no key exists, so no bucketing change
// and no relabel can produce a line for those rows. They are correctly
// unmatched.
//
// What is NOT settled is the next one. A competition the vendor DOES cover,
// landing with a sport label that points elsewhere, would be silently starved
// exactly the same way and nothing would say so. That is what this watches:
//
//     league maps to an odds key  AND  sport maps to a different one (or none)
//
// It is deliberately silent about the 243: their league maps to nothing, so
// they cannot trip it, and a watch that fired on them every day would be noise
// asking for a fix that does not exist.
//
// NO WRITE PATH. SELECT only, enforced.
import { writeFileSync } from 'node:fs';
import { archiveSportToOddsKey } from '../src/odds-sport-keys.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this watch issues SELECT only');
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
  say(`=== league outranks sport watch  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  const offenders = [], inert = [];
  let pairs = 0;
  for (const table of ['regular_season_games', 'postseason_games']) {
    const rows = await d1(
      `SELECT sport, league, COUNT(*) AS rows,
              SUM(CASE WHEN opening_odds IS NULL THEN 1 ELSE 0 END) AS no_opening
         FROM ${table}
        WHERE league IS NOT NULL AND sport IS NOT NULL AND league <> sport
        GROUP BY sport, league`);
    for (const r of rows) {
      pairs++;
      const byLeague = archiveSportToOddsKey(r.league);
      const bySport  = archiveSportToOddsKey(r.sport);
      if (byLeague && byLeague !== bySport)
        offenders.push({ table, ...r, byLeague, bySport: bySport ?? 'none' });
      else if (!byLeague)
        inert.push({ table, ...r });
    }
  }

  say(`\n    (sport, league) pairs where the two disagree : ${pairs}`);
  say(`    league maps to an odds key its sport does not : ${offenders.length}   <- gated`);
  say(`    league maps to no odds key at all             : ${inert.length}   (not gated — no key exists to route to)`);

  for (const o of offenders)
    say(`      ${o.table}  sport=${o.sport} -> ${o.bySport}   league=${o.league} -> ${o.byLeague}`
      + `   ${o.rows} row(s), ${o.no_opening} without an opening line`);
  for (const i of inert.slice(0, 8))
    say(`      inert: ${i.league} under ${i.sport}  (${i.rows} rows)`);
  if (inert.length > 8) say(`      … ${inert.length - 8} more inert pair(s)`);

  say(`\n    COVERAGE: both games tables, every (sport, league) pair where the two`);
  say(`    differ — no sampling. The five cup competitions under MLS sit in the`);
  say(`    inert group: MEASURED 2026-09-15, the vendor offers none of them, so`);
  say(`    no routing change could give them a line.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`outbox/league-outranks-sport-${stamp}.log`, log.join('\n') + '\n');

  if (offenders.length) {
    console.error(`\nFAIL: ${offenders.length} (sport, league) pair(s) route to the wrong odds key.`);
    console.error(`      runOddsBackfillForDate buckets on sport alone, so these rows are`);
    console.error(`      asked for the wrong competition's payload every day.`);
    process.exit(1);
  }
  console.log(`\nOK: no row's league names a covered competition its sport routes away from.`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
