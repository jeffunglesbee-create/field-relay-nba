#!/usr/bin/env node
// Guards ADR-002 PROHIBITED #3 at the generation step.
//
// WHY (CC-CMD-2026-08-20-brief-data-quality ask 1):
// Two prompt builders used to inject ` Drama: ${drama_peak}/100` into the
// DEBRIEF CONTEXT block. The model transcribed it verbatim into user-facing
// prose — "in a game with a 52/100 drama rating" (game_recap_la liga_401882925,
// 2026-08-19). PROHIBITED #3 bans a raw composite drama number displayed to the
// user, and the 2026-07-07 corrections explicitly do NOT relax it
// (ADR-002-CONTEXT.md L75-78).
//
// The previous mitigation was the prompt instruction "don't list mechanically".
// It did not hold. An instruction to a model is not a guardrail; this is.
//
// SCOPE, deliberately narrow (Rule 69): this checks only that a raw composite
// drama NUMBER is not pushed into prompt text. It does not touch storage or
// serving — Rule E permits both, and the post-game amnesty zone covers the
// briefs themselves. Nothing here constrains drama_peak in D1, in
// /archive/query, or in any client-side render.
//
// Comments are stripped before matching, because the fix sites carry long
// explanatory comments that quote the removed line verbatim. A naive grep
// flags those and would make the guard unusable — the classic "matched, but
// not for the right reason" failure (Rule 90).

import { readFileSync } from 'node:fs';

const FILE = 'src/index.js';
const raw = readFileSync(FILE, 'utf8');

// Strip /* block */ and // line comments. Crude but sufficient: we only need
// executable text, and a false negative here would require a drama number
// hidden inside a string that looks like a comment.
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const PATTERNS = [
    {
        name: 'drama number pushed into prompt lines',
        // e.g. lines.push(` Drama: ${x}/100`)  /  _lines.push(`… ${y}/100 …`)
        re: /\b_?lines\.push\([^)]*\/\s*100/,
    },
    {
        name: 'literal "Drama: ${…}" interpolation',
        re: /Drama:\s*\$\{/,
    },
    {
        name: 'drama rating phrase built in code',
        re: /`[^`]*drama\s+(rating|score)[^`]*\$\{/i,
    },
];

let failed = false;
const lines = code.split('\n');

for (const { name, re } of PATTERNS) {
    const hits = [];
    lines.forEach((l, i) => { if (re.test(l)) hits.push(`${i + 1}: ${l.trim().slice(0, 120)}`); });
    if (hits.length) {
        failed = true;
        console.error(`FAIL: ${name} — ${hits.length} occurrence(s) in ${FILE}`);
        for (const h of hits) console.error(`   ${h}`);
    } else {
        console.log(`ok: no ${name}`);
    }
}

if (failed) {
    console.error(`
A raw composite drama number must not reach generated prose (ADR-002
PROHIBITED #3). Storing it and serving it on pull remain permitted (Rule E) —
this is only about the number entering prompt text and being transcribed.
If a tonal signal is wanted, propose a NON-numeric band; do not re-add a value.`);
    process.exit(1);
}
console.log('PASS: no raw drama number reaches prompt text.');
