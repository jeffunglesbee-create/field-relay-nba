#!/usr/bin/env node
// Rule 90 harness for scripts/check-degrade-by-hour.mjs.
//
// Each mutation breaks one clause of the hour map (or of the watch's copy of the overload mark) in a COPY of the
// source, points the check at the copy through BUDGET_HELPERS_SRC / WATCH_SRC, and requires the check to go red
// on that clause's own FAIL line. The real files are never written.
//
// A mutation counts as CAUGHT only when the check exits non-zero AND prints a FAIL line AND that line names the
// clause. An anchor that is not unique, a mutation that did not apply, or a crash with no FAIL line is a harness
// defect and is reported as one (Rule 90's corollary: NOT CAUGHT with nothing mutated is worse than no test).
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HELPERS = 'src/budget-helpers.js';
const WATCH = 'scripts/watch-odds-pairing-rate.mjs';
const MUT_HELPERS = 'src/__mut_budget_helpers__.js';   // beside the original so its relative imports resolve
const MUT_WATCH = 'scripts/__mut_watch__.mjs';

const MUTATIONS = [
  { name: 'H1  by_hour is built and then dropped from the written value',
    file: 'helpers', anchor: "            by_hour: byHour,\n", replace: '',
    expect: 'by_hour is written into the degrade counter value' },
  { name: 'H2  the hour is read from the minutes of the timestamp',
    file: 'helpers', anchor: 'at.slice(11, 13), reason)', replace: 'at.slice(14, 16), reason)',
    expect: 'the event is filed under its UTC hour' },
  { name: 'H3  an overload is never counted as one',
    file: 'helpers', anchor: ".includes(D1_OVERLOAD_MARK) ? 1 : 0)", replace: ".includes(D1_OVERLOAD_MARK + '!') ? 1 : 0)",
    expect: 'the first event files under its hour, counting an overload' },
  { name: 'H4  every event is counted as an overload',
    file: 'helpers', anchor: ".includes(D1_OVERLOAD_MARK) ? 1 : 0)", replace: ".includes(D1_OVERLOAD_MARK) ? 1 : 1)",
    expect: 'a non-overload reason is an event and not an overload' },
  { name: 'H5  the previous hours are discarded, so nothing accumulates',
    file: 'helpers',
    anchor: "const by = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? { ...prev } : {};",
    replace: "const by = {};",
    expect: 'a repeat in the same hour accumulates' },
  { name: 'H6  a malformed hour is filed as a new key',
    file: 'helpers', anchor: "    if (!/^(?:[01]\\d|2[0-3])$/.test(String(hour))) return by;\n", replace: '',
    expect: 'a malformed hour is ignored' },
  { name: 'H7  a second KV write per degrade',
    file: 'helpers', anchor: "            last: at,\n        }), { expirationTtl: 172800 });",
    replace: "            last: at,\n        }), { expirationTtl: 172800 });\n        await env.FIELD_JOURNALISM.put(key + ':hours', JSON.stringify(byHour), { expirationTtl: 172800 });",
    expect: 'ONE put per degrade' },
  { name: 'H8  the previous map is mutated in place',
    file: 'helpers',
    anchor: "const by = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? { ...prev } : {};",
    replace: "const by = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? prev : {};",
    expect: 'the input is not mutated' },
  { name: 'H9  `last` reads the clock a second time',
    file: 'helpers', anchor: "            last: at,\n", replace: "            last: new Date().toISOString(),\n",
    expect: 'takes ONE instant' },
  { name: 'H10 the day key is read from a different instant than the hour',
    file: 'helpers', anchor: "_degradeKey(at.slice(0, 10))", replace: "_degradeKey()",
    expect: 'the day key is derived from that instant' },
  { name: 'H11 the overload test sees only the 120-character key',
    file: 'helpers', anchor: "(String(reason || '').includes(D1_OVERLOAD_MARK)", replace: "(String(reason || '').slice(0, 120).includes(D1_OVERLOAD_MARK)",
    expect: 'the FULL reason is tested' },
  { name: "H12 the watch's copy of the overload mark drifts from the writer's",
    file: 'watch', anchor: "export const D1_OVERLOAD_MARK   = 'D1 DB is overloaded';", replace: "export const D1_OVERLOAD_MARK   = 'D1 database is overloaded';",
    expect: 'the pairing watch matches overloads on the same string' },
];

let bad = 0;
const cleanup = () => { for (const f of [MUT_HELPERS, MUT_WATCH]) { try { unlinkSync(f); } catch { /* not created */ } } };
process.on('exit', cleanup);

for (const m of MUTATIONS) {
  const orig = m.file === 'helpers' ? HELPERS : WATCH;
  const mut = m.file === 'helpers' ? MUT_HELPERS : MUT_WATCH;
  const before = readFileSync(orig, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) { bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED — harness defect, not a result.`); continue; }
  const after = before.replace(m.anchor, m.replace);
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue; }
  writeFileSync(mut, after);
  const env = { ...process.env,
    BUDGET_HELPERS_SRC: m.file === 'helpers' ? MUT_HELPERS : HELPERS,
    WATCH_SRC: m.file === 'watch' ? MUT_WATCH : WATCH };
  let out = '', code = 0;
  try { out = execFileSync('node', ['scripts/check-degrade-by-hour.mjs'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { cleanup(); }
  const red = out.split('\n').filter((l) => l.startsWith('FAIL  '));
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the check still passed.`); }
  else if (!red.length) { bad++; console.error(`  CRASH  ${m.name}\n          exit ${code} with no FAIL line (a harness or syntax error, not a catch). Output tail:\n${out.slice(-500)}`); }
  else if (!red.some((l) => l.includes(m.expect))) { bad++; console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}". Red lines:\n${red.join('\n')}`); }
  else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

// The unmutated check must be green, or every "caught" above could be the check failing for its own reasons.
let base = 0;
try { execFileSync('node', ['scripts/check-degrade-by-hour.mjs'], { stdio: 'ignore' }); } catch (e) { base = e.status ?? 1; }
if (base) { bad++; console.error('  BASELINE  the unmutated check is red, so no catch above means anything.'); }
else console.log('  baseline  the unmutated check is green');

console.log(`\nran ${MUTATIONS.length} mutation(s) against scripts/check-degrade-by-hour.mjs; each asserted its anchor unique and its effect present; the real files were not written`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught or not applied.`); process.exit(1); }
console.log('PASS');
