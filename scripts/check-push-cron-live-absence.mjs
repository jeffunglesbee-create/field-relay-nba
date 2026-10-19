#!/usr/bin/env node
// The push cron's live-game half does not exist, and this keeps that a decision.
//
// docs/CC-CMD-2026-10-14-push-cron-gambit-path.md, option 1, ruled 2026-10-18.
// handleCron polled the /espn-gambit proxy for each sport's site-API
// scoreboard and pushed late, close games as SCORE_CHANGE. /espn-gambit
// allows only /apis/v1/challenges/, so every poll got a 403 and `continue`d,
// which looks exactly like "no live games", and the loop pushed nothing for a
// period nobody measured. It was deleted on 2026-10-19.
//
// The ruling asked for a STATED absence: a silent removal leaves the next
// session to read the gap as an oversight and put the loop back. Restoring a
// late-and-close push reopens ADR-002 Rule A (the relay serves on pull, never
// pushes a value-based alert unprompted). So this fails when:
//   1. any src file again names the gambit site-API scoreboard path;
//   2. any src file quotes 'SCORE_CHANGE' (the producer, in any spelling);
//   3. any src file's count of sendWebPush references leaves its pin: a new
//      push sender is a new unprompted push, and a deliberate pin change is
//      where its ADR-002 review gets asked for. This is what catches a loop
//      moved into a helper, whatever payload type it uses;
//   4. handleCron's code fetches a scoreboard, reads SPORT_CONFIG or sends a
//      push itself;
//   5. the stated-absence paragraph in handleCron is gone;
//   6. handleCron no longer runs the Tubi pre-game alerts, the half that stays.
//
//   node scripts/check-push-cron-live-absence.mjs [--self-test]
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Built from parts so this file does not contain the path it forbids.
const GAMBIT_SITE = ['espn-gambit', 'apis', 'site'].join('/');
const MARKER = 'THE LIVE-GAME HALF OF THIS HEARTBEAT DOES NOT EXIST';
const RULING = 'docs/CC-CMD-2026-10-14-push-cron-gambit-path.md';
const SCORE_CHANGE_QUOTED = /['"`]SCORE_CHANGE['"`]/;
// Code references to sendWebPush, per file, at 2026-10-19: the definition,
// handleGameFinalPush, handleTubiPreGameAlerts, and the two `_sendWebPush:`
// enrichments handed to GameDO. Every other file: 0.
const SEND_WEB_PUSH_PINS = { 'src/index.js': 5 };

// Whole-line `//` comments only, on purpose. A string-blind block-comment
// regex read the `/*` in `// Route: /espn-gambit/*` and in an Accept header's
// '*/*' as comment openers: on the first draft it hid 3,768 lines of
// src/index.js, sendWebPush's definition among them. This fails closed: a
// trailing comment naming a forbidden thing is a finding, never a hole. The
// stated-absence paragraph is whole-line comments.
const stripLineComments = (t) => t.replace(/^[ \t]*\/\/.*$/gm, '');

function handleCronBody(indexText) {
  const i = indexText.indexOf('async function handleCron(');
  if (i < 0) return null;
  const j = indexText.indexOf('\n}\n', i);
  return j < 0 ? null : indexText.slice(i, j + 2);
}

/** files: { path: text }. Returns the reasons it fails, [] when it holds. */
export function findings(files) {
  const out = [];
  for (const [p, text] of Object.entries(files)) {
    if (text.includes(GAMBIT_SITE)) out.push(`${p} names the gambit site-API path again — the poll ${RULING} deleted`);
    if (SCORE_CHANGE_QUOTED.test(text)) out.push(`${p} builds a SCORE_CHANGE payload (a quoted 'SCORE_CHANGE') — the live-game push producer is back`);
    const refs = (stripLineComments(text).match(/\bsendWebPush\b/g) || []).length;
    const pin = SEND_WEB_PUSH_PINS[p] || 0;
    if (refs !== pin) out.push(`${p} references sendWebPush ${refs} time(s), pinned at ${pin} — a new push sender needs the ADR-002 Rule A review before this pin moves`);
  }
  const index = files['src/index.js'];
  const body = index == null ? null : handleCronBody(index);
  if (body == null) {
    out.push('handleCron was not found in src/index.js — the absence it records cannot be checked');
    return out;
  }
  const code = stripLineComments(body);
  if (/scoreboard/i.test(code)) out.push('handleCron fetches a scoreboard — a live-game poll, repaired or not, needs the ADR-002 review the ruling declined');
  if (/\bSPORT_CONFIG\b/.test(code)) out.push('handleCron reads SPORT_CONFIG — the per-sport live-game loop is back');
  if (/\bsendWebPush\b/.test(code)) out.push('handleCron sends a push itself — the fan-out after the deleted loop is back');
  if (!body.includes(MARKER) || !body.includes(RULING)) out.push(`handleCron lost its stated-absence paragraph ("${MARKER}", citing ${RULING}) — a silent gap reads as an oversight`);
  if (!/\bawait\s+handleTubiPreGameAlerts\s*\(\s*env\s*\)/.test(code)) out.push('handleCron no longer runs handleTubiPreGameAlerts — the half of the heartbeat that stays was deleted too');
  return out;
}

// Recursive, so a file in a src/ subdirectory is read and counted.
function readSrc(dir = 'src') {
  const files = {};
  for (const name of readdirSync(dir, { recursive: true })) {
    if (!/\.m?js$/.test(name)) continue;
    files[join(dir, name)] = readFileSync(join(dir, name), 'utf8');
  }
  return files;
}

if (process.argv.includes('--self-test')) {
  let ran = 0, fail = 0;
  const ok = (name, cond, detail = '') => {
    ran++; if (!cond) { fail++; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`); }
    else console.log(`  ok    ${name}`);
  };
  const live = readSrc();
  ok('no findings against the live source', findings(live).length === 0, JSON.stringify(findings(live)));

  // Each edit's anchor must match exactly once, or the case reports NOTHING
  // MUTATED instead of a verdict.
  const MM = (path, ...edits) => {
    let t = live[path];
    for (const [from, to] of edits) {
      const hits = t.split(from).length - 1;
      if (hits !== 1) return [`MUTATION ANCHOR matched ${hits} times in ${path} — NOTHING MUTATED`];
      t = t.replace(from, to);
    }
    return findings({ ...live, [path]: t });
  };
  const caught = (name, f, ...want) => ok(name, want.every((w) => f.some((x) => x.includes(w))), JSON.stringify(f));
  const TUBI = '    await handleTubiPreGameAlerts(env);\n';
  const CRON = 'async function handleCron(env) {\n';
  const poll = '    const r = await fetch(`${RELAY}/' + GAMBIT_SITE + '/v2/sports/${cfg.path}/scoreboard`);\n';
  const helper = 'async function pushLateCloseGames(env, sub) {\n'
    + '    const r = await fetch(`${ESPN_API_BASE}/v2/games`);\n'
    + "    await sendWebPush(sub, { type: 'CRUNCH_TIME_SIGNAL' }, env);\n}\n\n";

  console.log('\nMUTATIONS — each must be CAUGHT:');
  caught('G1 the gambit poll put back in handleCron', MM('src/index.js', [TUBI, TUBI + poll]), 'gambit site-API path');
  caught('G2 repaired against the site API instead (a scoreboard fetch)', MM('src/index.js', [TUBI, TUBI + '    const r = await fetch(`${ESPN_API_BASE}/sports/basketball/nba/scoreboard`);\n']), 'fetches a scoreboard');
  caught('G3 the per-sport loop put back', MM('src/index.js', [TUBI, TUBI + '    for (const cfg of SPORT_CONFIG) {}\n']), 'reads SPORT_CONFIG');
  caught('G4 the fan-out put back', MM('src/index.js', [TUBI, TUBI + '    await sendWebPush(sub, game, env);\n']), 'sends a push itself', 'pinned at 5');
  caught('G5 the stated-absence paragraph removed', MM('src/index.js', [MARKER, 'THE LIVE-GAME HALF']), 'stated-absence paragraph');
  caught('G6 the Tubi alerts deleted with it', MM('src/index.js', [TUBI, '']), 'handleTubiPreGameAlerts');
  caught('G7 a SCORE_CHANGE producer in another file', findings({ ...live, 'src/x.js': "const p = { type: 'SCORE_CHANGE', gameId };" }), 'builds a SCORE_CHANGE payload');
  caught('G8 a quoted key', findings({ ...live, 'src/x.js': 'const p = { "type": "SCORE_CHANGE" };' }), 'builds a SCORE_CHANGE payload');
  caught('G9 a constant', findings({ ...live, 'src/x.js': "const T = 'SCORE_CHANGE'; const p = { type: T };" }), 'builds a SCORE_CHANGE payload');
  caught('G10 an enum member', findings({ ...live, 'src/x.js': "const K = { SCORE_CHANGE: 'SCORE_CHANGE' }; const p = { type: K.SCORE_CHANGE };" }), 'builds a SCORE_CHANGE payload');
  caught('H1 the loop moved into a helper called from handleCron, under another type', MM('src/index.js', [CRON, helper + CRON], [TUBI, TUBI + '    await pushLateCloseGames(env);\n']), 'pinned at 5');
  caught('H2 the same helper called from the scheduled handler, handleCron untouched', MM('src/index.js', [CRON, helper + CRON], ['        ctx.waitUntil(handleCron(env));\n', '        ctx.waitUntil(handleCron(env));\n        ctx.waitUntil(pushLateCloseGames(env));\n']), 'pinned at 5');
  caught('H3 a push sender in a new file', findings({ ...live, 'src/live-push.js': 'export async function f(sub, env) { await sendWebPush(sub, {}, env); }' }), 'src/live-push.js references sendWebPush 1 time(s), pinned at 0');
  caught("S1 a scoreboard fetch and a push hidden between an Accept '*/*' and a block comment",
    MM('src/index.js', [TUBI, TUBI + "    const h = { Accept: '*/*' };\n    const r = await fetch(`${ESPN_API_BASE}/sports/basketball/nba/scoreboard`, { headers: h });\n    await sendWebPush(sub, { type: 'SCORE_CHANGE' }, env); /* end */\n"]),
    'fetches a scoreboard', 'sends a push itself', 'builds a SCORE_CHANGE payload');
  caught("S2 a producer after a '//' inside a string on the same line", findings({ ...live, 'src/x.js': "const p = { href: '//field.app/g', type: 'SCORE_CHANGE' };" }), 'builds a SCORE_CHANGE payload');

  // The walker itself (Rule 90): a producer in a subdirectory is read.
  const tmp = mkdtempSync(join(tmpdir(), 'push-absence-'));
  try {
    mkdirSync(join(tmp, 'push'));
    writeFileSync(join(tmp, 'push', 'live.js'), "export const p = { type: 'SCORE_CHANGE' };\n");
    const walked = readSrc(tmp);
    caught('W1 a producer in a src subdirectory is read and caught', findings({ ...live, ...walked }), 'live.js builds a SCORE_CHANGE payload');
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  console.log('\nEQUIVALENTS — each must stay GREEN:');
  ok('E1 "scoreboard" and SPORT_CONFIG named only in a whole-line comment', findings({ ...live, 'src/index.js': live['src/index.js'].replace(TUBI, TUBI + '    // a scoreboard poll over SPORT_CONFIG used to live here\n') }).length === 0);
  ok('E2 SCORE_CHANGE named in prose, unquoted', findings({ ...live, 'src/x.js': '// sw.js still handles SCORE_CHANGE\nconst kind = 1; // SCORE_CHANGE is retired\n' }).length === 0);

  console.log(`\n${ran - fail} of ${ran} passed.`);
  process.exit(fail ? 1 : 0);
}

const files = readSrc();
const out = findings(files);
const n = Object.keys(files).length;
const COVERAGE = `${n} src files for the path, the producer and the push-sender pin; handleCron for 5 properties`;
if (out.length) {
  for (const f of out) console.log(`FAIL  ${f}`);
  console.log(`\nchecked ${COVERAGE}: ${out.length} finding(s)`);
  process.exit(1);
}
console.log(`PASS — the push cron's live-game half is absent, and says so. Checked ${COVERAGE}.`);
