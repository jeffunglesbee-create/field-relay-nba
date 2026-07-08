// Regression test for src/wp-resolver.js's sport-label classification surface:
// normalizeSportCode(), isWpUnsupportedSport(), and (as a plain reimplementation
// mirroring the exact decision logic in user-do.js's pick_resolved handler) the
// 3-way failure-classification used for wp-resolution-failures vs
// wp-sport-label-drift codex routing.
//
// No network calls -- pure function checks against the actual committed source.
// Run: node test-wp-resolver-sport-map.js

import { normalizeSportCode, isWpUnsupportedSport } from './src/wp-resolver.js';
import fs from 'fs';

let pass = 0, fail = 0;
function assertEq(actual, expected, label) {
    if (actual === expected) { pass++; }
    else { fail++; console.log(`FAIL: ${label} -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

// Enumerate the actual SPORT_LABEL_MAP at test-run time (not hand-copied) by
// reading the source and extracting every key, so this test tracks future
// edits to the map instead of silently going stale.
const src = fs.readFileSync('./src/wp-resolver.js', 'utf8');
const mapStart = src.indexOf('const SPORT_LABEL_MAP = {');
const mapEnd = src.indexOf('\n};', mapStart);
const mapBody = src.slice(mapStart, mapEnd);
const nullKeys = [...mapBody.matchAll(/'([^']+)':\s*null,/g)].map(m => m[1]);
const nonNullKeys = [...mapBody.matchAll(/'([^']+)':\s*'([^']+)',/g)].map(m => m[1]);

console.log(`Enumerated ${nullKeys.length} null-mapped (unsupported) keys, ${nonNullKeys.length} supported keys from committed source.\n`);

// ── isWpUnsupportedSport ─────────────────────────────────────────────────────

// True for every literal null-mapped key currently in SPORT_LABEL_MAP
for (const key of nullKeys) {
    assertEq(isWpUnsupportedSport(key), true, `isWpUnsupportedSport("${key}")`);
    assertEq(isWpUnsupportedSport(key.toUpperCase()), true, `isWpUnsupportedSport("${key.toUpperCase()}") (case-insensitive)`);
}
// Doc-specified explicit case list (CC-CMD-2026-07-08-wp-failure-noise-suppression.md)
for (const s of ['golf', 'Golf', 'tennis', 'rugby', 'wwe/pro wrestling', 'ncaa basketball', 'formula 1', 'f1', 'racing', 'unknown']) {
    assertEq(isWpUnsupportedSport(s), true, `isWpUnsupportedSport("${s}")`);
}
// False for a sample of real supported labels, and cross-checked against every non-null key
for (const label of ['baseball (mlb)', 'mlb', 'nba', 'wnba', 'premier league', 'cfl', 'afl']) {
    assertEq(isWpUnsupportedSport(label), false, `isWpUnsupportedSport("${label}")`);
}
for (const key of nonNullKeys) {
    assertEq(isWpUnsupportedSport(key), false, `isWpUnsupportedSport("${key}") (supported key)`);
}
// False for a genuinely unrecognized string -- confirms the fallthrough case isn't suppressed
assertEq(isWpUnsupportedSport('some new sport nobody has seen'), false, "isWpUnsupportedSport('some new sport nobody has seen')");
// False for null/undefined/'' input (defensive)
assertEq(isWpUnsupportedSport(null), false, 'isWpUnsupportedSport(null)');
assertEq(isWpUnsupportedSport(undefined), false, 'isWpUnsupportedSport(undefined)');
assertEq(isWpUnsupportedSport(''), false, "isWpUnsupportedSport('')");

// ── normalizeSportCode ───────────────────────────────────────────────────────

// Every null-mapped key normalizes to null
for (const key of nullKeys) {
    assertEq(normalizeSportCode(key), null, `normalizeSportCode("${key}") === null`);
}
// Every supported key normalizes to a non-null code
for (const key of nonNullKeys) {
    const code = normalizeSportCode(key);
    if (!code) { fail++; console.log(`FAIL: normalizeSportCode("${key}") returned falsy: ${code}`); } else { pass++; }
}
// Two bugs fixed 2026-07-08 -- regression guards, exact real client labels
assertEq(normalizeSportCode('MLS Soccer'), 'mls', "normalizeSportCode('MLS Soccer') === 'mls' (not 'soccer')");
assertEq(normalizeSportCode('NCAA Football'), 'cfb', "normalizeSportCode('NCAA Football') === 'cfb' (not null)");

// ── 3-way classification (mirrors user-do.js pick_resolved else-branch exactly) ──
// unsupported-no-track  : isWpUnsupportedSport(sport) === true
// unrecognized-drift    : isWpUnsupportedSport === false AND normalizeSportCode === null
// recognized-failure    : isWpUnsupportedSport === false AND normalizeSportCode !== null
function classify(sport) {
    if (isWpUnsupportedSport(sport)) return 'unsupported-no-track';
    if (!normalizeSportCode(sport)) return 'unrecognized-drift';
    return 'recognized-failure';
}

for (const key of nullKeys) {
    assertEq(classify(key), 'unsupported-no-track', `classify("${key}")`);
}
for (const key of nonNullKeys) {
    assertEq(classify(key), 'recognized-failure', `classify("${key}")`);
}
assertEq(classify('some new sport nobody has seen'), 'unrecognized-drift', "classify('some new sport nobody has seen')");
assertEq(classify('ICC Cricket World Cup'), 'recognized-failure', "classify('ICC Cricket World Cup') (fallback keyword match on 'cricket' -> ipl, not drift)");
// A label caught only via normalizeSportCode's fallback substring matching (not an
// exact SPORT_LABEL_MAP key) must still classify as recognized-failure, not drift --
// confirms the drift bucket is reserved for genuinely unmatched labels only.
assertEq(classify('NBA In-Season Tournament'), 'recognized-failure', "classify('NBA In-Season Tournament') (fallback match on 'nba')");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
