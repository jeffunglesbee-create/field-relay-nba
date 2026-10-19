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
//   2. handleCron's CODE (comments stripped) fetches a scoreboard, reads
//      SPORT_CONFIG, sends a push itself, or builds SCORE_CHANGE;
//   3. any src file builds a `type: 'SCORE_CHANGE'` payload, the producer;
//   4. the stated-absence paragraph in handleCron is gone;
//   5. handleCron no longer runs the Tubi pre-game alerts, the half that stays.
//
//   node scripts/check-push-cron-live-absence.mjs [--self-test]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Built from parts so this file does not contain the path it forbids.
const GAMBIT_SITE = ['espn-gambit', 'apis', 'site'].join('/');
const MARKER = 'THE LIVE-GAME HALF OF THIS HEARTBEAT DOES NOT EXIST';
const RULING = 'docs/CC-CMD-2026-10-14-push-cron-gambit-path.md';
const SCORE_CHANGE_PAYLOAD = /type\s*:\s*['"`]SCORE_CHANGE['"`]/;

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

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
    if (SCORE_CHANGE_PAYLOAD.test(stripComments(text))) out.push(`${p} builds a SCORE_CHANGE payload — the live-game push producer is back`);
  }
  const index = files['src/index.js'];
  const body = index == null ? null : handleCronBody(index);
  if (body == null) {
    out.push('handleCron was not found in src/index.js — the absence it records cannot be checked');
    return out;
  }
  const code = stripComments(body);
  if (/scoreboard/i.test(code)) out.push('handleCron fetches a scoreboard — a live-game poll, repaired or not, needs the ADR-002 review the ruling declined');
  if (/\bSPORT_CONFIG\b/.test(code)) out.push('handleCron reads SPORT_CONFIG — the per-sport live-game loop is back');
  if (/\bsendWebPush\s*\(/.test(code)) out.push('handleCron sends a push itself — the fan-out after the deleted loop is back');
  if (!body.includes(MARKER) || !body.includes(RULING)) out.push(`handleCron lost its stated-absence paragraph ("${MARKER}", citing ${RULING}) — a silent gap reads as an oversight`);
  if (!/\bawait\s+handleTubiPreGameAlerts\s*\(\s*env\s*\)/.test(code)) out.push('handleCron no longer runs handleTubiPreGameAlerts — the half of the heartbeat that stays was deleted too');
  return out;
}

function readSrc(dir = 'src') {
  const files = {};
  for (const name of readdirSync(dir)) {
    if (!/\.(m?js)$/.test(name)) continue;
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

  // Each mutation edits the live text at an anchor that must match exactly once.
  const M = (path, from, to) => {
    const t = live[path];
    const hits = t.split(from).length - 1;
    if (hits !== 1) return [`MUTATION ANCHOR matched ${hits} times in ${path} — NOTHING MUTATED`];
    return findings({ ...live, [path]: t.replace(from, to) });
  };
  const has = (f, s) => f.some((x) => x.includes(s));
  const TUBI = '    await handleTubiPreGameAlerts(env);\n';
  const poll = '    const r = await fetch(`${RELAY}/' + GAMBIT_SITE + '/v2/sports/${cfg.path}/scoreboard`);\n';

  console.log('\nMUTATIONS — each must be CAUGHT:');
  ok('G1 the gambit poll put back in handleCron', has(M('src/index.js', TUBI, TUBI + poll), 'gambit site-API path'));
  ok('G2 repaired against the site API instead (a scoreboard fetch)', has(M('src/index.js', TUBI, TUBI + '    const r = await fetch(`${ESPN_API_BASE}/sports/basketball/nba/scoreboard`);\n'), 'fetches a scoreboard'));
  ok('G3 the per-sport loop put back', has(M('src/index.js', TUBI, TUBI + '    for (const cfg of SPORT_CONFIG) {}\n'), 'reads SPORT_CONFIG'));
  ok('G4 the fan-out put back', has(M('src/index.js', TUBI, TUBI + '    await sendWebPush(sub, game, env);\n'), 'sends a push itself'));
  ok('G5 the stated-absence paragraph removed', has(M('src/index.js', MARKER, 'THE LIVE-GAME HALF'), 'stated-absence paragraph'));
  ok('G6 the Tubi alerts deleted with it', has(M('src/index.js', TUBI, ''), 'handleTubiPreGameAlerts'));
  ok('G7 a SCORE_CHANGE producer in another file', has(findings({ ...live, 'src/x.js': "const p = { type: 'SCORE_CHANGE', gameId };" }), 'builds a SCORE_CHANGE payload'));

  console.log('\nEQUIVALENTS — each must stay GREEN:');
  ok('E1 "scoreboard" and SPORT_CONFIG named only in a comment', findings({ ...live, 'src/index.js': live['src/index.js'].replace(TUBI, TUBI + '    // a scoreboard poll over SPORT_CONFIG used to live here\n') }).length === 0);
  ok('E2 SCORE_CHANGE named in prose, not built', findings({ ...live, 'src/x.js': '// sw.js still handles SCORE_CHANGE\nconst kind = "SCORE_CHANGE is retired";' }).length === 0);

  console.log(`\n${ran - fail} of ${ran} passed.`);
  process.exit(fail ? 1 : 0);
}

const files = readSrc();
const out = findings(files);
const n = Object.keys(files).length;
if (out.length) {
  for (const f of out) console.log(`FAIL  ${f}`);
  console.log(`\nchecked ${n} src files for the path and the producer, and handleCron for 5 properties: ${out.length} finding(s)`);
  process.exit(1);
}
console.log(`PASS — the push cron's live-game half is absent, and says so. Checked ${n} src files for the path and the producer, and handleCron for 5 properties.`);
