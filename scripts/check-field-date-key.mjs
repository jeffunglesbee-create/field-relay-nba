#!/usr/bin/env node
// getFieldDateKey() names the slate FIELD calls "today": the ET date, held on
// the previous date until 4am ET. docs/CC-CMD-2026-10-22-ambient-capture-
// coverage-gaps.md, review finding G2.
//
// The defect this pins: the old body stepped back 24 hours on the instant, not
// one calendar day. The spring-forward day is 23 hours long, so from 00:00 to
// 00:59 EDT on the Monday after it (2027-03-15T04:00-04:59Z) the key named the
// Saturday. The review's 5-minute sweep found exactly those 12 instants.
//
// Two checks, so neither has to be trusted alone:
//   TABLE  hand-written instants with the expected date written out: both DST
//          changes, the 4am edges, a year end and a leap day.
//   SWEEP  every 15 minutes over 2026-10-01..2027-12-31 (both DST changes of
//          each year, every 04:00 edge exactly) against an oracle that reaches
//          the answer another way (the date of the ET wall clock minus four
//          hours), with the instant count printed (Rule 91).
// And it checks that src/index.js has no copy of its own.
//
//   node scripts/check-field-date-key.mjs            # self-test
//   node scripts/check-field-date-key.mjs --mutate   # Rule 90

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src/field-date.js');
const MODULE = process.env.FIELD_DATE_MODULE || SRC;

// [instant, ET wall clock (for the reader), expected key]
const TABLE = [
  ['2026-10-20T03:30:00Z', '23:30 EDT Mon 10-19', '2026-10-19'],
  ['2026-10-20T07:59:00Z', '03:59 EDT Tue 10-20', '2026-10-19'],
  ['2026-10-20T08:00:00Z', '04:00 EDT Tue 10-20', '2026-10-20'],
  ['2026-11-01T04:30:00Z', '00:30 EDT Sun 11-01', '2026-10-31'],
  ['2026-11-01T05:30:00Z', '01:30 EDT, the first', '2026-10-31'],
  ['2026-11-01T06:30:00Z', '01:30 EST, the second', '2026-10-31'],
  ['2026-11-01T08:59:00Z', '03:59 EST Sun 11-01', '2026-10-31'],
  ['2026-11-01T09:00:00Z', '04:00 EST Sun 11-01', '2026-11-01'],
  ['2026-11-02T04:30:00Z', '23:30 EST Sun 11-01', '2026-11-01'],
  ['2026-11-02T08:30:00Z', '03:30 EST Mon 11-02', '2026-11-01'],
  ['2026-11-02T09:30:00Z', '04:30 EST Mon 11-02', '2026-11-02'],
  ['2026-12-31T05:30:00Z', '00:30 EST Thu 12-31', '2026-12-30'],
  ['2027-01-01T05:30:00Z', '00:30 EST Fri 01-01', '2026-12-31'],
  ['2027-03-01T05:30:00Z', '00:30 EST Mon 03-01', '2027-02-28'],
  ['2027-03-14T06:30:00Z', '01:30 EST Sun 03-14', '2027-03-13'],
  ['2027-03-14T07:30:00Z', '03:30 EDT Sun 03-14', '2027-03-13'],
  ['2027-03-14T08:00:00Z', '04:00 EDT Sun 03-14', '2027-03-14'],
  ['2027-03-15T03:59:00Z', '23:59 EDT Sun 03-14', '2027-03-14'],
  ['2027-03-15T04:30:00Z', '00:30 EDT Mon 03-15', '2027-03-14'],   // G2: was 2027-03-13
  ['2027-03-15T07:59:00Z', '03:59 EDT Mon 03-15', '2027-03-14'],
  ['2028-03-01T05:30:00Z', '00:30 EST Wed 03-01', '2028-02-29'],
];

const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function oracle(t) {
  const p = Object.fromEntries(ET.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(wall - 4 * 3600_000).toISOString().slice(0, 10);
}

async function selfTest() {
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };
  const { getFieldDateKey } = await import(pathToFileURL(MODULE).href);

  const wrong = TABLE.filter(([at, , want]) => getFieldDateKey(new Date(at)) !== want)
    .map(([at, wall, want]) => `${at} (${wall}): ${getFieldDateKey(new Date(at))}, want ${want}`);
  eq(`TABLE: ${TABLE.length} hand-written instants`, wrong, []);

  // The oracle is checked against the table too, so a broken oracle cannot
  // make the sweep agree with a broken implementation.
  eq('the oracle agrees with every table row', TABLE.filter(([at, , want]) => oracle(Date.parse(at)) !== want).map(r => r[0]), []);

  const from = Date.parse('2026-10-01T00:00:00Z'), to = Date.parse('2027-12-31T23:45:00Z');
  let n = 0;
  const misses = [];
  for (let t = from; t <= to; t += 15 * 60_000) {
    n++;
    const got = getFieldDateKey(new Date(t)), want = oracle(t);
    if (got !== want) misses.push(`${new Date(t).toISOString()}: ${got}, want ${want}`);
  }
  eq(`SWEEP: ${n} instants, every 15 minutes, 2026-10-01..2027-12-31`, misses.slice(0, 5).concat(misses.length > 5 ? [`… ${misses.length} in all`] : []), []);

  // Called with no argument, it reads the clock (every production caller).
  eq('with no argument it reads the current clock', getFieldDateKey(), oracle(Date.now()));

  const index = readFileSync(path.resolve(HERE, '../src/index.js'), 'utf8');
  eq('src/index.js imports getFieldDateKey from ./field-date.js and defines no copy of its own',
    [/^import \{ getFieldDateKey \} from '\.\/field-date\.js';$/m.test(index), /function getFieldDateKey\s*\(/.test(index)], [true, false]);

  console.log(failed ? `\nSELF-TEST FAILED: ${failed}` : '\nself-test passed');
  return failed;
}

const MUTATIONS = [
  ['24 hours back on the instant (the old body)', [[
    "    if (etHour >= 4) return etDate;\n    const [y, m, d] = etDate.split('-').map(Number);\n    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);",
    "    if (etHour >= 4) return etDate;\n    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });"]]],
  ['no 4am hold', [['    if (etHour >= 4) return etDate;', '    return etDate;']]],
  ['held until 5am', [['    if (etHour >= 4) return etDate;', '    if (etHour >= 5) return etDate;']]],
  ['released at 4:01, not 4:00', [['    if (etHour >= 4) return etDate;', '    if (etHour > 4) return etDate;']]],
  ['a fixed EDT offset', [["    const etDate = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD",
    "    const etDate = new Date(now.getTime() - 4 * 3600_000).toISOString().slice(0, 10); // YYYY-MM-DD"]]],
  ['steps back two days', [['    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);',
    '    return new Date(Date.UTC(y, m - 1, d - 2)).toISOString().slice(0, 10);']]],
];

function mutate() {
  const src = readFileSync(SRC, 'utf8');
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout + base.stderr); return 1; }
  let bad = 0;
  for (const [name, edits] of MUTATIONS) {
    let text = src, why = null;
    for (const [from, to] of edits) {
      const at = text.indexOf(from);
      if (at < 0 || text.indexOf(from, at + 1) >= 0) { why = at < 0 ? 'missing' : 'not unique'; break; }
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
    if (why) { console.log(`  ANCHOR     ${name} (${why}): not run`); bad++; continue; }
    const mutant = path.join(path.dirname(SRC), `.mutant-${process.pid}-field-date.js`);
    writeFileSync(mutant, text);
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, FIELD_DATE_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (.*)$/gm) || []).map(l => l.slice(7));
      if (r.status !== 0 && /SELF-TEST FAILED/.test(r.stdout) && fails.length) {
        console.log(`  CAUGHT     ${name}\n               by: ${fails.join(' | ')}`);
      } else if (r.status === 0) {
        console.log(`  NOT CAUGHT ${name}`); bad++;
      } else {
        console.log(`  HARNESS ERROR ${name} (exit ${r.status}, no failing assertion)\n${(r.stderr || '').slice(0, 400)}`); bad++;
      }
    } finally { unlinkSync(mutant); }
  }
  console.log(`\nmutations: ${MUTATIONS.length - bad} of ${MUTATIONS.length} caught`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--mutate')) process.exit(mutate());
else process.exit(await selfTest() ? 1 : 0);
