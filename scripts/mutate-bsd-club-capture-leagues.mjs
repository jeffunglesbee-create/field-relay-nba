#!/usr/bin/env node
// Mutation harness for scripts/check-bsd-club-capture-leagues.mjs (CLAUDE.md Rule 90). Each mutant is a broken copy of src/index.js (in a temp directory; the tracked file is only
// read) run through the check with --source, and must turn it red. The harness distrusts itself first: every anchor must occur exactly once, every mutant must differ from the
// source, and the unmodified copy and a comment-only copy must pass with at least MIN_ASSERTIONS assertions.
//
// EQUIVALENT (not mutated, with the reason): the 6000 ms fetch timeouts (timing, not output); the `source: 'club-endgame-cron'` and `captured` fields of the object metadata (not
// read by anything the check can see, and the check pins `type` and `league_id` which are); `captureWithRetry`'s attempt count for the two endpoints (the call passes 1 and the
// stub answers 200 first time, so a retry is never reached: the cost assertion pins the request count instead).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 12;
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const CHECK = path.join(dir, 'check-bsd-club-capture-leagues.mjs');
const src = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
// `of`: how many times the anchor occurs in the file (the WC capture function above the club one has near-identical lines); `nth`: which of them is mutated (the club function is the later one)
const M = (name, anchor, replacement, of = 1, nth = 1) => ({ name, anchor, replacement, of, nth });
const MUTANTS = [
  M('the Carabao Cup loses its BSD league id', "espnLeague: 'eng.league_cup',    bsdLeagueId: 40,", "espnLeague: 'eng.league_cup',    bsdLeagueId: null,"),
  M('the Carabao Cup is given another league id', "espnLeague: 'eng.league_cup',    bsdLeagueId: 40,", "espnLeague: 'eng.league_cup',    bsdLeagueId: 41,"),
  M('the EFL Trophy is given the cup\'s league id', "espnLeague: 'eng.trophy',       bsdLeagueId: null,", "espnLeague: 'eng.trophy',       bsdLeagueId: 40,"),
  M('the FA Cup is given a league id', "espnLeague: 'eng.fa',           bsdLeagueId: null,", "espnLeague: 'eng.fa',           bsdLeagueId: 39,"),
  M('a shared league id is won by the last slug listed', 'if (Number.isInteger(lid) && !(lid in map)) map[lid] = slug;', 'if (Number.isInteger(lid)) map[lid] = slug;'),
  M('a league nobody asked for is captured', "if (!BSD_LEAGUE_ID_TO_SLUG[e.league_id]) return false; // untracked league -- skip, never write a garbage key", ''),
  M('a finished match is captured', "garbage key\n        if ((e.status || '').toLowerCase() === 'finished') return false;", 'garbage key'),
  M('a match before minute 80 is captured', 'return (e.current_minute || 0) >= 80;', 'return (e.current_minute || 0) >= 0;', 2, 2),
  M('the fallback window opens at kickoff', 'return elapsedMin >= 80 && elapsedMin <= 120;', 'return elapsedMin >= 0 && elapsedMin <= 120;', 2, 2),
  M('the fallback window never closes', 'return elapsedMin >= 80 && elapsedMin <= 120;', 'return elapsedMin >= 80;', 2, 2),
  M('incidents are not captured', "...['momentum', 'incidents'].map(", "...['momentum'].map(", 2, 2),
  M('a fourth request per match', "...['momentum', 'incidents'].map(", "...['momentum', 'incidents', 'momentum'].map(", 2, 2),
  M('the stats call is dropped', '_bsdCaptureStatsWithAvgPositions(bsdId, prefix, env, meta),\n        ]);\n        console.log(`[BSD-CLUB-ENDGAME]', 'Promise.resolve(),\n        ]);\n        console.log(`[BSD-CLUB-ENDGAME]'),
  M('the R2 directory is named by the league id', 'const prefix = `bsd/${slug}/${bsdId}`;', 'const prefix = `bsd/${game.league_id}/${bsdId}`;'),
  M('a live feed that does not answer 200 is read anyway', 'if (!liveResp.ok) return;\n        liveData = await liveResp.json();\n    } catch (e) {\n        console.error(\'[BSD-CLUB-ENDGAME]', "liveData = await liveResp.json();\n    } catch (e) {\n        console.error('[BSD-CLUB-ENDGAME]"),
  M('no token or no R2 is not a reason to return', 'async function runBSDClubLeagueEndgameCapture(env) {\n    if (!env?.FIELD_DATA || !env?.BSD_API_TOKEN) return;', 'async function runBSDClubLeagueEndgameCapture(env) {'),
  M('the match id is not part of the key', 'const bsdId  = String(game.id);\n        const slug   = BSD_LEAGUE_ID_TO_SLUG[game.league_id];', 'const bsdId  = String(game.league_id);\n        const slug   = BSD_LEAGUE_ID_TO_SLUG[game.league_id];'),
];

let bad = 0; const problems = [];
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-club-capture-')));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const MUT = path.join(TMP, 'index.mutant.js');
function runWith(text) {
  fs.writeFileSync(MUT, text);
  const r = spawnSync(process.execPath, [CHECK, '--source', MUT, '--fail-fast'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, timedOut: r.error !== undefined && r.error.code === 'ETIMEDOUT' };
}
const clean = runWith(src);
const m = /^ok (\d+) assertions/m.exec(clean.out);
if (clean.status !== 0 || m === null || Number(m[1]) < MIN_ASSERTIONS) { bad++; problems.push(`CONTROL unmodified copy did not pass with at least ${MIN_ASSERTIONS} assertions: ${clean.out.slice(0, 300)}`); }
const comment = runWith(`${src}\n// harmless\n`);
if (comment.status !== 0) { bad++; problems.push('CONTROL a comment-only change turned the check red'); }
let caught = 0;
for (const mu of MUTANTS) {
  const count = src.split(mu.anchor).length - 1;
  if (count !== mu.of) { console.error(`ANCHOR for "${mu.name}" occurs ${count} times, not the ${mu.of} declared`); process.exit(2); }
  let at = -1;
  for (let k = 0; k < mu.nth; k++) at = src.indexOf(mu.anchor, at + 1);
  const mutated = src.slice(0, at) + mu.replacement + src.slice(at + mu.anchor.length);
  if (mutated === src) { console.error(`mutant "${mu.name}" did not change the text`); process.exit(2); }
  const r = runWith(mutated);
  if (r.status !== 0 && !r.timedOut) { caught++; console.log(`CAUGHT   ${mu.name}`); }
  else { bad++; problems.push(`NOT CAUGHT ${mu.name}`); console.log(`NOT CAUGHT ${mu.name}`); }
}
console.log(`\n${caught} of ${MUTANTS.length} mutations caught; controls ${clean.status === 0 && comment.status === 0 ? 'ok' : 'FAILED'}; ${MIN_ASSERTIONS} assertions required of the clean copy`);
if (bad) { console.log(problems.join('\n')); process.exit(1); }
