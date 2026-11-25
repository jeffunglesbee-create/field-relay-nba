#!/usr/bin/env node
// Mutation harness for scripts/run-archive-league-history-backfill.mjs (CLAUDE.md Rule 90): each mutant is a broken copy beside the real file under a dot-name, run with --self-test,
// and must turn it red. Unique anchors, a parse check, and a clean copy that must pass with at least MIN_ASSERTIONS.
// NOT EXERCISED, and said so: main() (the flags, the d1 helper over a real relay, the artifact). The first real run is a --dry-run on a runner, then the run itself.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 27;
const dir = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(dir, 'run-archive-league-history-backfill.mjs');
const MUT = path.join(dir, '.mutant-run-archive-league-history-backfill.mjs');
const src = fs.readFileSync(REAL, 'utf8');
const M = (name, anchor, replacement) => ({ name, anchor, replacement });
const MUTANTS = [
  M('the ESPN base is not required', "if (m === null) throw new Error('ESPN_API_BASE was not found in src/index.js');", ''),
  M('the ESPN base may be plain http', "'(https:\\/\\/[a-z0-9.-]+\\/apis\\/site\\/v2)'", "'(https?:\\/\\/[a-z0-9.-]+\\/apis\\/site\\/v2)'"),
  M('a reversed range is accepted', "if (b < a) throw new Error(`the range is reversed: ${from} .. ${to}`);", ''),
  M('the range is not inclusive', 'Math.round((b - a) / 86400000) + 1;', 'Math.round((b - a) / 86400000);'),
  M('a range over a year is accepted', 'if (days > 366)', 'if (days > 36600)'),
  M('a date that rolls over is a date', "&& new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;", ';'),
  M('an event with no status is complete', "comp?.status?.type?.completed !== true) continue;", "comp?.status?.type?.completed === false) continue;"),
  M('an unfinished event is complete', "comp?.status?.type?.completed !== true) continue;", "comp?.status?.type?.completed === 'x') continue;"),
  M('the sides have no fallback', "const home = teams.find((t) => t.homeAway === 'home') || teams[0];", "const home = teams.find((t) => t.homeAway === 'home');"),
  M('the away side is the first competitor', "const away = teams.find((t) => t.homeAway === 'away') || teams[1];", "const away = teams[0];"),
  M('the display name before the short name', "home?.team?.shortDisplayName || home?.team?.displayName || ''", "home?.team?.displayName || home?.team?.shortDisplayName || ''"),
  M('the event id is not text', "eventId: String(ev.id || ''),", "eventId: ev.id,"),
  M('the away name is the display name before the short name', "away?.team?.shortDisplayName || away?.team?.displayName || ''", "away?.team?.displayName || away?.team?.shortDisplayName || ''"),
  M('the body sends ESPN\'s sport, not the label', 'return { sport: label, league: label,', "return { sport: 'soccer', league: label,"),
  M('the body leaves the event id out', 'source_id: g.eventId,', 'source_id: null,'),
  M('went_to_ot is true', 'went_to_ot: null };', 'went_to_ot: true };'),
  M('a 429 does not stop the run', "if (r.status === 403 || r.status === 429) {", "if (r.status === 403) {"),
  M('a 403 does not stop the run', "if (r.status === 403 || r.status === 429) {", "if (r.status === 429) {"),
  M('a scoreboard that is not 200 does not stop the run', "if (r.status !== 200 || r.json === null) { sum.stopped = `the scoreboard for ${date} did not answer 200 with JSON (${r.status})`; break; }", ''),
  M('an event with no id is written', "if (g.eventId === '') { sum.noEventId++; continue; }", ''),
  M('an archived row with no score counts as archived', 'if (rows.length > 0 && rows[0].home_score !== null)', 'if (rows.length > 0)'),
  M('an archived and scored row is written again', 'if (rows.length > 0 && rows[0].home_score !== null) { sum.alreadyArchived++; continue; }', ''),
  M('--dry-run writes', 'if (dry) continue;', ''),
  M('a refused write counts as written', 'if (res === 200) sum.written++;', 'if (res >= 200) sum.written++;'),
  M('a failed write is not counted', 'else sum.failedWrites++;', ';'),
  M('a 200 whose body is not JSON is an empty day', "catch (e) { return { status: 200, json: null, error: `not JSON: ${e.message}` }; }", "catch (e) { return { status: 200, json: { events: [] } }; }"),
  M('the dedup reads the wrong id', '[g.eventId, g.eventId]);', "['0', '0']);"),
  M('every date is asked of the same day', 'dates=${date.replace(/-/g, \'\')}`', 'dates=${dates[0].replace(/-/g, \'\')}`'),
  M('the league is not asked for', '/sports/soccer/${league}/scoreboard', '/sports/soccer/eng.1/scoreboard'),
];
let bad = 0;
const problems = [];
function runWith(text) {
  fs.writeFileSync(MUT, text);
  const parse = spawnSync(process.execPath, ['--check', MUT], { encoding: 'utf8' });
  if (parse.status !== 0) return { invalid: true, detail: (parse.stderr || '').split('\n').slice(0, 3).join(' | ') };
  const r = spawnSync(process.execPath, [MUT, '--self-test'], { encoding: 'utf8', timeout: 90000 });
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
