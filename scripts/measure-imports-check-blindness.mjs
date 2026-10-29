#!/usr/bin/env node
/**
 * What the import check could not read before 2026-10-29
 * (docs/CC-CMD-2026-10-29-imports-check-comment-stripper.md, done condition 3).
 *
 * Reads src/ twice: through the three-replace chain scripts/check-imports-resolve.mjs used until that date (a labelled
 * copy below, kept only so the number can be reproduced) and through scripts/lib/blank-comments.mjs, the string- and
 * regex-aware stripper the check uses now. Prints, per module, the non-blank code characters the old FIRST pass
 * (slash-star to the next star-slash over raw text) swallowed, and the unresolved calls each reading finds.
 * Read-only. Exit 0 always: it is a measurement, not a gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { blankCommentsAndStrings } from './lib/blank-comments.mjs';

const SRC = process.env.SRC_DIR || 'src';
const OLD_CHAIN = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
const files = fs.readdirSync(SRC).filter((x) => x.endsWith('.js'));
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const exportsByName = new Map();
for (const f of files) {
  for (const m of read(f).matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) exportsByName.set(m[1], f);
  for (const m of read(f).matchAll(/^export\s+(?:const|let|class)\s+(\w+)/gm)) exportsByName.set(m[1], f);
}

// The check's own import and definition recognition, with or without the dynamic-import binding added on 2026-10-29.
function unresolved(strip, dynamicBinds) {
  const out = [];
  for (const f of files) {
    const code = strip(read(f));
    const imported = new Set();
    for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/)[0].trim(); if (n) imported.add(n); }
    }
    if (dynamicBinds) {
      for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?import\s*\(/g)) {
        for (const part of m[1].split(',')) { const n = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, ''); if (n) imported.add(n); }
      }
    }
    const local = new Set();
    for (const m of code.matchAll(/(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)) local.add(m[1]);
    for (const m of code.matchAll(/(?:^|\s)(?:export\s+)?(?:const|let|var|class)\s+(\w+)/g)) local.add(m[1]);
    for (const [name, owner] of exportsByName) {
      if (owner === f || imported.has(name) || local.has(name)) continue;
      if (new RegExp(`\\b${name}\\s*\\(`).test(code)) out.push(`${f}: ${name}() from ${owner}`);
    }
  }
  return out;
}

let swallowed = 0;
console.log(`modules read: ${files.length} in ${SRC}/`);
for (const f of files) {
  const raw = read(f), blanked = blankCommentsAndStrings(raw);
  let chars = 0, spans = 0, widest = 0;
  for (const m of raw.matchAll(/\/\*[\s\S]*?\*\//g)) {
    let n = 0;
    for (let i = m.index; i < m.index + m[0].length; i++) if (!/\s/.test(blanked[i])) n++;
    if (n > 0) { chars += n; spans++; widest = Math.max(widest, m[0].length); }
  }
  if (chars) { swallowed += chars; console.log(`  ${f}: the old first pass swallows ${chars} non-blank code characters in ${spans} span(s), widest ${widest} characters`); }
}
console.log(`code characters the old first pass swallowed, all modules: ${swallowed}`);
for (const [label, strip, dyn] of [
  ['old three-replace chain', OLD_CHAIN, false],
  ['shared stripper, import recognition unchanged', blankCommentsAndStrings, false],
  ['shared stripper + dynamic-import binding (the check now)', blankCommentsAndStrings, true],
]) {
  const u = unresolved(strip, dyn);
  console.log(`${label}: ${u.length} unresolved`);
  for (const x of u) console.log(`    ${x}`);
}
