#!/usr/bin/env node
// READ-ONLY WATCH. Can a closing line still acquire a run-clock captured_at?
//
// The code path that produced 58 of them was fixed on 2026-08-22 and is now
// gated by scripts/check-captured-at-explicit.mjs — but that gate reads THIS
// repo's source. A different writer, a manual /d1/execute, or a route added
// later can all put the same shape back, and nothing in CI would notice.
//
// So this watches the archive rather than the code. It fails when the count of
// UNMARKED run-clock closing stamps exceeds the committed baseline, which is
// the only way the population can grow without someone deciding it should.
//
// The baseline lives in docs/run-clock-closing-baseline.txt and is lowered by
// hand when a marking run reduces it — never raised to make a red run green.
// Raising it is the thing this file exists to make visible.
//
// NO WRITE PATH. SELECT only, enforced.
import { readFileSync, writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASELINE_FILE = 'docs/run-clock-closing-baseline.txt';
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

const MS = `GLOB '*.[0-9][0-9][0-9]Z'`;
const TABLES = ['regular_season_games', 'postseason_games'];

(async () => {
  say(`=== run-clock closing stamps watch  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  const baseline = Number(readFileSync(BASELINE_FILE, 'utf8').trim());
  if (!Number.isFinite(baseline)) { console.error(`FAIL: ${BASELINE_FILE} is not a number`); process.exit(1); }

  // Widened on purpose: ANY source, not just draftkings. The 58 happened to
  // come from one route; the hazard is the shape, and pinning it to the source
  // that produced it would make this watch blind to the next one.
  let unmarked = 0, marked = 0, newest = null;
  for (const table of TABLES) {
    const [r] = await d1(
      `SELECT SUM(CASE WHEN json_extract(closing_odds,'$._capture') IS NULL THEN 1 ELSE 0 END) AS u,
              SUM(CASE WHEN json_extract(closing_odds,'$._capture') IS NOT NULL THEN 1 ELSE 0 END) AS m,
              MAX(json_extract(closing_odds,'$.captured_at')) AS newest
         FROM ${table}
        WHERE closing_odds IS NOT NULL
          AND json_extract(closing_odds,'$.captured_at') ${MS}`);
    unmarked += r?.u || 0; marked += r?.m || 0;
    if (r?.newest && (!newest || r.newest > newest)) newest = r.newest;
  }

  say(`\n    baseline (committed)          : ${baseline}`);
  say(`    unmarked run-clock stamps     : ${unmarked}`);
  say(`    marked as run-clock           : ${marked}`);
  say(`    newest run-clock stamp seen   : ${newest ?? 'none'}`);
  say(`    a1937eb fixed the known path on 2026-08-22T21:11:07Z — a newer stamp`);
  say(`    than that is a NEW writer, not residue.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`outbox/run-clock-closing-watch-${stamp}.log`, log.join('\n') + '\n');

  if (unmarked > baseline) {
    console.error(`\nFAIL: ${unmarked} unmarked against a baseline of ${baseline}. Something is still`);
    console.error(`      writing a closing line stamped with its own clock. Find it before`);
    console.error(`      raising ${BASELINE_FILE} — raising it is how this stops being a watch.`);
    process.exit(1);
  }
  if (unmarked < baseline)
    console.log(`\nOK, and the baseline is stale: ${unmarked} < ${baseline}. Lower ${BASELINE_FILE} to ${unmarked}.`);
  else console.log(`\nOK: ${unmarked} unmarked, at the baseline.`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
