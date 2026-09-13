// Every table in identity-resolver.js that folds a `pairs` array into an
// object, and whether any key is written twice with a DIFFERENT value.
//
// WHY A CENSUS AND NOT A LIST. `Tigers` meant Detroit and Hull City; the table
// could hold one, so the answer was whichever line sat lower in the file, and
// every Detroit game silently stopped matching its odds for three weeks. The
// guard that should have caught it — check-team-identity-collisions.mjs —
// asserted over a CURATED list that `Tigers` was not on. A hand-written sample
// cannot find the collision it was not told to look for.
//
// This reads every pair in every table instead. Measured 2026-09-13: 333 pairs,
// 5 tables, exactly 1 collision.
//
// ONE key may collide: `tigers`, and only because the team table now RECORDS
// that rather than picking a winner (AMBIGUOUS_TEAM). The other four tables
// still fold last-write-wins, so for them a collision is a defect with no
// mechanism behind it — which is exactly what this exists to catch before it
// ships, rather than three weeks after.
import { readFileSync } from 'node:fs';
const src = readFileSync('src/identity-resolver.js', 'utf8');
const lines = src.split('\n');
const starts = [];
lines.forEach((l, i) => { if (/^\s*const pairs = \[/.test(l)) starts.push(i); });

const fold = {
  36:  { name: 'CANONICAL_TEAM (teams)',        key: s => strip(s),        val: (v,c)=>strip(c) },
  490: { name: 'CANONICAL_PLAYER (MLB)',        key: s => stripPlayer(s),  val: (v,c)=>stripPlayer(c) },
  732: { name: 'SOCCER players',                key: s => stripSoccer(s),  val: (v,c)=>c },
  774: { name: 'AFL teams',                     key: s => stripAFL(s),     val: (v,c)=>stripAFL(c) },
  810: { name: 'MLS club ids',                  key: s => strip(s),        val: (v,c)=>c },
};
const strip = s => String(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'')
  .toLowerCase().replace(/[^a-z0-9]/g,'');
const stripPlayer = s => strip(String(s||'').split(/\s+/).pop());
const stripSoccer = s => String(s||'').split(/\s+/).pop().toLowerCase();
const stripAFL = s => strip(s);

// Recorded ambiguity is allowed; silent overwrite is not. Anything else that
// collides is a new defect.
const ALLOWED = new Set(['tigers']);
let total = 0, collisions = 0, unexpected = 0;
for (const start of starts) {
  let depth = 0, end = start;
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i].match(/\[/g)||[]).length - (lines[i].match(/\]/g)||[]).length;
    if (depth <= 0 && i > start) { end = i; break; }
  }
  const block = lines.slice(start, end + 1).join('\n');
  const rows = [...block.matchAll(/\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)]
    .map(m => [m[1].replace(/\\'/g,"'"), m[2].replace(/\\'/g,"'")]);
  const meta = fold[start + 1] || { name: `pairs at line ${start+1}`, key: strip, val: (v,c)=>strip(c) };
  const seen = new Map();
  let bad = [];
  for (const [v, c] of rows) {
    const k = meta.key(v), val = meta.val(v, c);
    if (seen.has(k) && seen.get(k) !== val) bad.push([k, seen.get(k), val]);
    else seen.set(k, val);
  }
  total += rows.length;
  collisions += bad.length;
  unexpected += bad.filter(([k]) => !ALLOWED.has(k)).length;
  console.log(`${meta.name.padEnd(28)} ${String(rows.length).padStart(4)} pairs, ${seen.size} keys, ${bad.length} collision(s)`);
  for (const [k, a, b] of bad) {
    const tag = ALLOWED.has(k) ? 'recorded as ambiguous' : 'SILENT OVERWRITE — last write wins';
    console.log(`    ${ALLOWED.has(k) ? 'ok  ' : 'FAIL'} "${k}": ${a}  vs  ${b}   (${tag})`);
  }
}
console.log(`\n${unexpected ? 'FAILED' : 'PASS'}: ${total} pairs across ${starts.length} tables;`
          + ` ${collisions} colliding key(s), ${collisions - unexpected} recorded, ${unexpected} silent`);
process.exit(unexpected ? 1 : 0);
