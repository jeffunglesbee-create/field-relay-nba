// Permanent duplicate/overlapping route-prefix detector for field-relay-nba.
// CC-CMD-2026-07-13-duplicate-prefix-detector: two real route-shadowing bugs
// (/mlb-stats/{file}, /odds/history/) were found tonight by accident, both
// as side effects of unrelated work. This makes the check permanent instead
// of relying on it being stumbled into again.
//
// Regex-based (not AST) — matches this file's own consistent convention:
// every real route-dispatch condition starts with `if (pathname...)` as the
// first token on its line. Comment-only mentions never start a line with
// `if`, so they're structurally excluded rather than filtered by content.
//
// Warns, does not hard-fail. Some overlaps are legitimate (e.g. mutually
// exclusive env.X / !env.X branches, or GET vs POST on the same path).

import fs from 'node:fs';

const SRC_PATH = process.argv[2] || 'src/index.js';
const src = fs.readFileSync(SRC_PATH, 'utf8');
const rawLines = src.split('\n');

// ── Pass 1: strip full-line `//` comments, track brace depth at the START
//    of each line (rough but adequate for this file's style — string/
//    template contents are stripped before counting braces or looking for
//    `//`, to avoid false matches inside JSON.stringify literals, MIME-type
//    strings like 'text/plain, */*', or route-glob comments like
//    "/mlb-stats/*". NOTE: this file has zero genuine multi-line /* */
//    block comments (confirmed by direct inspection) — only same-line
//    /* ... */ spans, which never contain a real `if (pathname...)`
//    condition, so no block-comment state tracking is needed or attempted.
const cleanLines = [];
const depthAtStart = [];
let depth = 0;

for (let i = 0; i < rawLines.length; i++) {
  const line = rawLines[i];

  // Strip string/template literal contents FIRST — a comment marker or
  // brace inside a string (e.g. '*/*',  a URL, a JSON literal) must never
  // be treated as real code structure.
  const codeOnly = line
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  const commentIdx = codeOnly.indexOf('//');
  const withoutLineComment = commentIdx === -1 ? line : line.slice(0, commentIdx);

  depthAtStart.push(depth);
  cleanLines.push(withoutLineComment);

  const braceScan = commentIdx === -1 ? codeOnly : codeOnly.slice(0, commentIdx);
  for (const ch of braceScan) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
}

// ── Extract every real `if (pathname...)` route check. Two real shapes
//    exist in this file: block form (`if (...) {`) and single-line
//    no-brace form (`if (...) return ...;`). A multi-line no-brace form
//    (condition on one line, `return` on the next) is a known, documented
//    gap — rare (1 occurrence as of this writing) and not a realistic
//    shadowing risk (always a narrow exact-match sub-check). ─────────────
const checks = [];
for (let i = 0; i < cleanLines.length; i++) {
  // `} else if (pathname...)` chains (e.g. the /cfl/* sub-route cascade) are
  // a real, distinct shape — strip a leading "} else " before anchoring.
  const trimmed = cleanLines[i].trim().replace(/^\}\s*else\s+/, '');
  if (!trimmed.startsWith('if')) continue;

  const swBlock  = trimmed.match(/^if\s*\(\s*pathname\.startsWith\(\s*'([^']*)'\s*\)([^{]*)\)\s*\{/);
  const eqBlock  = trimmed.match(/^if\s*\(\s*pathname\s*===\s*'([^']*)'([^{]*)\)\s*\{/);
  const swReturn = trimmed.match(/^if\s*\(\s*pathname\.startsWith\(\s*'([^']*)'\s*\)([^{;]*)\)\s*return\b/);
  const eqReturn = trimmed.match(/^if\s*\(\s*pathname\s*===\s*'([^']*)'([^{;]*)\)\s*return\b/);
  const m = swBlock || eqBlock || swReturn || eqReturn;
  if (!m) continue;

  const isBlock = !!(swBlock || eqBlock);
  checks.push({
    line: i + 1,
    prefix: m[1],
    kind: (swBlock || swReturn) ? 'startsWith' : 'exact',
    guard: (m[2] || '').trim(),
    raw: trimmed,
    depth: depthAtStart[i],
    opensBlock: isBlock,
  });
}

// ── For each check that opens a block, find the line it closes on (depth
//    returns to the check's own starting depth) — used to detect
//    legitimate nesting (a sub-check handled INSIDE a broader parent block
//    is not shadowing). Single-line no-brace checks never open a scope, so
//    nothing can be nested inside one — blockEnd is just their own line. ──
for (const c of checks) {
  if (!c.opensBlock) { c.blockEnd = c.line; continue; }
  let end = rawLines.length;
  for (let i = c.line; i < depthAtStart.length; i++) {
    if (depthAtStart[i] <= c.depth) { end = i; break; }
  }
  c.blockEnd = end;
}
function nestedInside(b, a) {
  return b.line > a.line && b.line <= a.blockEnd;
}

// ── Does check A's match-set fully cover check B's match-set? ──────────────
function covers(a, b) {
  if (a.kind === 'startsWith') return b.prefix.startsWith(a.prefix);
  // a.kind === 'exact' can only cover an identical exact check
  return b.kind === 'exact' && b.prefix === a.prefix;
}

// ── Are two guards provably mutually exclusive? ─────────────────────────────
function envFlags(guard) {
  const out = [];
  const re = /(!)?env\.(\w+)/g;
  let m;
  while ((m = re.exec(guard))) out.push({ negated: !!m[1], name: m[2] });
  return out;
}
function methodChecks(guard) {
  const out = [];
  const re = /request\.method\s*===\s*'(\w+)'/g;
  let m;
  while ((m = re.exec(guard))) out.push(m[1]);
  return out;
}
function mutuallyExclusive(guardA, guardB) {
  const flagsA = envFlags(guardA), flagsB = envFlags(guardB);
  for (const fa of flagsA) for (const fb of flagsB) {
    if (fa.name === fb.name && fa.negated !== fb.negated) return true;
  }
  const methodsA = methodChecks(guardA), methodsB = methodChecks(guardB);
  if (methodsA.length && methodsB.length) {
    const disjoint = methodsA.every(ma => !methodsB.includes(ma));
    if (disjoint) return true;
  }
  return false;
}

// ── Flag genuine shadowing: earlier check covers a later check's match-set,
//    unless their guards are provably mutually exclusive ─────────────────
const findings = [];
for (let i = 0; i < checks.length; i++) {
  for (let j = i + 1; j < checks.length; j++) {
    const a = checks[i], b = checks[j];
    if (nestedInside(b, a)) continue; // b is a's own internal sub-routing, not a sibling
    if (!covers(a, b)) continue;
    if (mutuallyExclusive(a.guard, b.guard)) continue;
    findings.push({ earlier: a, later: b });
  }
}

// ── Report ───────────────────────────────────────────────────────────────
if (findings.length === 0) {
  console.log(`✅ check-route-shadowing: 0 suspicious route-prefix groups found (${checks.length} route checks scanned in ${SRC_PATH})`);
  process.exit(0);
}

console.log(`⚠ check-route-shadowing: ${findings.length} suspicious route-prefix pair(s) found (${checks.length} route checks scanned in ${SRC_PATH})`);
console.log('This is a WARNING, not a hard failure — some overlaps may be intentional. Human review requested.\n');
for (const { earlier, later } of findings) {
  const msg = `L${earlier.line} "${earlier.raw}" may shadow L${later.line} "${later.raw}"`;
  console.log(`::warning file=${SRC_PATH},line=${later.line}::${msg}`);
  console.log(`  earlier (L${earlier.line}): ${earlier.raw}`);
  console.log(`  later   (L${later.line}): ${later.raw}`);
  console.log('');
}
// Warn-not-block: exit 0 even when findings exist.
process.exit(0);
