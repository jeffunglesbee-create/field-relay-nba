#!/usr/bin/env node
// Task 4 of docs/CC-CMD-2026-10-15-build-bdb-frames.md, against the DEPLOYED
// route: /nflverse/bdb_event_frames.json.
//
// Every assertion names its artifact (Rule 89) and has been made to fail on
// purpose (Rule 90; `--self-test` runs each against a payload broken for it):
//
//   1. the envelope carries season, sourceDataset, week, events and a non-empty
//      data array, and does not carry targetYear;
//   2. the served response is under the 2,000,000-byte ceiling, counted on the
//      bytes received, and came from R2 (X-Source: r2), not the raw fallback;
//   3. one named play, chosen because its source playDirection was 'left' (the
//      play where the offense-right frame and the raw frame differ), resolves
//      22 players at the snap, splits them 11 offense / 11 defense, and puts the
//      offense behind the defense in x, as the envelope's convention declares;
//   4. pass_forward frames exist for a majority of the plays the artifact
//      carries a snap for, and the figure is printed, not just asserted.
//
// Coverage (Rule 91) is printed with the result: the artifact holds 7 of week
// 2's 16 games, and check 3 reads one play.

import { writeFileSync, mkdirSync } from 'node:fs';

const URL_ = 'https://field-relay-nba.jeffunglesbee.workers.dev/nflverse/bdb_event_frames.json';
const CEILING = 2_000_000;
// The play the builder's convention check names as its worked example
// (jubilant-bassoon outbox/bdb-event-frames-build-latest.json, run 38945906448):
// source playDirection 'left', so raw x and offense-right x disagree on it.
const EXAMPLE = { gameId: 2022091500, playId: 1191 };

export function verify(body, headers) {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: Boolean(pass), detail });
  let env = null;
  try {
    env = JSON.parse(body);
  } catch (e) {
    check('the body is JSON', false, `${e.name}: ${String(e.message).slice(0, 120)}`);
    return results;
  }
  check('the body is JSON', true, `${body.length} bytes`);
  const data = Array.isArray(env.data) ? env.data : [];
  check('envelope: season, sourceDataset, week, events, non-empty data',
    Number.isInteger(env.season) && typeof env.sourceDataset === 'string' && env.sourceDataset.length > 0
      && Number.isInteger(env.week) && Array.isArray(env.events)
      && env.events.includes('ball_snap') && env.events.includes('pass_forward') && data.length > 0,
    `season=${env.season} week=${env.week} events=${JSON.stringify(env.events)} data=${data.length} source=${env.sourceDataset}`);
  check('envelope: no targetYear', !('targetYear' in env), `keys=${Object.keys(env).join(',')}`);
  check('envelope: the coordinate convention is declared as data',
    env.coordinateConvention && env.coordinateConvention.frame === 'offense-right' && env.coordinateConvention.units === 'yards',
    JSON.stringify(env.coordinateConvention || null).slice(0, 160));

  const bytes = Buffer.byteLength(body, 'utf8');
  check(`served bytes under the ceiling (${CEILING})`, bytes <= CEILING, `${bytes} bytes received`);
  const source = headers['x-source'] || null;
  check('served from R2, not the raw-GitHub fallback', source === 'r2', `X-Source=${source}`);

  const snap = data.find(d => d.gameId === EXAMPLE.gameId && d.playId === EXAMPLE.playId && d.event === 'ball_snap');
  const players = snap && Array.isArray(snap.players) ? snap.players : [];
  const off = players.filter(p => p.side === 'offense');
  const def = players.filter(p => p.side === 'defense');
  const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  check(`play ${EXAMPLE.gameId}/${EXAMPLE.playId}: 22 players at the snap, each with nflId, team and pos`,
    players.length === 22 && players.every(p => Number.isInteger(p.nflId) && p.team && p.pos),
    `${players.length} players`);
  check(`play ${EXAMPLE.gameId}/${EXAMPLE.playId}: 11 offense and 11 defense`,
    off.length === 11 && def.length === 11, `offense ${off.length}, defense ${def.length}`);
  check(`play ${EXAMPLE.gameId}/${EXAMPLE.playId} (source direction left): offense behind defense in the declared frame`,
    off.length > 0 && def.length > 0 && mean(off.map(p => p.x)) < mean(def.map(p => p.x)),
    `mean x offense ${mean(off.map(p => p.x)).toFixed(2)}, defense ${mean(def.map(p => p.x)).toFixed(2)}`);

  const key = d => `${d.gameId}/${d.playId}`;
  const snapPlays = new Set(data.filter(d => d.event === 'ball_snap').map(key));
  const pfPlays = new Set(data.filter(d => d.event === 'pass_forward').map(key));
  const both = [...snapPlays].filter(k => pfPlays.has(k)).length;
  check('pass_forward on a majority of the plays carrying a snap',
    snapPlays.size > 0 && both / snapPlays.size > 0.5,
    `${both} of ${snapPlays.size} (${snapPlays.size ? (100 * both / snapPlays.size).toFixed(1) : 'n/a'}%)`);
  return results;
}

function selfTest() {
  const players = (n, side, x) => Array.from({ length: n }, (_, i) => ({ nflId: 100 + i + (side === 'offense' ? 0 : 50), team: side === 'offense' ? 'A' : 'B', pos: 'WR', side, x, y: 10 }));
  const good = {
    updated: 't', season: 2022, sourceDataset: 'kaggle x/y', week: 2, metric: 'event_frames',
    events: ['ball_snap', 'pass_forward'], coordinateConvention: { frame: 'offense-right', units: 'yards' },
    data: [
      { gameId: EXAMPLE.gameId, playId: EXAMPLE.playId, event: 'ball_snap', players: [...players(11, 'offense', 40), ...players(11, 'defense', 47)] },
      { gameId: EXAMPLE.gameId, playId: EXAMPLE.playId, event: 'pass_forward', players: players(2, 'offense', 35) },
    ],
  };
  const H = { 'x-source': 'r2' };
  const failing = (body, headers = H) => verify(body, headers).filter(r => !r.pass).map(r => r.name);
  const cases = [
    ['the good payload passes every check', failing(JSON.stringify(good)).length === 0],
    ['a body that is not JSON fails', failing('<html>').includes('the body is JSON')],
    ['a missing season fails', failing(JSON.stringify({ ...good, season: undefined })).some(n => n.startsWith('envelope: season'))],
    ['empty data fails', failing(JSON.stringify({ ...good, data: [] })).some(n => n.startsWith('envelope: season'))],
    ['a targetYear fails', failing(JSON.stringify({ ...good, targetYear: 2026 })).includes('envelope: no targetYear')],
    ['an undeclared convention fails', failing(JSON.stringify({ ...good, coordinateConvention: undefined })).some(n => n.includes('convention'))],
    ['a body over the ceiling fails', failing(JSON.stringify({ ...good, pad: 'x'.repeat(CEILING) })).some(n => n.startsWith('served bytes'))],
    ['the raw fallback fails', failing(JSON.stringify(good), { 'x-source': null }).includes('served from R2, not the raw-GitHub fallback')],
    ['a play with 21 players fails', failing(JSON.stringify({ ...good, data: [{ ...good.data[0], players: good.data[0].players.slice(1) }, good.data[1]] })).some(n => n.includes('22 players'))],
    ['a 12/10 split fails', failing(JSON.stringify({ ...good, data: [{ ...good.data[0], players: good.data[0].players.map((p, i) => i === 11 ? { ...p, side: 'offense' } : p) }, good.data[1]] })).some(n => n.includes('11 offense'))],
    ['an offense ahead of the defense fails', failing(JSON.stringify({ ...good, data: [{ ...good.data[0], players: good.data[0].players.map(p => ({ ...p, x: p.side === 'offense' ? 60 : 40 })) }, good.data[1]] })).some(n => n.includes('offense behind defense'))],
    ['no pass_forward fails the majority check', failing(JSON.stringify({ ...good, data: [good.data[0]] })).includes('pass_forward on a majority of the plays carrying a snap')],
  ];
  let bad = 0;
  for (const [name, ok] of cases) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) bad++;
  }
  console.log(`\n${cases.length - bad}/${cases.length} self-test checks held`);
  process.exitCode = bad ? 1 : 0;
}

async function live() {
  const res = await fetch(URL_, { headers: { 'User-Agent': 'FIELD-verify/1.0' } });
  const body = await res.text();
  const headers = { 'x-source': res.headers.get('x-source') };
  const results = [{ name: 'HTTP 200', pass: res.status === 200, detail: `HTTP ${res.status}` }, ...verify(body, headers)];
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  — ${r.detail}`);
  const held = results.filter(r => r.pass).length;
  const coverage = 'the artifact holds 7 of 16 week-2 games (scope in the envelope); check 3 reads one play';
  console.log(`\n${held}/${results.length} checks held. Coverage: ${coverage}.`);
  mkdirSync('outbox', { recursive: true });
  writeFileSync('outbox/verify-bdb-event-frames-latest.json', JSON.stringify({
    route: URL_, ran_at: new Date().toISOString(), status: res.status, headers, coverage,
    held, of: results.length, results }, null, 2) + '\n');
  process.exitCode = held === results.length ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.includes('--self-test')) selfTest();
  else await live();
}
