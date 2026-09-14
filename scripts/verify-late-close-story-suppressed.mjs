#!/usr/bin/env node
// DONE CONDITION for the pre-kickoff selection rule (Rule 89: an artifact, not
// an action). The claim is that the deployed relay no longer narrates line
// movement that ends at an in-play price. The artifact is
// /odds-story/preview: for every archived pair whose closing blob is marked
// post-kickoff AND whose blobs still compute a non-empty story, the live route
// must now return `story: ''`.
//
// THE VACUITY GUARD IS THE POINT. A route returning '' for every row would
// satisfy a naive version of this check while proving nothing. So the script
// first computes, locally, how many rows WOULD have carried a story under the
// old rule, and fails if that number is zero -- there would be nothing to
// suppress and therefore nothing measured.
//
// NO WRITE PATH. SELECT only, enforced.
import { writeFileSync } from 'node:fs';
import { computeOddsStory } from '../src/odds-story.js';
import { knownPostKickoff, parseOddsJSON, lateMinutes } from '../src/odds-consumer-rules.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this script issues SELECT only');
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
  say(`=== late-close story suppression  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  // The mark lives inside the JSON blob, so SQL narrows and JS decides.
  const suspects = [];
  for (const table of ['regular_season_games', 'postseason_games']) {
    const rows = await d1(
      `SELECT id, date, opening_odds, closing_odds FROM ${table}
        WHERE opening_odds IS NOT NULL AND closing_odds IS NOT NULL
          AND closing_odds LIKE '%"verified":false%'`
    );
    for (const r of rows) {
      const close = parseOddsJSON(r.closing_odds);
      if (!knownPostKickoff(close)) continue;          // LIKE narrowed; the rule decides
      const wouldHave = computeOddsStory(r.opening_odds, r.closing_odds);
      suspects.push({ ...r, wouldHave, late: lateMinutes(close) });
    }
  }
  const changed = suspects.filter(s => s.wouldHave);
  say(`\n--- 0. ${suspects.length} pair(s) with a post-kickoff closing blob`);
  say(`    of those, ${changed.length} would have carried a story under the old rule`);
  if (!changed.length) {
    say('\nFAIL: nothing to suppress — this check would pass vacuously.');
    process.exit(1);
  }
  for (const c of changed.slice(0, 5)) say(`    ${c.id}  (+${c.late} min)  ${c.wouldHave.slice(0, 90)}`);

  const dates = [...new Set(changed.map(c => c.date))].sort();
  const byId = new Map(changed.map(c => [c.id, c]));
  let checkedRows = 0, stillNarrating = 0, notSeen = 0;
  const offenders = [];

  for (const date of dates) {
    const res = await fetch(`${RELAY}/odds-story/preview?date=${date}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) { say(`    ${date}: HTTP ${res.status}`); continue; }
    const body = await res.json().catch(() => ({}));
    const seen = new Set();
    for (const g of (body.games || [])) {
      seen.add(g.id);
      if (!byId.has(g.id)) continue;
      checkedRows++;
      if (g.story) { stillNarrating++; offenders.push(`${g.id}: ${g.story.slice(0, 80)}`); }
    }
    for (const c of changed) if (c.date === date && !seen.has(c.id)) notSeen++;
  }

  say(`\n--- 1. live /odds-story/preview over ${dates.length} date(s)`);
  say(`    rows checked           : ${checkedRows} of ${changed.length}`);
  say(`    rows not returned      : ${notSeen}`);
  say(`    STILL NARRATING        : ${stillNarrating}`);
  for (const o of offenders.slice(0, 10)) say(`      ${o}`);

  say(`\nCOVERAGE: every date carrying one of the ${changed.length} changed rows was asked`);
  say(`    — ${dates.length} date(s), no sampling. Rows whose blobs compute no story either`);
  say(`    way (${suspects.length - changed.length} of ${suspects.length}) are excluded: suppressing them would prove nothing.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `outbox/late-close-story-suppressed-${stamp}.log`;
  const ok = stillNarrating === 0 && checkedRows > 0;
  say(ok
    ? `\nOK: ${checkedRows} row(s) that used to narrate a pre->in-play movement now return no story.`
    : `\nFAIL: ${stillNarrating} row(s) still narrate a movement ending at an in-play price.`);
  writeFileSync(path, log.join('\n') + '\n');
  console.log(`\nwrote ${path}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
