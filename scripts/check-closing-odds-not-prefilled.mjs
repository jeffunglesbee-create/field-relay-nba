#!/usr/bin/env node
// Guards CC-CMD-2026-08-21-closing-odds-capture.
//
// THE DEFECT: `.github/scripts/odds-backfill.js` wrote BOTH opening_odds and
// closing_odds from a single historical snapshot, for every game it touched —
// including games that had not kicked off yet. AmbientDO._captureClosingOdds
// fires on the pre→live transition and writes `WHERE closing_odds IS NULL`, so
// a pre-filled column made that guard false forever and the real capture never
// landed. Opening and closing ended up byte-identical, with closing's
// captured_at at or even BEFORE opening's (measured on /context/date/2026-08-21:
// WNBA open 10:00:54.720Z vs "close" 10:00:36.300Z).
//
// The visible consequence was in another repo entirely: field-laboratory's
// OddsStory.Moved branch has been built and shipped since June and had never
// once been reachable, because it correctly refuses to narrate a movement from
// a non-sequence. A dormant feature was the only symptom.
//
// WHAT THIS CHECKS: that the closing_odds write stays gated on the game being
// in the past. It does NOT ban the write outright — for a completed game there
// is no kickoff left to capture and the single-data-point behaviour is correct,
// which is why the fix is a date gate rather than a deletion.

import { readFileSync } from 'node:fs';

const FILE = '.github/scripts/odds-backfill.js';
const raw = readFileSync(FILE, 'utf8');

// Strip comments — this file documents the defect it fixes, and a naive match
// would flag its own explanation (the Rule 90 lesson from
// check-no-drama-number-in-prompts).
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let failed = false;

// 1. The date gate must exist and be tied to closing_odds specifically.
if (!/isPast/.test(code) || !/game_date/.test(code)) {
    failed = true;
    console.error('FAIL: the past-game gate is gone from the odds backfill sync.');
    console.error('       closing_odds must only be batch-written for games already played;');
    console.error('       otherwise AmbientDO._captureClosingOdds can never win its');
    console.error('       `WHERE closing_odds IS NULL` race and line movement stays dormant.');
} else {
    console.log('ok: past-game gate present (isPast / game_date)');
}

// 2. The field list must be conditional, not a bare pair. This is the exact
//    line that caused the defect, so it is matched literally.
if (/for\s*\(\s*const\s+field\s+of\s*\[\s*'opening_odds'\s*,\s*'closing_odds'\s*\]/.test(code)) {
    failed = true;
    console.error("FAIL: the sync loops over ['opening_odds','closing_odds'] unconditionally.");
    console.error('       That is the original defect verbatim. Select the field list from');
    console.error('       the row\'s own date instead.');
} else {
    console.log('ok: field list is not the unconditional opening/closing pair');
}

// 3. The relay-side hook must still exist — if it is deleted, gating the batch
//    write just means nothing writes closing_odds at all, which is worse than
//    the defect and would pass checks 1 and 2.
const ado = readFileSync('src/ambient-do.js', 'utf8');
if (!/_captureClosingOdds/.test(ado) || !/pendingStarts/.test(ado)) {
    failed = true;
    console.error('FAIL: AmbientDO no longer has the pre→live closing-odds capture.');
    console.error('       The backfill gate assumes this hook owns today\'s games. Without');
    console.error('       it, closing_odds is simply never written.');
} else {
    console.log('ok: AmbientDO._captureClosingOdds still wired to pendingStarts');
}

if (failed) process.exit(1);
console.log('PASS: closing_odds is left to the kickoff hook for games not yet played.');
