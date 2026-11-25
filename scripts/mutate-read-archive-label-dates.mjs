#!/usr/bin/env node
// Mutation harness for scripts/read-archive-label-dates.mjs (CLAUDE.md Rule 90). Each mutant is a broken copy written NEXT TO the real one under a dot-name, run with --self-test,
// and must turn it red. Unique anchors, parse check, and a clean copy that must pass with at least MIN_ASSERTIONS assertions.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 18;
const dir = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(dir, 'read-archive-label-dates.mjs');
const MUT = path.join(dir, '.mutant-read-archive-label-dates.mjs');
const src = fs.readFileSync(REAL, 'utf8');
const M = (name, anchor, replacement) => ({ name, anchor, replacement });
const MUTANTS = [
  M('the label pattern allows a quote', "export const LIKE = /^[A-Za-z0-9 %.-]{1,40}$/;", "export const LIKE = /^[A-Za-z0-9 %.'-;]{1,40}$/;"),
  M('the label pattern has no length limit', '{1,40}$/;', '{1,}$/;'),
  M('the label pattern is not anchored at the end', "%.-]{1,40}$/;", "%.-]{1,40}/;"),
  M('the pattern is not checked', "if (!LIKE.test(like)) throw new Error(`not a label pattern: ${JSON.stringify(like)}`);", ''),
  M('any table is allowed', "if (!TABLES.includes(table)) throw new Error(`not a game table: ${table}`);", ''),
  M('the pattern is spliced into the statement', "WHERE sport LIKE ? GROUP BY sport, date ORDER BY date, sport`, params: [like] };", "WHERE sport LIKE '${like}' GROUP BY sport, date ORDER BY date, sport`, params: [] };"),
  M('joined counts every row', 'COUNT(bsd_event_id) AS joined FROM ${table}', 'COUNT(*) AS joined FROM ${table}'),
  M('no results array is an empty answer', "|| !Array.isArray(body.results)) return null;", "|| !Array.isArray(body.results)) return [];"),
  M('a malformed row is skipped', "|| !Number.isInteger(r.joined)) return null;", "|| !Number.isInteger(r.joined)) continue;"),
  M('a date that is not a date is accepted', "!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(r.date)) || ", ''),
  M('a count that is text is accepted', "!Number.isInteger(r.n) || ", ''),
  M('joined is not summed', 'l.rows += r.n; l.joined += r.joined;', 'l.rows += r.n;'),
  M('the dates are not distinct per label', 'l.dates.add(r.date);', 'l.dates.add(r.date + r.n);'),
  M('the dates are not sorted', 'dates: [...dates].sort(),', 'dates: [...dates],'),
  M('the last date is the first', ".at(-1), tables: v.tables", "[0], tables: v.tables"),
  M('a refused secret is an empty answer', "if (r.status !== 200 || body.success === false || body.ok === false) throw new Error(`d1 HTTP ${r.status}`);", ''),
  M('the secret is not sent', "'X-FIELD-Relay': secret }", "'X-FIELD-Relay': '' }"),
  M('only the first table is read', 'for (const table of TABLES) {\n    byTable[table] = [];', 'for (const table of TABLES.slice(0, 1)) {\n    byTable[table] = [];'),
  M('only the first pattern is read', 'for (const like of likes) {', 'for (const like of likes.slice(0, 1)) {'),
];
let bad = 0;
const problems = [];
function runWith(text) {
  fs.writeFileSync(MUT, text);
  const parse = spawnSync(process.execPath, ['--check', MUT], { encoding: 'utf8' });
  if (parse.status !== 0) return { invalid: true, detail: (parse.stderr || '').split('\n').slice(0, 3).join(' | ') };
  const r = spawnSync(process.execPath, [MUT, '--self-test'], { encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
try {
  const clean = runWith(src);
  const m = clean.invalid ? null : /^ok (\d+) assertions/m.exec(clean.out);
  if (clean.invalid || clean.status !== 0 || m === null || Number(m[1]) < MIN_ASSERTIONS) { bad++; problems.push(`CONTROL unmodified copy did not pass with at least ${MIN_ASSERTIONS} assertions: ${clean.out ? clean.out.slice(0, 300) : clean.detail}`); }
  let caught = 0;
  for (const mu of MUTANTS) {
    const count = src.split(mu.anchor).length - 1;
    if (count !== 1) { console.error(`ANCHOR for "${mu.name}" occurs ${count} times, not once`); process.exitCode = 2; throw new Error('anchor'); }
    const mutated = src.replace(mu.anchor, () => mu.replacement);
    if (mutated === src) { console.error(`mutant "${mu.name}" did not change the text`); process.exitCode = 2; throw new Error('noop'); }
    const r = runWith(mutated);
    if (r.invalid) { console.error(`mutant "${mu.name}" does not parse: ${r.detail}`); process.exitCode = 2; throw new Error('parse'); }
    if (r.status !== 0) { caught++; console.log(`CAUGHT   ${mu.name}`); } else { bad++; problems.push(`NOT CAUGHT ${mu.name}`); console.log(`NOT CAUGHT ${mu.name}`); }
  }
  console.log(`\n${caught} of ${MUTANTS.length} mutations caught; control ${clean.status === 0 ? 'ok' : 'FAILED'}; ${MIN_ASSERTIONS} assertions required of the clean copy`);
} catch (e) {
  if (process.exitCode !== 2) { console.error(e && e.stack ? e.stack : e); process.exitCode = 1; }
} finally {
  try { fs.unlinkSync(MUT); } catch (_) {
    // catch-ok: the mutant file is absent when the run stopped before it wrote one
  }
}
if (bad) { console.log(problems.join('\n')); process.exitCode = 1; }
