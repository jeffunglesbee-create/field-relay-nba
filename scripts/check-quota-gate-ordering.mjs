#!/usr/bin/env node
// Rule 99 (DISTINGUISHABILITY-A) regression guard for the odds quota gate.
//
// Two structurally identical loops in src/index.js decide whether to keep
// calling the Odds API. Before 2026-09-11 both got this wrong the same way, and
// the earlier partial fix is why this guard exists rather than a comment: a
// `> 0` guard had been added to the INNER check and not the outer one, so a
// fabricated zero survived one iteration and terminated the next.
//
// Three properties, per loop:
//   A. the floor gate tests `typeof x === 'number'`, never truthiness or
//      `!== null` -- null (vendor silent) must not gate, a real 0 must.
//   B. `lastQuota = quotaRemaining` occurs AFTER the `ok` check -- a failed
//      fetch says nothing about quota and must not overwrite a real reading.
//   C. no `quotaRemaining > 0 &&` guard remains -- with null distinct there is
//      no fabricated zero to defend against, and that form would let a genuine
//      exhaustion through.
//
// Reads src/index.js, the source. Not a copy, not a summary.

import { readFileSync } from 'node:fs';

const LOOPS = [
    // Full destructuring, not the call alone: `await fetchSportOddsLive(env,
    // sportKey)` also appears in the /identity/mismatches route, and an anchor
    // that matches twice made every mutation "caught" by a uniqueness error
    // rather than by the property it was testing (2026-09-11).
    { name: 'snapshotCronOdds',    anchor: 'const { games, quotaRemaining, ok } = await fetchSportOddsLive(env, sportKey);' },
    { name: 'historical backfill', anchor: 'const { games, quotaRemaining, ok, snapshotAt } = await fetchSportOddsHistorical(env, sportKey, isoDate);' },
];

export function checkSource(src) {
    const problems = [];
    for (const { name, anchor } of LOOPS) {
        const i = src.indexOf(anchor);
        if (i === -1) { problems.push(`${name}: anchor not found — this guard is aimed at nothing`); continue; }
        if (src.indexOf(anchor, i + 1) !== -1) { problems.push(`${name}: anchor is not unique`); continue; }

        // Window: from 600 chars before the fetch (to include the outer gate)
        // to 600 after (to include the assignment and inner gate).
        const w = src.slice(Math.max(0, i - 600), i + 600);

        const typedGates = (w.match(/typeof\s+\w+\s*===\s*'number'\s*&&\s*\w+\s*<\s*ODDS_QUOTA_FLOOR/g) || []).length;
        if (typedGates < 2) problems.push(`${name}: A — expected 2 typed floor gates, found ${typedGates}`);

        const okIdx     = w.search(/if\s*\(!ok\)/);
        const assignIdx = w.search(/lastQuota\s*=\s*quotaRemaining/);
        if (okIdx === -1)     problems.push(`${name}: B — no \`if (!ok)\` check in window`);
        else if (assignIdx === -1) problems.push(`${name}: B — no \`lastQuota = quotaRemaining\` in window`);
        else if (assignIdx < okIdx) problems.push(`${name}: B — lastQuota assigned BEFORE the ok check`);

        if (/quotaRemaining\s*>\s*0\s*&&/.test(w)) problems.push(`${name}: C — a \`quotaRemaining > 0 &&\` guard remains`);
    }
    return problems;
}

// Rule 90: the guard must be shown able to fail, and the mutation harness must
// prove it actually mutated. NOT CAUGHT with nothing mutated is worse than no
// test at all.
function selfTest(src) {
    const MUTATIONS = [
        ['A: untype one floor gate',
         [`typeof lastQuota === 'number' && lastQuota < ODDS_QUOTA_FLOOR`,
          `lastQuota !== null && lastQuota < ODDS_QUOTA_FLOOR`]],
        ['B: assign lastQuota before the ok check',
         [`    if (!ok) continue;\n    // AFTER the ok check`,
          `    lastQuota = quotaRemaining;\n    if (!ok) continue;\n    // AFTER the ok check`]],
        ['C: reinstate the `> 0` guard',
         [`if (typeof quotaRemaining === 'number' && quotaRemaining < ODDS_QUOTA_FLOOR) return lastQuota;`,
          `if (quotaRemaining > 0 && quotaRemaining < ODDS_QUOTA_FLOOR) return lastQuota;`]],
    ];
    let ok = true;
    for (const [label, [from, to]] of MUTATIONS) {
        const n = src.split(from).length - 1;
        if (n === 0) { console.error(`  SELF-TEST BROKEN: "${label}" anchor absent — NOTHING MUTATED`); ok = false; continue; }
        const mutated = src.replace(from, to);
        if (mutated === src) { console.error(`  SELF-TEST BROKEN: "${label}" replace was a no-op`); ok = false; continue; }
        const found = checkSource(mutated);
        if (!found.length) { console.error(`  SELF-TEST FAILED: "${label}" mutated ${n} site(s) and the guard stayed green`); ok = false; continue; }
        // Caught is not enough: it must be caught by the property under test.
        // Every mutation once reported "anchor is not unique", which is the
        // guard failing to aim, not the guard working.
        const letter = label[0];
        if (!found.some(f => f.includes(`: ${letter} —`))) {
            console.error(`  SELF-TEST FAILED: "${label}" was caught, but by ${found[0]} — not by property ${letter}`);
            ok = false; continue;
        }
        console.log(`  caught "${label}" -> ${found.find(f => f.includes(`: ${letter} —`))}`);
    }
    return ok;
}

const path = process.argv[2] || 'src/index.js';
const src = readFileSync(path, 'utf8');

console.log(`mutation self-test (${LOOPS.length} loops, 3 properties each):`);
if (!selfTest(src)) { console.error('\nthe guard cannot be made to fail — it does not go in'); process.exit(1); }

const problems = checkSource(src);
console.log(`\nchecked ${LOOPS.length} of ${LOOPS.length} quota-gated loops in ${path}`);
if (problems.length) {
    console.error(`\nFAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log('PASS — both loops: typed floor gates, assignment after ok, no `> 0` guard');
