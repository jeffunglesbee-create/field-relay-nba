#!/usr/bin/env node
// READ-ONLY. What would it cost to give the 530 a kickoff?
//
// CC-CMD-2026-09-14-closing-odds-captured-after-kickoff, Task 0 residual.
//
// 530 closing lines sit on rows with no start_time and cannot be asked whether
// they preceded kickoff. 476 carry an espn_event_id, which Task 0 recorded as
// "an anchor, resolvability UNTESTED" — and it is still untested, so this probe
// does not assume it resolves.
//
// THE COUNT THAT DECIDES THE DESIGN IS NOT 476. ESPN's scoreboard returns a
// whole day per call, so the real cost is the number of distinct (sport, date)
// slates, not the number of events. Measuring that first is the difference
// between one call per slate and 476 per event.
//
// No existing code path resolves a kickoff from an espn_event_id: start_time
// only ever arrives in the /archive/game POST body (src/index.js ~12676), from
// gm.startTime upstream. So whatever this costs, it is new work — worth sizing
// before writing it.
//
// SELECT only, enforced.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TABLES = ['regular_season_games', 'postseason_games'];
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

const NO_START = `closing_odds IS NOT NULL AND start_time IS NULL`;

(async () => {
  say(`=== what a kickoff would cost for the rows that have none  ${new Date().toISOString()} ===`);

  // ── 1. The unit of work ──────────────────────────────────────────────────
  say(`\n--- 1. rows, and the slates they span`);
  let rows = 0, slates = 0;
  for (const t of TABLES) {
    const r = (await d1(
      `SELECT COUNT(*) n,
              COUNT(DISTINCT sport || '|' || date) slates,
              SUM(CASE WHEN espn_event_id IS NOT NULL THEN 1 ELSE 0 END) with_espn,
              MIN(date) first_date, MAX(date) last_date
         FROM ${t} WHERE ${NO_START}`))[0] || {};
    say(`    ${t}: ${r.n} row(s) across ${r.slates} (sport, date) slate(s)`);
    say(`        ${r.with_espn} carry an espn_event_id · dates ${r.first_date} .. ${r.last_date}`);
    rows += r.n ?? 0; slates += r.slates ?? 0;
  }
  say(`\n    ${rows} rows / ${slates} slates.`
    + `  Per-event lookups: ${rows}. Per-slate: ${slates}.`
    + `  Ratio ${(rows / Math.max(slates, 1)).toFixed(1)}x.`);

  // ── 2. Which sports, because not all have a scoreboard we call ───────────
  // The relay already fetches scoreboards for some sports and not others. A
  // sport with no existing fetch path is new integration work, not a loop, and
  // counting rows without splitting by sport hides that.
  say(`\n--- 2. by sport`);
  for (const t of TABLES) {
    const r = await d1(
      `SELECT sport, COUNT(*) n, COUNT(DISTINCT date) dates,
              SUM(CASE WHEN espn_event_id IS NOT NULL THEN 1 ELSE 0 END) with_espn
         FROM ${t} WHERE ${NO_START} GROUP BY sport ORDER BY n DESC`);
    for (const x of r)
      say(`    ${t} ${String(x.sport).padEnd(12)} ${String(x.n).padStart(4)} row(s), `
        + `${String(x.dates).padStart(3)} date(s), ${x.with_espn} with espn_event_id`);
  }

  // ── 3. The ones with no anchor at all ───────────────────────────────────
  // Rule 99: these are not "resolvable later", they are a separate population
  // with no route identified. Named, so the claim can be checked.
  say(`\n--- 3. rows with neither start_time nor espn_event_id`);
  for (const t of TABLES) {
    const r = await d1(
      `SELECT id, sport, date, home, away FROM ${t}
        WHERE ${NO_START} AND espn_event_id IS NULL ORDER BY date DESC LIMIT 8`);
    const c = (await d1(
      `SELECT COUNT(*) n FROM ${t} WHERE ${NO_START} AND espn_event_id IS NULL`))[0] || {};
    say(`    ${t}: ${c.n}`);
    for (const x of r) say(`        ${x.id}  ${x.sport} ${x.date}  ${x.home} v ${x.away}`);
  }

  const p = `outbox/missing-start-time-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  writeFileSync(`outbox/missing-start-time-failed-${Date.now()}.log`, log.concat(`FAILED: ${e.message}`).join('\n') + '\n');
  process.exit(1);
});
