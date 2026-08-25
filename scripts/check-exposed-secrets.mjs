#!/usr/bin/env node
// No known-exposed credential may appear more often than its declared count.
//
// WHY A RATCHET AND NOT A BAN
//
// Two credentials have been hard-coded in this repo. One is now removed and its
// count is 0 — it may never come back. The other is load-bearing: the shared
// secret appears 28 times, including the auth comparison that gates
// POST /d1/execute, and removing the literals before ROTATING the value buys
// nothing (it is in git history either way) while risking an auth check that
// compares a header against `undefined`.
//
// A check that demanded 0 for both would be red on main from the moment it
// shipped, and a red check nobody can make green is a check that gets deleted.
// So each secret declares a maximum. Growing past it fails; shrinking is a fix
// and the number comes down in the same commit.
//
// The VALUES are never in this file or in docs/exposed-secrets.sha256 — only
// SHA-256 hashes. This script hashes every whitespace-delimited token and every
// quoted string it finds and looks the digests up, so it never needs to know
// what it is looking for.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const MANIFEST = 'docs/exposed-secrets.sha256';
const SELF_TEST = process.argv.includes('--self-test');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'build']);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      → ${detail}`); failed++; }
};

const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');

/** `<sha>  <max>  <name>` lines; `#` and blanks ignored. */
export function parseManifest(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([0-9a-f]{64})\s+(\d+)\s+(.+)$/);
    if (m) out.push({ sha: m[1], max: Number(m[2]), name: m[3].trim() });
  }
  return out;
}

/**
 * Every candidate literal in a file, hashed.
 *
 * Quoted strings AND bare tokens: a secret can appear as `'abc'` in JS, as
 * `abc` in a YAML scalar, or inside a `${{ ... || 'abc' }}` expression. Hashing
 * both forms costs nothing and means the scanner does not depend on which
 * syntax the next one shows up in.
 */
export function digestsIn(text) {
  const found = new Map();
  const add = v => { if (v && v.length >= 8 && v.length <= 200) found.set(sha(v), v.length); };
  for (const m of text.matchAll(/'([^'\n]{8,200})'|"([^"\n]{8,200})"|`([^`\n]{8,200})`/g)) {
    add(m[1] ?? m[2] ?? m[3]);
  }
  // Quote characters are DELIMITERS, not decoration to be trimmed.
  //
  // The first version split on whitespace and punctuation, then stripped ONE
  // leading and ONE trailing quote. It missed this, measured 2026-08-25 in
  // jubilant-bassoon docs/journalism-root-cause-2026-05-29.md:24:
  //
  //     `relayAuth === RELAY_SHARED_SECRET || 'field-relay-cron-2026'`
  //
  // Two failures at once. The quote-pair pass above matched the OUTER backtick
  // span first and consumed the inner literal, so the single-quoted secret
  // never got its own match. The token pass then produced
  // `'field-relay-cron-2026'\`` and the single strip left a trailing
  // apostrophe, so the hash missed. The file scanned clean while carrying the
  // secret — and a secret inside a code span is exactly how one appears in
  // prose.
  //
  // Splitting ON quotes fixes both: no credential contains a quote character,
  // so nothing is lost, and nesting stops mattering. The quote-pair pass stays
  // for values that contain spaces, which the token split would break apart.
  for (const tok of text.split(/[\s,;()[\]{}<>'"`]+/)) add(tok);
  return found;
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* files(p);
    else if (st.size < 8_000_000) yield p;
  }
}

if (SELF_TEST) {
  const parsed = parseManifest(readFileSync(MANIFEST, 'utf8'));
  check('the manifest parses at least one entry', parsed.length > 0, `${parsed.length} entries`);
  check('every entry declares a numeric maximum',
    parsed.every(e => Number.isInteger(e.max) && e.max >= 0),
    JSON.stringify(parsed.map(e => e.max)));
  check('a comment line is not read as an entry',
    parseManifest('# ' + 'a'.repeat(64) + '  0  commented out').length === 0,
    'a commented entry was parsed');

  // The scanner must find a secret in each syntax it has actually appeared in.
  const probe = 'super-secret-value-1234';
  const h = sha(probe);
  for (const [label, text] of [
    ['a single-quoted JS literal', `const K = '${probe}';`],
    ['a double-quoted literal', `echo "${probe}" | wrangler secret put X`],
    ['a YAML expression fallback', `KEY: \${{ secrets.X || '${probe}' }}`],
    ['a bare token in prose', `the key is ${probe} and it leaked`],
  ]) {
    check(`the scanner finds ${label}`, digestsIn(text).has(h), 'not found');
  }
  check('the scanner does not report a value that is absent',
    !digestsIn('const K = process.env.X;').has(h), 'a false positive');

  // The nested-quote form, and the one that actually got past this scanner.
  // A secret inside a code span: an outer backtick pair around an inner
  // single-quoted literal. Both of this function's passes failed on it.
  check('a secret nested inside an outer quote span is found',
    digestsIn("copy (`relayAuth === RELAY_SHARED_SECRET || '" + probe + "'` skipped)").has(h),
    'the nested form is still invisible');

  // The defect that made this scanner miss a real hit, 2026-08-25.
  //
  // An unbalanced quote on an earlier line shifts where the quote-pair regex
  // resumes, so a later backtick-quoted secret can be swallowed when the whole
  // file is scanned in one pass. Asserted as the DIFFERENCE between the two
  // strategies: whole-file must be allowed to miss it; line-by-line must not.
  const awkward = [
    "After 1042 cleared, the proxy rejected it: `ALLOWED_ORIGINS.includes('')` fails.",
    "It's the wrong copy — that's two apostrophes and no closing quote",
    `const isRelay = relayAuth === (env.X || '${probe}');`,
  ].join('\n');
  const byLine = awkward.split('\n').some(l => digestsIn(l).has(h));
  check('line-by-line finds a hit that a whole-file scan can miss',
    byLine, 'the line-bounded scan missed it too — the fix does not work');
  check('...and the whole-file scan is the one that was unreliable',
    true, `whole-file found it: ${digestsIn(awkward).has(h)} (either value is a pass; ` +
    'this line records which strategy was measured, it does not assert the bug still exists)');
  process.exit(failed === 0 ? 0 : 1);
}

// Everything below runs only when this file is EXECUTED, never when it is
// imported. `digestsIn` and `parseManifest` are exported for testing, and an
// import that silently ran a whole-tree scan is the defect field-laboratory's
// `check:import-purity` gate exists for -- hit for real on 2026-08-25 when a
// one-line diagnostic import printed a full report instead.
if (process.argv[1] && process.argv[1].endsWith('check-exposed-secrets.mjs')) {
const entries = parseManifest(readFileSync(MANIFEST, 'utf8'));
if (!entries.length) { console.error(`FAIL: ${MANIFEST} declares nothing`); process.exit(1); }

const counts = new Map(entries.map(e => [e.sha, 0]));
const where = new Map(entries.map(e => [e.sha, []]));
for (const f of files('.')) {
  if (f.endsWith(MANIFEST) || f.endsWith('check-exposed-secrets.mjs')) continue;
  let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
  // LINE BY LINE, never whole-file, and this is not a style choice.
  //
  // The first version pre-checked `digestsIn(text)` over the whole file and
  // only counted lines when that passed. Quote pairing is not anchored: the
  // alternation `'...'|"..."|`...`` consumes as it scans, so an unbalanced
  // quote on an EARLIER line shifts where later matches begin and a real hit
  // can be swallowed. Measured 2026-08-25 on
  // docs/journalism-root-cause-2026-05-29.md:24 — that line carries the shared
  // secret inside backticks and `digestsIn(line)` finds it, while
  // `digestsIn(wholeFile)` did not. The file scanned as clean.
  //
  // A guard that can silently fail to guard is worse than no guard. Bounding
  // every regex to one line makes consumption unable to cross a line boundary.
  const lines = text.split(/\r?\n/);
  const perLine = lines.map(l => digestsIn(l));
  for (const e of entries) {
    const n = perLine.filter(d => d.has(e.sha)).length;
    if (!n) continue;
    // Occurrences, not files: a second hard-coded use in an already-listed file
    // must fail too.
    counts.set(e.sha, counts.get(e.sha) + n);
    where.get(e.sha).push(`${f} (${n})`);
  }
}

for (const e of entries) {
  const n = counts.get(e.sha);
  check(`${e.name}: at most ${e.max} occurrence(s)`, n <= e.max,
    `${n} found — ${where.get(e.sha).join(', ')}. This is a RATCHET: a new hard-coded ` +
    `use is the failure. If you REMOVED some, lower the number in ${MANIFEST} in this commit.`);
  if (n < e.max) {
    console.log(`      note: ${n} of a declared ${e.max} — lower the number in ${MANIFEST}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
}
