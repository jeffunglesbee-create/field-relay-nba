#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-imports-resolve.mjs (docs/CC-CMD-2026-10-29-imports-check-comment-stripper.md).
 *
 * Each mutation changes ONE thing in a copy of the check, placed beside it so its relative import still resolves, and
 * aims scripts/check-imports-resolve-selftest.mjs at the copy through CHECK_SCRIPT. The self-test must go red for every
 * one. A mutant counts as CAUGHT only when an assertion failed ("N of M passed." with N < M and a FAIL line): a crash or
 * a syntax error proves nothing about what the self-test asserts and is reported as a harness error.
 *
 * THE HARNESS'S OWN ANCHORS ARE ASSERTED. A mutation whose anchor is missing or not unique applies NOTHING, and a
 * self-test that is green on unmutated source would print a pass for it. Each fails the harness by name when its
 * anchor does not occur exactly once.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const CHECK = 'scripts/check-imports-resolve.mjs';
const original = readFileSync(CHECK, 'utf8');
const born = [];
const place = (text, tag) => {
  const p = join(dirname(CHECK), `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.mjs`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) rmSync(p, { force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// 'pass' | 'red' (an assertion failed) | 'error' (anything else).
const run = (checkScript) => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-imports-resolve-selftest.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CHECK_SCRIPT: checkScript } });
  } catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run(resolve(CHECK)) !== 'pass') { console.log('FAIL: the self-test is already red on the real check.'); process.exit(1); }
if (run(place(original, 'control')) !== 'pass') {
  console.log('FAIL: an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the self-test passes on the real check and on an unmutated copy at the mutant location\n');

const OLD_CHAIN = "const code = src\n    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ')\n    .replace(/^\\s*\\/\\/.*$/gm, ' ')\n    .replace(/(['\"`])(?:\\\\.|(?!\\1)[^\\\\])*\\1/g, '\"\"');";
const STRIP = 'const code = blankCommentsAndStrings(src);';
const DYN = "for (const m of code.matchAll(/\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*(?:await\\s+)?import\\s*\\(/g)) {";
const BOUND = "const bound = part.split(':').pop().split('=')[0].trim().replace(/^\\.\\.\\./, '');";
const STATIC = 'for (const m of code.matchAll(/import\\s*\\{([^}]*)\\}\\s*from/g)) {';
const CALLED = 'const called = new RegExp(`\\\\b${name}\\\\s*\\\\(`).test(code);';

const MUTANTS = [
  ['M1 the old three-replace chain is restored (a slash-star in a comment or string eats code)', STRIP, OLD_CHAIN],
  ['M2 nothing is stripped (prose and strings read as code)', STRIP, 'const code = src;'],
  ['M3 dynamic-import destructuring is not recognised', DYN, 'for (const m of []) {'],
  ['M4 a renamed dynamic import records the property, not the bound name', BOUND, "const bound = part.split(':')[0].split('=')[0].trim();"],
  ['M5 static imports are not recognised', STATIC, 'for (const m of []) {'],
  ['M6 the word boundary is dropped from the call match', CALLED, 'const called = new RegExp(`${name}\\\\s*\\\\(`).test(code);'],
  // (No mutant for the `owner === f` skip: it is redundant. A module's own export is always in its localDefs, because
  // the export regexes and the localDefs regexes match the same declarations, so removing the skip changes no
  // behaviour. A mutant no check can tell from the original is not a test of anything.)
  ['M7 a local definition no longer resolves a name', 'if (imported.has(name) || localDefs.has(name)) continue;', 'if (imported.has(name)) continue;'],
  ['M8 the failure no longer names the call', 'calls ${name}() — exported by', 'calls ${name} — exported by'],
  ['M9 the exit code is always 0', 'process.exit(failures.length ? 1 : 0);', 'process.exit(0);'],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, anchor, repl] of MUTANTS) {
  const count = original.split(anchor).length - 1;
  if (count !== 1) {
    nothing++;
    console.log(`NOTHING MUTATED  ${name}\n        the anchor occurs ${count} times in ${CHECK}, not once`);
    continue;
  }
  const text = original.replace(anchor, () => repl);
  if (text === original) { nothing++; console.log(`NOTHING MUTATED  ${name}`); continue; }
  const verdict = run(place(text, name.slice(0, 3).trim()));
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: the check\'s stripping, its two ways of recognising an import, the local-definition skip, the');
console.log('call match, the failure text and the exit code. NOT mutated: scripts/lib/blank-comments.mjs (its own cases are in the');
console.log('self-test only through the behaviours above).');
process.exit(missed || nothing || errored ? 1 : 0);
