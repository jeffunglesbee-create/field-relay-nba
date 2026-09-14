#!/usr/bin/env node
// READ-ONLY. What do the 219 late closing lines actually change?
//
// RULE 42. Three obvious moves on 219 rows holding an in-play price in a
// column named `closing` -- relabel them, re-fetch them, leave them -- all
// assume the defect is the stored value. The stored value is a real capture of
// a real price; what is false is only the name of the column it sits in, and
// that was corrected this morning: every askable row carries
// `_kickoff: { at, verified, late_minutes }`.
//
// So the question is not "how do we fix 219 rows". It is "what reads them, and
// does the mark change what that reader decides". This probe counts the
// decisions that flip. It writes nothing.
//
// It measures the SOURCE rules, imported from src/odds-consumer-rules.js, not
// a restatement of them -- a probe that re-implements its subject verifies the
// copy.
//
// NO WRITE PATH. SELECT only, enforced.
import { writeFileSync } from 'node:fs';
import { selectLineOdds, winnerMoneylinePrice, lineSpread,
         parseOddsJSON, knownPostKickoff, lateMinutes } from '../src/odds-consumer-rules.js';

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

// The two consumer thresholds, quoted from their call sites so a reader can
// check them without opening another file:
//   analytics-engine.js:459  `if (ml != null && ml >= 200)`      -> upset finding
//   analytics-engine.js:795  `if (Math.abs(spread) < 3)`         -> +2 tight line
const UPSET_AT = 200;
const TIGHT_UNDER = 3;

const TABLES = ['regular_season_games', 'postseason_games'];
const LEGACY = { requirePreKickoff: false };   // closing || opening
const RULE   = { requirePreKickoff: true };    // skip a blob marked post-kickoff

const tally = {
  rows: 0, withClosing: 0,
  closingVerified: 0, closingLate: 0, closingUnmarked: 0,
  scored: 0,
  upsetLegacy: 0, upsetRule: 0, upsetFabricated: 0, upsetErased: 0,
  tightLegacy: 0, tightRule: 0, tightFlipped: 0,
  spreadBoth: 0,
  proseWouldPrintLate: 0,
  storyPairs: 0, storyFromLateClose: 0,
  fallbackBlanked: 0,
};
const examples = { fabricated: [], erased: [], tight: [], blanked: [] };

(async () => {
  say(`=== late-close consumer flip  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  for (const table of TABLES) {
    const rows = await d1(
      `SELECT id, sport, date, home, away, home_score, away_score,
              opening_odds, closing_odds
         FROM ${table}
        WHERE closing_odds IS NOT NULL`
    );
    say(`\n--- ${table}: ${rows.length} row(s) with a closing_odds value`);
    tally.rows += rows.length;

    for (const r of rows) {
      const close = parseOddsJSON(r.closing_odds);
      const open  = parseOddsJSON(r.opening_odds);
      if (!close) continue;
      tally.withClosing++;

      if (close._kickoff?.verified === true) tally.closingVerified++;
      else if (knownPostKickoff(close))      tally.closingLate++;
      else                                    tally.closingUnmarked++;

      // --- odds-story.js: a movement narrated from a pre -> in-play pair
      if (open && close) {
        tally.storyPairs++;
        if (knownPostKickoff(close)) tally.storyFromLateClose++;
      }

      // --- index.js 5637/9259: the debrief prompt prints `closed home X`
      // straight off closing_odds whenever opening_odds exists.
      if (open && knownPostKickoff(close) && close.moneyline?.home != null) {
        tally.proseWouldPrintLate++;
      }

      // --- analytics-engine.js: both rules need a decided game
      const decided = Number.isFinite(r.home_score) && Number.isFinite(r.away_score)
                   && r.home_score !== r.away_score;
      if (!decided) continue;
      tally.scored++;

      const mlLegacy = winnerMoneylinePrice(r, LEGACY);
      const mlRule   = winnerMoneylinePrice(r, RULE);
      const upLegacy = mlLegacy != null && mlLegacy >= UPSET_AT;
      const upRule   = mlRule   != null && mlRule   >= UPSET_AT;
      if (upLegacy) tally.upsetLegacy++;
      if (upRule)   tally.upsetRule++;
      if (upLegacy && !upRule) {
        tally.upsetFabricated++;
        if (examples.fabricated.length < 5)
          examples.fabricated.push(`${r.id}  ${r.home} ${r.home_score}-${r.away_score} ${r.away}  `
            + `in-play +${Math.round(mlLegacy)} (${lateMinutes(close)} min late) vs pre-kickoff `
            + `${mlRule == null ? 'no line' : (mlRule > 0 ? '+' : '') + Math.round(mlRule)}`);
      }
      if (upRule && !upLegacy) {
        tally.upsetErased++;
        if (examples.erased.length < 5)
          examples.erased.push(`${r.id}  pre-kickoff +${Math.round(mlRule)} vs in-play `
            + `${mlLegacy == null ? 'no line' : Math.round(mlLegacy)}`);
      }

      const spLegacy = lineSpread(r, LEGACY);
      const spRule   = lineSpread(r, RULE);
      if (spLegacy != null && spRule != null) tally.spreadBoth++;
      const tiLegacy = spLegacy != null && Math.abs(spLegacy) < TIGHT_UNDER;
      const tiRule   = spRule   != null && Math.abs(spRule)   < TIGHT_UNDER;
      if (tiLegacy) tally.tightLegacy++;
      if (tiRule)   tally.tightRule++;
      if (tiLegacy !== tiRule) {
        tally.tightFlipped++;
        if (examples.tight.length < 5)
          examples.tight.push(`${r.id}  spread ${spLegacy} -> ${spRule == null ? 'none' : spRule}`);
      }

      // Rows where applying the rule leaves NO usable price at all.
      const sel = selectLineOdds(r, RULE);
      if (!sel.odds && parseOddsJSON(r.closing_odds)) {
        tally.fallbackBlanked++;
        if (examples.blanked.length < 5) examples.blanked.push(r.id);
      }
    }
  }

  const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : 'n/a';

  say(`\n--- 1. what the mark says about the ${tally.withClosing} closing values`);
  say(`    verified pre-kickoff : ${tally.closingVerified}`);
  say(`    marked post-kickoff  : ${tally.closingLate}`);
  say(`    unmarked (unknown)   : ${tally.closingUnmarked}`);

  say(`\n--- 2. upset detection  (analytics-engine.js:459, winner ML >= +${UPSET_AT})`);
  say(`    decided games measured : ${tally.scored}`);
  say(`    upsets found, today    : ${tally.upsetLegacy}`);
  say(`    upsets found, rule     : ${tally.upsetRule}`);
  say(`    FABRICATED (today says upset, pre-kickoff line does not): ${tally.upsetFabricated}`);
  say(`    ERASED     (pre-kickoff line says upset, today does not): ${tally.upsetErased}`);
  for (const e of examples.fabricated) say(`      fabricated: ${e}`);
  for (const e of examples.erased)     say(`      erased:     ${e}`);

  say(`\n--- 3. tight line  (analytics-engine.js:795, |spread| < ${TIGHT_UNDER})`);
  say(`    rows with a spread under both rules : ${tally.spreadBoth}`);
  say(`    tight today / tight under rule      : ${tally.tightLegacy} / ${tally.tightRule}`);
  say(`    FLIPPED                             : ${tally.tightFlipped}`);
  for (const e of examples.tight) say(`      ${e}`);

  say(`\n--- 4. prose and narrative`);
  say(`    debrief rows that would print an in-play price as "closed" : ${tally.proseWouldPrintLate}`);
  say(`    opening+closing pairs                                      : ${tally.storyPairs}`);
  say(`    of those, closing is post-kickoff (movement is pre->in-play): ${tally.storyFromLateClose}`
      + `  (${pc(tally.storyFromLateClose, tally.storyPairs)})`);

  say(`\n--- 5. cost of the rule`);
  say(`    decided rows left with NO usable price : ${tally.fallbackBlanked}`);
  for (const e of examples.blanked) say(`      ${e}`);

  say(`\nCOVERAGE: every row in ${TABLES.join(' + ')} with a non-NULL closing_odds was read`);
  say(`    — ${tally.withClosing} of ${tally.rows} parsed; no sampling. Rows with closing_odds`);
  say(`    NULL are outside the question and are not counted in any figure above.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `outbox/late-close-consumer-flip-${stamp}.log`;
  writeFileSync(path, log.join('\n') + '\n');
  console.log(`\nwrote ${path}`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
