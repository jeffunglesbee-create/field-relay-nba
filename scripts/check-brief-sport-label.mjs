#!/usr/bin/env node
// Guards CC-CMD-2026-08-20-brief-data-quality ask 3 (relay half).
//
// THE BUG: the pre-game brief writer bound `label.toLowerCase()` into the
// briefs.sport column. `label` is the correct declared label from the cron
// LEAGUES table, so this turned 'MLB' -> 'mlb', 'La Liga' -> 'la liga', 'UEFA
// Europa Conference League Qualifying' -> all lowercase.
//
// It stayed invisible because the ID kept the right casing — it is built from
// the game row id, not from `label` — so a row read fine until you filtered on
// sport. Measured 2026-08-21: ~145 such rows, still written daily at the 10:01
// tick. A brief whose sport matches no declared label is unreachable by every
// sport-filtered read, including /archive/query?sport=.
//
// This is the SECOND site with this exact defect: CC-CMD-2026-07-15 fixed the
// same lowercasing at the kv_capture path. A bug class that recurs at a new site
// is the definition of something that needs a guard rather than another fix.
//
// HOW IT DISTINGUISHES AN ID FROM A COLUMN VALUE: brief ids are built inside
// template literals (`${type}_${sport.toLowerCase()}_${eventId}`) and are
// lowercased BY CONVENTION — that is correct and must keep working. Column
// values are bare expressions in the bind list. So template-literal spans are
// stripped before matching, leaving only column arguments. A blanket
// "no toLowerCase in bind args" check would flag the legitimate id construction
// and be turned off within a week.

import { readFileSync } from 'node:fs';

const FILE = 'src/index.js';
const raw = readFileSync(FILE, 'utf8');

// Strip comments — the fix site quotes the removed expression verbatim, and a
// naive match flags its own documentation (Rule 90).
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let failed = false;

// Walk every `INSERT INTO briefs` and inspect its bind list.
const inserts = [...code.matchAll(/INSERT INTO briefs/g)].map(m => m.index);
console.log(`found ${inserts.length} briefs INSERT site(s)`);

let checked = 0;
for (const start of inserts) {
    const region = code.slice(start, start + 3000);
    const bindAt = region.indexOf('.bind(');
    if (bindAt === -1) continue;
    const runAt = region.indexOf('.run()', bindAt);
    if (runAt === -1) continue;
    let args = region.slice(bindAt + 6, runAt);

    // Remove template-literal spans: those are id construction, where
    // lowercasing is the established and correct convention.
    args = args.replace(/`[^`]*`/g, '');

    checked++;
    if (/\.toLowerCase\s*\(\s*\)/.test(args)) {
        failed = true;
        const line = code.slice(0, start).split('\n').length;
        console.error(`FAIL: briefs INSERT near line ${line} lowercases a bind argument.`);
        console.error('       Column values must carry the declared label verbatim; only ids are');
        console.error('       lowercased. Bind canonicalizeWC26Sport(label), not label.toLowerCase().');
    }
}
if (!failed) console.log(`ok: no briefs INSERT lowercases a column bind argument (${checked} bind lists checked)`);

// The known-good expression must still be at the pre-game site — if someone
// removes it the check above still passes, since absence is not lowercasing.
if (!/canonicalizeWC26Sport\(label\)/.test(code)) {
    failed = true;
    console.error('FAIL: the pre-game brief writer no longer binds canonicalizeWC26Sport(label).');
    console.error('       Ask 3 fixed exactly that expression; losing it silently reopens the defect.');
} else {
    console.log('ok: pre-game writer binds canonicalizeWC26Sport(label)');
}

if (failed) process.exit(1);
console.log('PASS: briefs.sport carries declared labels, not lowercased ones.');
