#!/usr/bin/env node
// stripNonCode, against enumerated lines
// (CC-CMD-2026-09-13-route-scan-brace-balance-defeated).
//
// bodyOf finds a handler's end by counting braces. It counted every { and } in
// the raw line, so prose and string contents were read as syntax. Seven lines
// inside /archive/ alone did it, leaving a residual depth of 1 — the block never
// balanced, the scan ran to the window edge, and the route's declared sources
// became "whatever fell inside 1500 lines".
//
// Every case below is a real line from src/index.js or the minimal shape of one.
// The assertion is the NET brace count after stripping, because that is the only
// thing bodyOf uses.
//
// Coverage (Rule 91): one function, 14 lines + 2 multi-line block-comment
// sequences. Regex literals are NOT covered and NOT handled — see the note in
// route-scan.mjs for why that degrades safely to a flagged partial read.

import { stripNonCode } from './lib/route-scan.mjs';

const net = (code) => [...code].reduce((d, c) => c === '{' ? d + 1 : c === '}' ? d - 1 : d, 0);
let failed = 0, ran = 0;
const check = (label, cond, detail) => { ran++; if (cond) console.log(`  ok    ${label}`); else { failed++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); } };

// [ label, line, expected net brace count ]
const CASES = [
  ['plain opening brace',                    'if (x) {',                                   1],
  ['plain closing brace',                    '}',                                         -1],
  ['balanced object literal',                'const a = { b: 1 };',                        0],

  // The real offenders, verbatim from src/index.js.
  ['REAL 11978 — comment opening a shape',   '//   { ok, date, games_found, odds_skipped,', 0],
  ['REAL 11979 — comment closing it',        '//     quota_remaining, stopped?, reason? }', 0],
  ["REAL 12879 — '{' in a string, real brace after",
                                              "if (kvVal && kvVal[0] === '{') {",           1],
  ['REAL 12954 — comment with a brace set',  '// does not cover are americanfootball_{cfl,ncaaf,nfl,', 0],
  ['REAL 13285 — comment with two opens',    '// as fire-and-forget. Body: { triggered_by, teams: [{name,', 0],

  // Quote forms.
  ['double-quoted brace',                    'const s = "{";',                              0],
  ['backtick template with a brace',         'const s = `}`;',                              0],
  // Discriminating by measurement, not by inspection: two earlier candidates
  // netted the same with and without the escape skip, because dropping it
  // exposes one brace and swallows another. This one nets 0 correctly and 1
  // when the skip is removed — mutation B5 rides on that difference.
  ['escaped quote does not end the string', "if (k === '\\'{') { doThing(); }",         0],
  ['brace after a string closes',            "const s = 'x'; if (y) {",                     1],

  // Trailing comment after real code.
  ['code then a comment with braces',        'if (x) { // returns { a, b }',                1],
  ['block comment inline',                   'if (x) /* { { { */ {',                        1],
];

for (const [label, line, want] of CASES) {
  const { code } = stripNonCode(line, false);
  const got = net(code);
  check(`${label.padEnd(44)} net ${got}`, got === want, `wanted ${want}, code=${JSON.stringify(code)}`);
}

// Multi-line block comments: the state must carry, or the closing line's braces
// leak back in.
{
  const lines = ['/* opening {', ' still inside { {', ' done */ if (x) {'];
  let blk = false, total = 0;
  for (const l of lines) { const r = stripNonCode(l, blk); blk = r.inBlockComment; total += net(r.code); }
  check('a block comment spanning 3 lines contributes only the real brace', total === 1, `got ${total}`);
}
{
  const lines = ['/* a {', ' b }', ' c */'];
  let blk = false, total = 0;
  for (const l of lines) { const r = stripNonCode(l, blk); blk = r.inBlockComment; total += net(r.code); }
  check('a block comment with balanced prose braces contributes zero', total === 0, `got ${total}`);
}

// The end-to-end claim: /archive/ parses whole, at the UNCHANGED window.
{
  const { routes, bodyOf } = await import('./lib/route-scan.mjs');
  const rs = typeof routes === 'function' ? routes() : routes;
  const list = Array.isArray(rs) ? rs : Object.values(rs);
  const arch = list.find(r => r.path === '/archive/');
  check('/archive/ is found in the route table', !!arch);
  if (arch) {
    const b = bodyOf(arch.line);
    check('/archive/ parses whole — no truncation at WINDOW 1500', !b.truncated,
          'still truncated; the counter fix did not take');
    check('/archive/ body does not reach the /cfl/ routes',
          !/pathname\.startsWith\('\/cfl\//.test(b.text),
          'the parsed block still swallows /cfl/, so its hosts are not its own');
  }
}

console.log(`\nchecked ${ran} case(s) against stripNonCode and the live /archive/ parse. `
          + `Regex literals are NOT covered: telling a regex from a division needs a parser, and an `
          + `unbalanced one degrades to a flagged partial read rather than a silent wrong answer.`);
if (failed) { console.error(`FAIL — ${failed} case(s).`); process.exit(1); }
console.log('PASS');
