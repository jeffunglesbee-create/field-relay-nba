#!/usr/bin/env node
// Mutation harness for scripts/check-bsd-uefa-join.mjs (CLAUDE.md Rule 90). The check, the join module, the resolver and the fixture are copied into a temp directory
// (the tracked src/ is only read); each mutant breaks the COPY of the resolver or the join and must turn the check red:
//   - each UEFA club alias, deleted in turn (every one of them was derived from a row the join left unmatched, so every one is needed by a row),
//   - each UEFA label, taken off the join list,
//   - the join's own rule (ambiguous read as the first candidate, orientation ignored, an unmatched row joined to the only event of the day).
// Controls: the unmodified copy and a comment-only copy must pass, with at least MIN_CHECKS checks. The anchors must each match once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_CHECKS = 20;
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-bsd-uefa-')));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
for (const sub of ['src', 'scripts', 'outbox']) fs.mkdirSync(path.join(TMP, sub));
const resolver = fs.readFileSync(path.join(root, 'src/identity-resolver.js'), 'utf8');
const join = fs.readFileSync(path.join(root, 'src/bsd-game-join.js'), 'utf8');
fs.copyFileSync(path.join(root, 'scripts/check-bsd-uefa-join.mjs'), path.join(TMP, 'scripts/check-bsd-uefa-join.mjs'));
fs.copyFileSync(path.join(root, 'outbox/fixture-bsd-game-join-uefa.json'), path.join(TMP, 'outbox/fixture-bsd-game-join-uefa.json'));
const run = (res, jn) => {
  fs.writeFileSync(path.join(TMP, 'src/identity-resolver.js'), res);
  fs.writeFileSync(path.join(TMP, 'src/bsd-game-join.js'), jn);
  const parse = [path.join(TMP, 'src/identity-resolver.js'), path.join(TMP, 'src/bsd-game-join.js')].map((f) => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })).find((r) => r.status !== 0);
  if (parse) return { invalid: true, detail: (parse.stderr || '').split('\n').slice(0, 3).join(' | ') };
  const r = spawnSync(process.execPath, [path.join(TMP, 'scripts/check-bsd-uefa-join.mjs')], { encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

// the UEFA alias entries: the lines between the block's comment and the end of the table
const startMark = "        // ── UEFA club names (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Addendum 2026-11-25";
const si = resolver.indexOf(startMark);
const ei = resolver.indexOf('\n    ];', si);
if (si < 0 || ei < 0 || resolver.indexOf(startMark, si + 1) >= 0) { console.error('the UEFA alias block was not found exactly once'); process.exit(2); }
const lines = resolver.slice(si, ei).split('\n');
const entryRe = /^\s+\['(?:[^'\\]|\\.)*',\s+'(?:[^'\\]|\\.)*'\],$/;
const mutants = [];
lines.forEach((l, i) => {
  if (!entryRe.test(l)) return;
  const copy = lines.slice(); copy[i] = `        // ${l.trim()}`;
  mutants.push({ name: `alias deleted: ${l.trim()}`, res: resolver.slice(0, si) + copy.join('\n') + resolver.slice(ei), jn: join });
});
const entries = mutants.length;
const M = (name, anchor, replacement) => {
  const c = join.split(anchor).length - 1;
  if (c !== 1) { console.error(`ANCHOR for "${name}" occurs ${c} times, not once`); process.exit(2); }
  mutants.push({ name, res: resolver, jn: join.replace(anchor, () => replacement) });
};
for (const l of ["'UEFA Champions League',", "'UEFA Europa League',", "'UEFA Europa Conference League',", "'UEFA Champions League Qualifying',", "'UEFA Europa League Qualifying',", "'UEFA Europa Conference League Qualifying'];"]) {
  const c = join.split(l).length - 1;
  if (c !== 1) { console.error(`label anchor ${l} occurs ${c} times`); process.exit(2); }
  mutants.push({ name: `label off the list: ${l.replace(/[',;\]]/g, '')}`, res: resolver, jn: join.replace(l, l.endsWith('];') ? '];' : '') });
}
M('the join takes the first of several candidates', "if (candidates.length > 1) return { bsd_event_id: null, how: 'ambiguous', candidates: candidates.length };", "if (candidates.length > 1) return { bsd_event_id: String(candidates[0].id), how: 'joined', kickoff: 'unjudged', candidates: candidates.length };");
M('the join ignores orientation', "resolveTeamKey(nameOf(e.home_team)) === h && resolveTeamKey(nameOf(e.away_team)) === a);", "(resolveTeamKey(nameOf(e.home_team)) === h && resolveTeamKey(nameOf(e.away_team)) === a) || (resolveTeamKey(nameOf(e.home_team)) === a && resolveTeamKey(nameOf(e.away_team)) === h));");
M('the join accepts a side that matches alone', "resolveTeamKey(nameOf(e.home_team)) === h && resolveTeamKey(nameOf(e.away_team)) === a);", "resolveTeamKey(nameOf(e.home_team)) === h || resolveTeamKey(nameOf(e.away_team)) === a);");
M('a row of a label not on the list is joined', "if (!BSD_SOCCER_SPORTS.includes(row?.sport)) return { bsd_event_id: null, how: 'not-soccer' };", '');

let bad = 0;
const problems = [];
const clean = run(resolver, join);
const m = clean.invalid ? null : /^ok (\d+) checks/m.exec(clean.out);
if (clean.invalid || clean.status !== 0 || m === null || Number(m[1]) < MIN_CHECKS) { bad++; problems.push(`CONTROL unmodified copy did not pass with at least ${MIN_CHECKS} checks: ${clean.invalid ? clean.detail : clean.out.slice(0, 300)}`); }
const comment = run(resolver, `${join}\n// harmless\n`);
if (comment.invalid || comment.status !== 0) { bad++; problems.push('CONTROL a comment-only change turned the check red'); }
let caught = 0;
for (const mu of mutants) {
  const r = run(mu.res, mu.jn);
  if (r.invalid) { console.error(`mutant "${mu.name}" does not parse: ${r.detail}`); process.exit(2); }
  if (mu.res === resolver && mu.jn === join) { console.error(`mutant "${mu.name}" changed nothing`); process.exit(2); }
  if (r.status !== 0) caught++; else { bad++; problems.push(`NOT CAUGHT ${mu.name}`); console.log(`NOT CAUGHT ${mu.name}`); }
}
console.log(`${caught} of ${mutants.length} mutations caught (${entries} alias deletions, ${mutants.length - entries} others); controls ${clean.status === 0 && comment.status === 0 ? 'ok' : 'FAILED'}; ${MIN_CHECKS} checks required of the clean copy`);
if (bad) { console.log(problems.join('\n')); process.exit(1); }
