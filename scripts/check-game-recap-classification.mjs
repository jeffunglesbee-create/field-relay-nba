#!/usr/bin/env node
// Guards CC-CMD-2026-08-20-brief-data-quality ask 2.
//
// THE BUG: `brief_type` was decided in four places — three hardcoded
// `'game_recap'` literals inside INSERT statements, plus one classifier that
// tested score presence:
//
//   briefType = (home_score != null) ? 'game_recap' : 'narrative_context'
//
// Score presence separates PRE-GAME from NOT-PRE-GAME. It cannot separate
// IN-PROGRESS from FINAL — a game five minutes in has a score of 0-0. So every
// live capture was written as a recap, which is how "remain scoreless … through
// 46 minutes of play" shipped as a `game_recap` on 2026-08-19 and topped the
// slate's quality scores.
//
// All four now route through gameBriefTypeForFinality(). This check keeps them
// there: a fifth write site pasting the literal back in is the realistic
// regression, and it would be invisible in review.
//
// Comments are stripped first — the fix sites carry explanatory comments that
// quote the removed literal verbatim, and a naive grep flags its own
// documentation (Rule 90: matched, but not for the right reason).

import { readFileSync } from 'node:fs';

const FILE = 'src/index.js';
const raw = readFileSync(FILE, 'utf8');
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let failed = false;

// 1. No hardcoded brief_type literal inside a briefs INSERT.
const insertLiteral = /VALUES\s*\([^)]*'(game_recap|game_live)'/g;
const litHits = [...code.matchAll(insertLiteral)];
if (litHits.length) {
    failed = true;
    console.error(`FAIL: ${litHits.length} briefs INSERT(s) hardcode a brief_type literal.`);
    console.error('       Route it through gameBriefTypeForFinality() instead — four sites');
    console.error('       already do, and a fifth divergent copy is how the rule drifts.');
    for (const h of litHits) console.error(`   ${h[0].slice(0, 100)}`);
} else {
    console.log('ok: no hardcoded brief_type literal in a briefs INSERT');
}

// 2. The score-presence classifier must not come back.
const scoreClassifier = /home_score\s*!==?\s*(null|undefined)[^\n]*\?\s*'game_recap'/;
if (scoreClassifier.test(code)) {
    failed = true;
    console.error("FAIL: brief_type is being decided by score presence again.");
    console.error('       A score does not mean the game ended. Gate on finality.');
} else {
    console.log('ok: no score-presence brief_type classifier');
}

// 3. The helpers must still exist and be the single source.
for (const fn of ['function gameBriefTypeForFinality', 'async function isGameFinalByEventId']) {
    if (!code.includes(fn)) {
        failed = true;
        console.error(`FAIL: ${fn} missing — the shared classifier is the whole point of ask 2.`);
    } else {
        console.log(`ok: ${fn.split(' ').pop()} present`);
    }
}

// 4. The enqueue must still forward ESPN's completed flag, or the dominant
//    writer silently falls back to 'game_recap' for everything.
if (!/isFinal:\s*!!comp\.status\?\.type\?\.completed/.test(code)) {
    failed = true;
    console.error("FAIL: the game-brief enqueue no longer forwards isFinal.");
    console.error('       Without it job.isFinal is undefined and every brief resolves');
    console.error('       to game_recap — the exact pre-fix behaviour, silently.');
} else {
    console.log('ok: enqueue forwards ESPN status.type.completed as isFinal');
}

if (failed) process.exit(1);
console.log('PASS: game_recap classification is gated on finality, single-sourced.');
