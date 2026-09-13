#!/usr/bin/env node
// Every odds writer fetches the payload for the ROW'S OWN sport.
//
// WHY THIS EXISTS AND WHY IT REPLACES `ambiguous_key_count == 0`.
//
// The census reports 11 keys claimed by two sport families: `richmond` is an
// AFL club and a CFB programme, `sanfranciscogiants` is claimed by MLB's Giants
// and the NFL's, `texasrangers` by MLB and a Scottish football side, and seven
// MLS/WNBA short forms are also CFB programme names. That number is a fact about
// how sport names teams. No edit to this repo can make it zero — only
// sport-qualifying every join key could, which would rewrite every join in the
// system — so a done condition requiring zero can never be met, and a watch
// carrying it reports OPEN forever and gets muted.
//
// It is also inert, and THAT is the thing worth holding still. A cross-sport key
// can only do harm if a row is ever offered another sport's payload. It is not:
//
//   snapshotCronOdds          SELECT ... WHERE date = ? AND sport = ?
//   runOddsBackfillForDate    buckets rows by archiveSportToOddsKey(row.sport)
//                             and fetches once per bucket
//   /archive/game             archiveSportToOddsKey(sport) for that one game
//
// So the guarantee does not rest on the alias table at all, and did not rest on
// 9366af9 either. It rests on three SELECT/dispatch shapes, which a fourth
// writer could quietly fail to copy. This check is that guarantee made
// mechanical: a join site with no sport scoping in the function that reaches it
// goes red here rather than silently inheriting a protection it does not have.
import { readFileSync } from 'node:fs';
import { decomment, functionBody } from './lib/route-scan.mjs';

const SRC = 'src/index.js';
const raw = readFileSync(SRC, 'utf8');

// The census's cross-sport reach probe also calls findOddsForRow. It is a
// diagnostic against a synthetic one-game payload, not a writer, and it is
// excluded BY ITS OWN CALL SHAPE rather than by a line number or a count — a
// real join written in that shape would be a bug in the probe, not a way past
// this check.
const PROBE_CALL = 'findOddsForRow(present, name, REACH_CONTROL_B)';

// WHAT COUNTS AS SPORT-SCOPED, and why it is not just "the word
// archiveSportToOddsKey appears nearby". A bare keyword search would have passed
// on this very file: the census comment fifty lines above one site names both
// scoping shapes in prose. Comments are stripped, and the rule is stated against
// the DATA PATH instead:
//
//   the payload this join reads came from a fetchSportOdds* call whose sport
//   argument is a variable, and that variable is derived from a row's own sport
//   in the same window — never a literal, never a constant.
//
// So a fourth writer that hardcodes a sport key, or fetches one sport's payload
// and joins a whole date's rows against it, fails here.
const FETCH = /\b(fetchSportOdds(?:Live|Historical))\s*\(\s*env\s*,\s*([^,)]+)/;
const LOOKBACK = 140;

let checked = 0, failed = 0;
const eq = (label, got, want) => {
  checked++;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const allLines = raw.split('\n');
const sites = [];
allLines.forEach((line, i) => {
  if (!line.includes('findOddsForRow(')) return;
  if (line.trimStart().startsWith('//')) return;
  if (line.includes(PROBE_CALL)) return;
  sites.push({ line: i + 1, text: line.trim() });
});

eq('three join sites, the census reach probe excluded by its call shape',
   sites.length, 3);
eq('the census reach probe is present and is the excluded one',
   raw.split(PROBE_CALL).length - 1, 1);

for (const site of sites) {
  const window = decomment(
    allLines.slice(Math.max(0, site.line - 1 - LOOKBACK), site.line).join('\n'));
  // The LAST fetch before the join is the one that produced its payload.
  const fetches = [...window.matchAll(new RegExp(FETCH, 'g'))];
  const last = fetches[fetches.length - 1];
  eq(`join at ${SRC}:${site.line} reads a payload from a fetchSportOdds* call`,
     !!last, true);
  if (!last) continue;
  const arg = last[2].trim();
  eq(`join at ${SRC}:${site.line} fetches by variable, not a hardcoded sport (${last[1]}, arg \`${arg}\`)`,
     /^[A-Za-z_$][\w$]*$/.test(arg), true);
  // …and that variable carries a row's own sport into the fetch.
  const derived = new RegExp(
    `(?:const|let|var)\\s+${arg}\\s*=\\s*archiveSportToOddsKey\\(`  // direct
    + `|for\\s*\\(\\s*const\\s*\\[\\s*${arg}\\s*,[^\\]]*\\]\\s*of\\s+buckets`  // per-bucket
  ).test(window);
  eq(`join at ${SRC}:${site.line} derives \`${arg}\` from the row's own sport`,
     derived, true);
}

// The buckets a per-bucket fetch iterates have exactly one writer, and it is the
// sport map. Without this, the `of buckets` branch above would accept a bucket
// keyed on anything at all.
const bucketWriter = decomment(raw).match(/const\s+bucketOf\s*=\s*\(sport\)\s*=>\s*\{[\s\S]{0,400}?\}/);
eq('bucketOf keys its buckets by archiveSportToOddsKey',
   !!bucketWriter && /archiveSportToOddsKey\s*\(\s*sport\s*\)/.test(bucketWriter[0]), true);

// The one writer that scopes in SQL rather than in dispatch. Stated separately,
// and pinned to that function's own body, because it is the only protection that
// lives in a query string — nothing else in this file would notice it going
// missing, and a file-wide count would not either: the same SQL appears a second
// time in /identity/mismatches, which is read-only and sport-scoped for its own
// reasons. Counting occurrences across the file would let one satisfy the other.
const snapshotBody = decomment(functionBody('snapshotCronOdds') || '');
eq('snapshotCronOdds selects only rows of the sport it just fetched',
   /WHERE date = \? AND sport = \? AND opening_odds IS NULL/.test(snapshotBody), true);

// Rule 91: the denominator, in the result, not in a comment.
console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` — ${sites.length} join site(s) in ${SRC}, ${LOOKBACK}-line lookback,`
          + ` comments stripped`);
process.exit(failed ? 1 : 0);
