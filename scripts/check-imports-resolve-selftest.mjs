#!/usr/bin/env node
/**
 * Self-test for scripts/check-imports-resolve.mjs (docs/CC-CMD-2026-10-29-imports-check-comment-stripper.md).
 *
 * The check is run on small fixture trees through SRC_DIR. Each case asserts the exit code AND, for a failure, that the
 * output names the call, so a crash cannot pass for a catch. The script under test is CHECK_SCRIPT (default the real
 * one) so scripts/mutate-imports-resolve.mjs can aim this file at a mutated copy.
 *
 * WHY THESE CASES. Until 2026-10-29 the check blanked comments with three sequential regex replaces, the first of which
 * paired a slash-star inside a `//` comment or a string with the next close anywhere later: 119,320 characters of real
 * code in four src/ modules were never read. Cases 3, 4, 5 and 10 are that defect from both sides (a missing import
 * hidden; a present import swallowed).
 *
 * KNOWN GAPS, stated here and NOT tested as passes:
 *  - template text outside ${...} is kept by scripts/lib/blank-comments.mjs, so `foo(` in template prose reads as a
 *    call (a false failure, never a hidden call);
 *  - an import is file-level: a name bound in one function counts for the whole module;
 *  - a static `import { a as b }` records `a`, the imported name, not the bound `b`;
 *  - whether a `/` opens a regex or divides is that module's heuristic (it was compared with acorn's tokenizer).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK = resolve(process.env.CHECK_SCRIPT || 'scripts/check-imports-resolve.mjs');
const A = 'export function foo() { return 1; }\n';

// [name, files in src/, expected exit code, text the output must contain]
const CASES = [
  ['1 a plain missing import fails', { 'a.js': A, 'b.js': 'export function run() { return foo(); }\n' }, 1, 'b.js: calls foo()'],
  ['2 the import present passes', { 'a.js': A, 'b.js': "import { foo } from './a.js';\nexport function run() { return foo(); }\n" }, 0, '0 unresolved'],
  ['3 a slash-star in a // comment, a missing call, a real block comment below: FAILS', { 'a.js': A, 'b.js': '// the /admin/* routes check it\nexport function run() { return foo(); }\n/* a real block comment */\n' }, 1, 'b.js: calls foo()'],
  ['4 a slash-star in a string, a missing call, a real block comment below: FAILS', { 'a.js': A, 'b.js': "const r = '/admin/*';\nexport function run() { return foo(); }\n/* real */\n" }, 1, 'b.js: calls foo()'],
  ['5 the same comment with the import present passes (the false failure that stopped 1d55722)', { 'a.js': A, 'b.js': "// the /admin/* routes check it\nimport { foo } from './a.js';\n/* real */\nexport function run() { return foo(); }\n" }, 0, '0 unresolved'],
  ['6 the name in a // comment passes', { 'a.js': A, 'b.js': '// call foo() later\nexport const x = 1;\n' }, 0, '0 unresolved'],
  ['7 the name in a block comment passes', { 'a.js': A, 'b.js': '/* foo() is documented here */\nexport const x = 1;\n' }, 0, '0 unresolved'],
  ['8 the name in a string passes', { 'a.js': A, 'b.js': "export const x = 'call foo() later';\n" }, 0, '0 unresolved'],
  ['9 the name in a trailing // comment passes', { 'a.js': A, 'b.js': 'export const x = 1; // then foo() runs\n' }, 0, '0 unresolved'],
  ['10 a regex literal holding a quote must not hide the call after it', { 'a.js': A, 'b.js': 'export function run(s) {\n  const ok = /[\'"]/.test(s);\n  return foo();\n}\nconst t = "x";\n' }, 1, 'b.js: calls foo()'],
  ['11 a dynamic-import destructure binds the name', { 'a.js': A, 'b.js': "export async function run() { const { foo } = await import('./a.js'); return foo(); }\n" }, 0, '0 unresolved'],
  ['12 a renamed dynamic import binds the new name, not the old one', { 'a.js': A, 'b.js': "export async function run() { const { foo: bar } = await import('./a.js'); return foo() + bar(); }\n" }, 1, 'b.js: calls foo()'],
  ['13 a longer name ending in an exported one is not a call to it', { 'a.js': A, 'b.js': 'export function run() { return barfoo(); }\n' }, 0, '0 unresolved'],
  ['14 a module calling its own export passes', { 'a.js': A + 'export function again() { return foo(); }\n' }, 0, '0 unresolved'],
  ['15 a call inside ${...} of a template is code', { 'a.js': A, 'b.js': 'export const u = `x ${foo()}`;\n' }, 1, 'b.js: calls foo()'],
  ['16 a module that defines its own foo and calls it passes', { 'a.js': A, 'b.js': 'function foo() { return 2; }\nexport function run() { return foo(); }\n' }, 0, '0 unresolved'],
];

let bad = 0, ran = 0;
const root = mkdtempSync(join(tmpdir(), 'imports-selftest-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
for (const [name, files, wantCode, wantText] of CASES) {
  ran++;
  const dir = join(root, String(ran)); mkdirSync(join(dir, 'src'), { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, 'src', f), text);
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [CHECK], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SRC_DIR: 'src' } });
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status ?? 1; }
  const ok = code === wantCode && out.includes(wantText);
  if (!ok) bad++;
  console.log(`${ok ? 'ok    ' : 'FAIL  '}${name}${ok ? '' : `\n        exit ${code} (wanted ${wantCode}); output ${out.includes(wantText) ? 'has' : 'LACKS'} "${wantText}"\n        ${out.trim().split('\n').slice(-3).join('\n        ')}`}`);
}
console.log(`${ran - bad} of ${ran} passed.`);
process.exit(bad ? 1 : 0);
