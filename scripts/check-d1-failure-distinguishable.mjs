#!/usr/bin/env node
// Rule 99 (DISTINGUISHABILITY-A) regression guard for the D1 read paths.
//
// Eight sites in src/index.js used `.all().catch(() => ({ results: [] }))`,
// which made a FAILED query indistinguishable from "no rows" and let each
// consumer report it as a successful answer about the data:
// /archive/drama/leaderboard answered HTTP 200 {ok:true, games:[]}; the
// postseason cron helper answered the literal string 'no active postseason
// series'; /integrity/briefs fed a fabricated slateCount into the divergence
// signal that gates its repair path; /backfill/brief-scores reported found: 0.
//
// Two properties, asserted against the source:
//   A. No `.all()` in src/ is followed by a catch returning an empty result set.
//      That exact form is what the fix replaced; it must not come back.
//   B. Every d1AllOrError call site branches on `.error` within 6 lines. A
//      helper that reports failure into a variable nobody reads is the same
//      defect wearing the fix's clothes.
//
// Reads the source. Mutation-tests itself on every run (Rule 90).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BANNED = /\.all\(\)\s*\.catch\s*\([^)]*\)\s*=>\s*\(?\s*\{\s*results\s*:\s*\[\s*\]\s*\}/;

function jsFiles(dir, out = []) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) jsFiles(p, out);
        else if (p.endsWith('.js')) out.push(p);
    }
    return out;
}

export function checkSource(src, label) {
    const problems = [];
    const lines = src.split('\n');

    lines.forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;             // a comment about it is not it
        if (BANNED.test(line)) problems.push(`${label}: A — \`.all().catch(→ {results: []})\` returned at :${i + 1}`);
    });

    // Property B is "checked BEFORE read", not "checked within N lines". A fixed
    // window is the wrong test and said so on its first run: /archive/drama/
    // leaderboard checks `reg.error || ps.error` together after BOTH queries,
    // which is correct code 8 lines away. Widening the window to make that pass
    // would have been tuning the matcher to the answer; this asserts the real
    // invariant instead, and is stricter, not looser — a check that comes after
    // the first read now fails even if it is on the very next line.
    lines.forEach((line, i) => {
        const m = line.match(/(?:const|let)\s+([\w$]+)\s*=\s*await\s+d1AllOrError\(/);
        if (!m) return;
        const raw = m[1];
        const name = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const errRe = new RegExp(`\\b${name}\\.error\\b`);
        const resRe = new RegExp(`\\b${name}\\.results\\b`);
        let firstRead = -1, firstCheck = -1;
        for (let j = i; j < lines.length && j < i + 60; j++) {
            if (/^\s*\/\//.test(lines[j])) continue;
            if (firstCheck === -1 && errRe.test(lines[j])) firstCheck = j;
            if (firstRead === -1 && resRe.test(lines[j])) firstRead = j;
        }
        if (firstCheck === -1)
            problems.push(`${label}: B — d1AllOrError result \`${raw}\` at :${i + 1} is never checked for .error`);
        else if (firstRead !== -1 && firstRead < firstCheck)
            problems.push(`${label}: B — \`${raw}.results\` is read at :${firstRead + 1} before \`${raw}.error\` is checked at :${firstCheck + 1}`);
    });
    return problems;
}

const SRC = 'src';
const files = jsFiles(SRC);
const sources = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));

// Rule 90. Each mutation must be applied (anchor present) AND caught by its own
// property letter — the quota-gate guard's first version passed all three of
// its mutations via an anchor-uniqueness error, which is the guard failing to
// aim, not the guard working.
function selfTest() {
    const idx = sources.get('src/index.js');
    if (!idx) { console.error('src/index.js not found — this guard is aimed at nothing'); return false; }
    const MUTS = [
        ['A: reinstate the banned catch',
         [`  const _seriesStmt = env.ARCHIVE_DB.prepare(`,
          `  const _x = await q.all().catch(() => ({ results: [] }));\n  const _seriesStmt = env.ARCHIVE_DB.prepare(`]],
        ['B: stop checking .error on a result',
         [`  if (seriesResult.error) return { ok: false, skipped: true, reason: 'series query failed', error: seriesResult.error };`,
          `  // error check removed by mutation`]],
    ];
    let ok = true;
    for (const [label, [from, to]] of MUTS) {
        const n = idx.split(from).length - 1;
        if (n === 0) { console.error(`  SELF-TEST BROKEN: "${label}" anchor absent — NOTHING MUTATED`); ok = false; continue; }
        const found = checkSource(idx.replace(from, to), 'src/index.js');
        const letter = label[0];
        const hit = found.find(f => f.includes(`: ${letter} —`));
        if (!hit) { console.error(`  SELF-TEST FAILED: "${label}" mutated ${n} site(s); caught=${JSON.stringify(found)}`); ok = false; continue; }
        console.log(`  caught "${label}" -> ${hit}`);
    }
    return ok;
}

console.log('mutation self-test:');
if (!selfTest()) { console.error('\nthe guard cannot be made to fail — it does not go in'); process.exit(1); }

const problems = files.flatMap(f => checkSource(sources.get(f), f));
const callSites = [...sources.values()].join('\n').split('await d1AllOrError(').length - 1;
console.log(`\nchecked ${files.length} files under ${SRC}/, ${callSites} d1AllOrError call site(s)`);
if (problems.length) {
    console.error(`\nFAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log('PASS — no .all() collapses a failure into an empty result, and every d1AllOrError result is checked');
