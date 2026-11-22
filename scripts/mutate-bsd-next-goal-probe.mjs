#!/usr/bin/env node
// Rule 90 for scripts/check-bsd-next-goal-probe.mjs and scripts/check-bsd-next-goal-probe-run.mjs, in three halves
// (the shape of mutate-bsd-stats-poll.mjs).
//
// HALF 1 breaks a temp copy of the REAL scripts/bsd-next-goal-probe.mjs the ways a verdict about a
// vendor can be wrong, and the check must go red on each. HALF 3 breaks the I/O of that same probe (budget, stop on
// 429, the token header, the token-leak guard, when -latest advances) and the RUN check, which drives the whole probe
// against a stub vendor, must go red on each. HALF 2 breaks the check itself: two
// mutations that must leave it BLIND on a broken probe (so its red depends on that code), and two
// that tighten a gate and must turn it red on the real probe (so the gate binds).
//
// Anchor discipline: each anchor must occur exactly once in the file it mutates, and the replacement
// must differ from it. NOT APPLIED is a failure, never a pass: printing "not caught" with nothing
// mutated is worse than no test. The baseline runs first: a check that is already red would "catch"
// every mutation for the wrong reason. The real files are hashed before and after and must not move.
//
// Usage: node scripts/mutate-bsd-next-goal-probe.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SRC = 'scripts/bsd-next-goal-probe.mjs';
const CHECK = 'scripts/check-bsd-next-goal-probe.mjs';
const RUN_CHECK = 'scripts/check-bsd-next-goal-probe-run.mjs';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before = { [SRC]: sha(SRC), [CHECK]: sha(CHECK), [RUN_CHECK]: sha(RUN_CHECK) };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-ngp-'));

const runCheck = (checkFile, srcFile) =>
  spawnSync(process.execPath, [checkFile, '--source', srcFile], { encoding: 'utf8' }).status;

const SOURCE_MUTATIONS = [
  // the gate
  ['a 403 is no longer GATED', "s === 402 || s === 403 ? 'GATED'", "s === 402 ? 'GATED'"],
  ['a 403 reads as OPEN', "s === 200 ? 'OPEN'", "s === 200 || s === 403 ? 'OPEN'"],
  ['a 401 is no longer TOKEN_REFUSED', "s === 401 ? 'TOKEN_REFUSED'", "s === 4010 ? 'TOKEN_REFUSED'"],
  ['a 429 is no longer RATE_LIMITED', "s === 429 ? 'RATE_LIMITED'", "s === 4290 ? 'RATE_LIMITED'"],
  ['a blocked call loses its reason', "if (rec.blocked) return { verdict: 'UNKNOWN', why: rec.blocked };", "if (rec.blocked) return { verdict: 'UNKNOWN', why: 'x' };"],
  // the id space
  ['names are not compared (an id match is enough)', 'if (same) agree++; else', 'if (true) agree++; else'],
  ['no match reads as the same id space', "matched === 0 ? 'NOT_JOINED'", "matched === 0 ? 'SAME_ID_SPACE'"],
  ['a collision is reported as the same space', "disagree > 0 ? 'ID_COLLISION'", "disagree > 99 ? 'ID_COLLISION'"],
  ['team ids are never compared', 'String(l.home_team_id) === String(e.home_team_id)', 'true'],
  // coverage
  ['the minute-10 boundary is exclusive', '(num(r?.current_minute) ?? -1) >= 10;', '(num(r?.current_minute) ?? -1) > 10;'],
  ['without-read is inverted', '!readIds.has(String(r?.id))', 'readIds.has(String(r?.id))'],
  ['the coverage line drops its denominator', "`events/live: ${lv ? lv.length : 'not read'} events", "`events/live: events"],
  ['the {events} live shape is not recognised', 'isObj(j) && Array.isArray(j.events)', 'isObj(j) && false'],
  ['an empty slate reads as ANSWERED', '} else if (ng.length === 0) {', '} else if (false) {'],
  // shape
  ['the probability tolerance is a hundred times wider', '<= 0.011) sumOk++', '<= 1.011) sumOk++'],
  ['no_goal null is not counted', 'if (p.no_goal === null) noGoalNull++;', ''],
  ['is_call is judged with > instead of >=', 'r.is_call === (conf >= th)', 'r.is_call === (conf > th)'],
  ['confidence is never equal to the leader probability', 'Math.abs(conf - lp) <= 0.0101', 'Math.abs(conf - lp) < 0'],
  ['a percent accuracy is not recognised', "acc.every((v) => v > 1) ? 'percent (>1)'", "false ? 'percent (>1)'"],
  // filters
  ['calls_only is honoured even when indistinguishable', "listHadNonCalls ? 'HONOURED' : 'INDISTINGUISHABLE'", "'HONOURED'"],
  ['calls_only is never NOT_HONOURED', "!allCalls ? 'NOT_HONOURED'", "false ? 'NOT_HONOURED'"],
  ['calls_only returning 0 rows reads as honoured', "co.length === 0 && unfilteredCalls > 0 ? 'INCONSISTENT'", "false ? 'INCONSISTENT'"],
  ['league_id is honoured without its control', "allL && ctl.length === 0 ? 'HONOURED'", "allL ? 'HONOURED'"],
  ['an emptied league filter reads as honoured', "lg.length === 0 ? 'EMPTY_FOR_A_LEAGUE_WITH_READS'", "false ? 'EMPTY_FOR_A_LEAGUE_WITH_READS'"],
  // the ledger
  ['the accuracy denominator drops the misses', 'hit_over_hit_miss: [o.hit, o.hit + o.miss]', 'hit_over_hit_miss: [o.hit, o.hit]'],
  ['nogoal is left out of its own denominator', 'hit_over_hit_miss_nogoal: [o.hit, o.hit + o.miss + o.nogoal]', 'hit_over_hit_miss_nogoal: [o.hit, o.hit + o.miss]'],
  ['the outcome-sum consistency check is inverted', 'o.hit + o.miss + o.nogoal + o.unclear + o.open === L.countSince', 'o.hit + o.miss + o.nogoal + o.unclear + o.open !== L.countSince'],
  ['the ledger order is always newest-first', "(L.lastOffsetRowDateLike < L.pageFirstRowDateLike ? 'newest-first'", "(true ? 'newest-first'"],
  // headers and the token
  ['rate-limit headers are never matched', '([k]) => /ratelimit|retry-after/i.test(k)', '([k]) => /zzz/i.test(k)'],
  ['the token guard never refuses', 'body.includes(token)', 'false'],
  ['the token length floor is dropped', 'token.length >= 8', 'token.length >= 0'],
];

// HALF 3: the I/O of the probe, judged by the RUN check (a stub vendor, the real probe as a subprocess).
const IO_MUTATIONS = [
  ['the budget is off by one', 'if (calls >= CALL_BUDGET) {', 'if (calls > CALL_BUDGET) {'],
  ['a 429 or 401 does not stop the run', 'if (r.status === 429 || r.status === 401) stopped = String(r.status);', ''],
  ['a stop is recorded but ignored', 'if (stopped) { rec.blocked', 'if (false) { rec.blocked'],
  ['the token is not sent', 'Authorization: `Token ${TOKEN}`, Accept', 'Accept'],
  ['latest advances on any response, not only a 200', 'isObj(r) && r.status === 200),', 'isObj(r) && r.status != null),'],
  ['the token guard is gone', 'refuseIfTokenInside(body, TOKEN);', ''],
  ['a closed gate still lists finished events', 'if (ng !== null) {', 'if (true) {'],
  ['a closed ledger is still paged', 'if (raw.calls_since.status === 200) {', 'if (true) {'],
  ['no token still calls the vendor', "if (!TOKEN) { rec.blocked", "if (false) { rec.blocked"],
  ['the last-offset ledger call is skipped', "if (total && total > 1) await get('calls_last_offset'", "if (false) await get('calls_last_offset'"],
  ['the one-match call is skipped', "await get('ng_one'", "await Promise.resolve('ng_one'"],
];

// HALF 2. `blind`: the mutated CHECK must pass a probe that the real check fails (its red depends on that line).
//        `red`:   the mutated CHECK must fail the REAL probe (the gate it tightens binds).
const BROKEN_PROBE = ["s === 402 || s === 403 ? 'GATED'", "s === 402 ? 'GATED'"];
const CHECK_MUTATIONS = [
  ['blind', 'eq never fails', 'const ok = JSON.stringify(got) === JSON.stringify(want);', 'const ok = true;'],
  ['blind', 'the exit code ignores failures', 'process.exit(failed === 0 ? 0 : 1);', 'process.exit(0);'],
  ['red', 'MIN_SCENARIOS is one above the real count', 'export const MIN_SCENARIOS = 22;', 'export const MIN_SCENARIOS = 23;'],
  ['red', 'MIN_ASSERTIONS is one above the real count', 'export const MIN_ASSERTIONS = 90;', 'export const MIN_ASSERTIONS = 91;'],
];

const applyOnce = (text, anchor, replacement, label) => {
  const n = text.split(anchor).length - 1;
  if (n !== 1) return { error: `NOT APPLIED: anchor matched ${n} times, not 1 (${label})` };
  if (anchor === replacement) return { error: `NOT APPLIED: replacement equals anchor (${label})` };
  return { text: text.replace(anchor, () => replacement) };
};

let caught = 0, notCaught = 0, notApplied = 0, i = 0;
const srcText = fs.readFileSync(SRC, 'utf8');
const checkText = fs.readFileSync(CHECK, 'utf8');

const baseline = runCheck(CHECK, SRC);
console.log(`baseline: the check on the real probe exits ${baseline}`);
if (baseline !== 0) { console.log('FAIL  the check is already red; every mutation would be "caught" for the wrong reason'); process.exit(1); }

console.log('\nHALF 1: the probe, broken');
for (const [name, anchor, replacement] of SOURCE_MUTATIONS) {
  const r = applyOnce(srcText, anchor, replacement, name);
  if (r.error) { notApplied++; console.log(`  ${r.error}  [${name}]`); continue; }
  const f = path.join(tmp, `probe-${i++}.mjs`);
  fs.writeFileSync(f, r.text);
  const status = runCheck(CHECK, f);
  if (status === 1) { caught++; console.log(`  caught       ${name}`); }
  else { notCaught++; console.log(`  NOT CAUGHT   ${name}  (check exit ${status})`); }
}

console.log('\nHALF 3: the probe\'s I/O, judged by the run check');
const runBaseline = runCheck(RUN_CHECK, SRC);
console.log(`  baseline: the run check on the real probe exits ${runBaseline}`);
if (runBaseline !== 0) { console.log('FAIL  the run check is already red'); process.exit(1); }
for (const [name, anchor, replacement] of IO_MUTATIONS) {
  const r = applyOnce(srcText, anchor, replacement, name);
  if (r.error) { notApplied++; console.log(`  ${r.error}  [${name}]`); continue; }
  const f = path.join(tmp, `probe-io-${i++}.mjs`);
  fs.writeFileSync(f, r.text);
  const status = runCheck(RUN_CHECK, f);
  if (status === 1) { caught++; console.log(`  caught       ${name}`); }
  else { notCaught++; console.log(`  NOT CAUGHT   ${name}  (run check exit ${status})`); }
}

console.log('\nHALF 2: the check, broken');
const brokenProbe = applyOnce(srcText, BROKEN_PROBE[0], BROKEN_PROBE[1], 'broken probe for HALF 2');
if (brokenProbe.error) { console.log(`  ${brokenProbe.error}`); process.exit(1); }
const brokenProbeFile = path.join(tmp, 'probe-broken.mjs');
fs.writeFileSync(brokenProbeFile, brokenProbe.text);
console.log(`  precondition: the real check on the broken probe exits ${runCheck(CHECK, brokenProbeFile)} (must be 1)`);
if (runCheck(CHECK, brokenProbeFile) !== 1) process.exit(1);
for (const [kind, name, anchor, replacement] of CHECK_MUTATIONS) {
  const r = applyOnce(checkText, anchor, replacement, name);
  if (r.error) { notApplied++; console.log(`  ${r.error}  [${name}]`); continue; }
  const f = path.join(tmp, `check-${i++}.mjs`);
  fs.writeFileSync(f, r.text);
  const status = kind === 'blind' ? runCheck(f, brokenProbeFile) : runCheck(f, SRC);
  const ok = kind === 'blind' ? status === 0 : status === 1;
  if (ok) { caught++; console.log(`  caught       ${name}  (${kind}: mutated check exit ${status})`); }
  else { notCaught++; console.log(`  NOT CAUGHT   ${name}  (${kind}: mutated check exit ${status})`); }
}

const moved = [SRC, CHECK, RUN_CHECK].filter((f) => sha(f) !== before[f]);
console.log(`\nmutations ${SOURCE_MUTATIONS.length + IO_MUTATIONS.length + CHECK_MUTATIONS.length}: caught ${caught}, NOT CAUGHT ${notCaught}, NOT APPLIED ${notApplied}; real files moved: ${moved.length}`);
if (moved.length) console.log(`FAIL  the real file(s) changed: ${moved.join(', ')}`);
process.exit(notCaught === 0 && notApplied === 0 && moved.length === 0 ? 0 : 1);
