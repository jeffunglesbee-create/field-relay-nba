#!/usr/bin/env node
// Deploy gate: a change to SCALE must come with a SCORING_ERAS entry.
//
// THE BUG THIS PREVENTS HAS ALREADY HAPPENED, and cost more than this file.
// On 2026-07-16, commit 6aed3bb changed two dimensions and recorded no era.
// The mlb_game stored mean fell 203.2 -> 135.4 across that boundary, and two
// separate calibration rechecks (2026-07-16, 2026-07-17) burned themselves out
// asking whether the quality trend was real. Rescoring the corpus under one
// rubric later showed the two eras differ by 0.9 points. The entire 68-point
// "collapse" was the instrument, and SCORING_ERAS was written afterwards, with
// recordedRetroactively: true, so nobody would have to work that out again.
//
// SCORING_ERAS' own header says "Add an entry BEFORE deploying any scoreProse
// change that moves scores." That instruction has no enforcement, which is the
// same shape as the four quality guards this session found wired into nothing:
// a rule everybody agrees with and nothing checks.
//
// HOW IT WORKS. The expected fingerprint of SCALE is stored below. Change SCALE
// without touching it and this fails, naming both values. Clearing it requires
// adding an era entry and updating the fingerprint in the same commit — which is
// exactly the two-step the rule asks for, made mechanical.
//
// It deliberately does NOT try to detect "scores moved" by scoring anything.
// A weight change moves scores by construction; a fingerprint is a fact, and a
// heuristic would be one more thing to argue with at 2am.

import { SCALE, SCORING_ERAS, CURRENT_SCORING_ERA, NOMINAL_TOTAL } from '../src/journalism-quality.js';

// Update this in the SAME commit that changes SCALE, alongside a new
// SCORING_ERAS entry. The value is printed by this script when it fails.
const EXPECTED_SCALE_FINGERPRINT =
  'arc:33|ctx:17|density:10|finality:20|fresh:36|margin:30|spec:30|statDepth:38|temporal:20|variety:30|voice:30';
// The era that the fingerprint above belongs to.
//
// Still 4 after the 2026-08-24 SCALE correction, and that is not an oversight.
// A new era exists to separate two INSTRUMENTS, and no instrument changed: dims
// 6-10 were never read by scoreProse, so writing their real ceilings into SCALE
// moved no score. Minting era 5 for it would split /quality/report's calibration
// window in half for a change that cannot move a percentile.
//
// So the rule below: a fingerprint change needs EITHER a new era OR a
// `correctedOn` on the latest era saying why no score moved. Without that
// escape hatch this check forces a fake era; without the requirement, a real
// reweighting could hide behind the word "correction".
const EXPECTED_ERA_FOR_FINGERPRINT = 6;

// The fingerprint this one REPLACED, and the era it belonged to. Without this
// the file has no history and the correction rule below cannot fire: it compared
// CURRENT_SCORING_ERA against EXPECTED_ERA_FOR_FINGERPRINT, which are updated
// together in the same commit and are therefore always equal. It failed era 5 —
// a legitimate new era — while a SCALE edit that bumped only the fingerprint
// would have sailed through, which is backwards from what it is for.
const PREVIOUS_SCALE_FINGERPRINT =
  'arc:33|ctx:17|density:10|finality:20|fresh:36|matchup:30|spec:30|statDepth:38|temporal:20|variety:30|voice:30';
const PREVIOUS_ERA = 5;

const fingerprint = Object.keys(SCALE).sort()
  .map(k => `${k}:${SCALE[k]}`).join('|');

let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); }
};

console.log('scoring era recorded');

check('SCALE matches its recorded fingerprint', fingerprint === EXPECTED_SCALE_FINGERPRINT,
  `SCALE changed and no era was recorded for it.\n`
  + `       expected: ${EXPECTED_SCALE_FINGERPRINT}\n`
  + `       actual:   ${fingerprint}\n`
  + `       Scores before and after this change are NOT comparable. Add a\n`
  + `       SCORING_ERAS entry with a measured effect (scripts/rescore-quality-6b.mjs\n`
  + `       produces one), then set EXPECTED_SCALE_FINGERPRINT to the actual value\n`
  + `       above and EXPECTED_ERA_FOR_FINGERPRINT to the new era, in this commit.`);

check(`CURRENT_SCORING_ERA is ${EXPECTED_ERA_FOR_FINGERPRINT}`,
  CURRENT_SCORING_ERA === EXPECTED_ERA_FOR_FINGERPRINT,
  `got ${CURRENT_SCORING_ERA} — the fingerprint and the era table disagree about which era is current.`);

// An era entry with no measured effect is the thing the 68-point incident
// actually needed and did not have. "Recorded" without a number is a note.
const latest = SCORING_ERAS[SCORING_ERAS.length - 1];
check('the latest era states a measured effect',
  typeof latest?.measuredEffect === 'string' && /\d/.test(latest.measuredEffect),
  `era ${latest?.era} carries measuredEffect=${JSON.stringify(latest?.measuredEffect)} — an era entry with no number in it cannot answer "was the change or the prose responsible", which is the only question the table exists for.`);

// A fingerprint change with no new era is legal ONLY as a declared correction.
const latestEra = SCORING_ERAS[SCORING_ERAS.length - 1];
const isCorrection = typeof latestEra?.correctedOn === 'string'
  && typeof latestEra?.correction === 'string' && /\d/.test(latestEra.correction);
const fingerprintChanged = EXPECTED_SCALE_FINGERPRINT !== PREVIOUS_SCALE_FINGERPRINT;
const eraWasMinted = EXPECTED_ERA_FOR_FINGERPRINT > PREVIOUS_ERA;
check('a SCALE change either mints an era or is a declared correction',
  !fingerprintChanged || eraWasMinted || isCorrection,
  `the fingerprint moved from era ${PREVIOUS_ERA}'s and era ${EXPECTED_ERA_FOR_FINGERPRINT} `
  + `is not newer, so this must be a correction — but era ${CURRENT_SCORING_ERA} carries no `
  + `correctedOn/correction saying why no score moved.`);
check('the previous fingerprint is not the current one',
  fingerprintChanged,
  'PREVIOUS_SCALE_FINGERPRINT was not updated when SCALE changed, so the rule above cannot fire.');

check('every era entry has era, from, change and measuredEffect',
  SCORING_ERAS.every(e => e.era != null && e.from && e.change && e.measuredEffect));

check('era numbers are unique and ascending',
  SCORING_ERAS.every((e, i) => i === 0 || e.era > SCORING_ERAS[i - 1].era));

check('era `from` timestamps are ascending',
  SCORING_ERAS.every((e, i) => i === 0 || e.from > SCORING_ERAS[i - 1].from));

// The nominal total is what every threshold in the codebase reads against —
// 240, 196 and 110. A reweighting that changes it moves all three at once while
// looking like a weighting change.
//
// 294, not 300, as of 2026-08-24 — and it was ALWAYS 294. scoreProse's
// `Math.min(300, ...)` has never bound and cannot: base <= 144 and dims 6-10
// <= 150. The old 300 was the sum of a table whose second half was
// documentation. Correcting it moved no score; it corrected the description of
// scores that already existed. See the SCALE block in src/journalism-quality.js
// and scripts/check-scale-matches-implementation.mjs, which now makes the
// declared half and the implemented half unable to disagree.
check(`nominal total is still 294 (got ${NOMINAL_TOTAL})`, NOMINAL_TOTAL === 294,
  'Every score threshold in the codebase reads against this total. Changing it silently moves 240, 196 and 110 at the same time.');

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
