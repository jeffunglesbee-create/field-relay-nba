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
  'arc:55|ctx:32|density:10|fresh:36|matchup:24|spec:30|statDepth:38|temporal:25|variety:30|voice:20';
// The era that the fingerprint above belongs to.
const EXPECTED_ERA_FOR_FINGERPRINT = 4;

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

check('every era entry has era, from, change and measuredEffect',
  SCORING_ERAS.every(e => e.era != null && e.from && e.change && e.measuredEffect));

check('era numbers are unique and ascending',
  SCORING_ERAS.every((e, i) => i === 0 || e.era > SCORING_ERAS[i - 1].era));

check('era `from` timestamps are ascending',
  SCORING_ERAS.every((e, i) => i === 0 || e.from > SCORING_ERAS[i - 1].from));

// The nominal total is what every threshold in the codebase reads against —
// 240, 196 and 110 all assume 300. A reweighting that changes it moves all
// three at once while looking like a weighting change.
check(`nominal total is still 300 (got ${NOMINAL_TOTAL})`, NOMINAL_TOTAL === 300,
  'Every score threshold in the codebase reads against 300. Changing the total silently moves 240, 196 and 110 at the same time.');

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
