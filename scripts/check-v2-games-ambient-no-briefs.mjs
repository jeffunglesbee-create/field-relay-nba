#!/usr/bin/env node
// AmbientDO's poll does not start the NHL brief pipeline in /v2/games.
// docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md, review finding G4.
//
// WHY. handleV2Games enqueues an LLM `game-brief` for every final on the NHLE
// board whose `brief:game:<id>` KV key is missing, and the queue
// consumer writes that key with a one-hour TTL. AmbientDO polls /v2/games every
// 15-60 s around the clock, and once it reads the ET slate it keeps an evening's
// finals on its board until 4am ET. Measured by the review on 10-14..20: about
// 307 NHL generations a week where 48 were needed. Viewers' requests still
// enqueue; only the request carrying AmbientDO's header is excluded.
//
// This runs the REAL worker (src/index.js default export) on a GET /v2/games,
// and the REAL AmbientDO._fetchSport, against stubbed upstreams and a recording
// queue. src/index.js imports @cloudflare/puppeteer, which this repo's CI does
// not install, so a resolve hook stubs that one package.
//
// Coverage, printed with the result (Rule 91): the one brief enqueue site left
// inside handleV2Games (NHLE). The NBA CDN board had the other; it was removed
// on 2026-10-24 when NBA moved to ESPN, whose branch enqueues no brief
// (docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md). The WC result path
// (writeWCResult) also enqueues from /v2/games, for wc26 only, which AmbientDO
// polls in June-July of a World Cup year; it is not checked here.
//
//   node scripts/check-v2-games-ambient-no-briefs.mjs            # self-test
//   node scripts/check-v2-games-ambient-no-briefs.mjs --mutate   # Rule 90

import { register } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { if (s === '@cloudflare/puppeteer') return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return next(s, c); }"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(HERE, '../src/index.js');
const AMBIENT = path.resolve(HERE, '../src/ambient-do.js');
const INDEX_MODULE = process.env.INDEX_MODULE || INDEX;
const AMBIENT_MODULE = process.env.AMBIENT_MODULE || AMBIENT;
const HEADER = 'X-Ambient-Internal';

// One final on the board. Field names are the ones adaptNhle reads: NHLE
// gameState 'OFF' is final.
const BOARDS = {
  nhl: { gamesByDate: [{ date: '2026-10-22', games: [{ id: 2026020141, gameState: 'OFF', startTimeUTC: '2026-10-22T23:00:00Z',
    homeTeam: { name: { default: 'Bruins' }, placeName: { default: 'Boston' }, abbrev: 'BOS', score: 3 },
    awayTeam: { name: { default: 'Rangers' }, placeName: { default: 'New York' }, abbrev: 'NYR', score: 2 } }] }] },
};

function stubUpstreams(seen) {
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    seen?.push({ url, headers: new Headers(init?.headers ?? input?.headers ?? {}) });
    if (url.includes('/v1/scoreboard/now')) return Response.json(BOARDS.nhl);
    if (url.includes('/landing')) return Response.json({ summary: { threeStars: [] } });
    if (url.includes('boxscore')) return Response.json({ game: {} });
    return new Response('{}', { status: 404 });
  };
}

async function selfTest() {
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };

  stubUpstreams();
  const worker = (await import(pathToFileURL(INDEX_MODULE).href)).default;
  const briefsFor = async (sport, headers) => {
    const sent = [];
    const env = {
      JOURNALISM_QUEUE: { send: async m => { if (m.type === 'game-brief') sent.push(m.eventId); } },
      FIELD_JOURNALISM: { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }) },
    };
    const pending = [];
    const ctx = { waitUntil: p => pending.push(p), passThroughOnException() {} };
    const r = await worker.fetch(new Request(`http://relay.test/v2/games?sport=${sport}&date=2026-10-22`, { headers }), env, ctx);
    await Promise.allSettled(pending);
    const body = await r.json();
    return { finals: (body?.games ?? []).filter(g => g.state === 'final').map(g => g.id), sent };
  };

  // V1/V3 are the controls: without them, "no brief enqueued" could mean the
  // board did not parse or the pipeline is unreachable from this harness.
  for (const [sport, id] of [['nhl', 'nhl:2026020141']]) {
    const viewer = await briefsFor(sport, {});
    eq(`${sport}: a viewer's request reads the final and enqueues its brief`, [viewer.finals, viewer.sent], [[id], [id]]);
    const poll = await briefsFor(sport, { [HEADER]: '1' });
    eq(`${sport}: AmbientDO's poll reads the same final and enqueues nothing`, [poll.finals, poll.sent], [[id], []]);
    const other = await briefsFor(sport, { [HEADER]: '0' });
    eq(`${sport}: only the value AmbientDO sends opts out`, other.sent, [id]);
  }

  // The header the handler reads is the one the poll sends.
  const seen = [];
  stubUpstreams(seen);
  const { AmbientDO } = await import(pathToFileURL(AMBIENT_MODULE).href);
  const inst = Object.create(AmbientDO.prototype);
  inst.env = { RELAY_BASE: 'http://relay.test' };
  await inst._fetchSport('nhl', '2026-10-22');
  const call = seen.find(c => c.url.startsWith('http://relay.test/v2/games'));
  eq(`AmbientDO._fetchSport sends ${HEADER}: 1 on its /v2/games call`, call?.headers.get(HEADER) ?? null, '1');

  console.log(`\nchecked 1 of 1 brief enqueue sites in handleV2Games (NHLE); the wc26 result path is not checked`);
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : 'self-test passed');
  return failed;
}

// [name, file, [[from, to], ...]]. Every anchor must occur exactly once, or the
// mutation is not run and the gate fails (Rule 90's corollary).
const MUTATIONS = [
  ['the NHL pipeline ignores the poll', INDEX, [[
    "            if (env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM && !ambientPoll) {\n                const nhlFinals",
    "            if (env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {\n                const nhlFinals"]]],
  ['the handler reads a header the poll does not send', INDEX, [[
    "const ambientPoll = request?.headers.get('X-Ambient-Internal') === '1';",
    "const ambientPoll = request?.headers.get('X-Ambient-Poll') === '1';"]]],
  ['any value of the header opts out', INDEX, [[
    "const ambientPoll = request?.headers.get('X-Ambient-Internal') === '1';",
    "const ambientPoll = request?.headers.has('X-Ambient-Internal');"]]],
  ['every request opts out', INDEX, [[
    "const ambientPoll = request?.headers.get('X-Ambient-Internal') === '1';",
    "const ambientPoll = true;"]]],
  ['the poll stops sending the header', AMBIENT, [[
    "{ headers: { 'X-Ambient-Internal': '1' }, cf: { cacheTtl: 25 } }",
    "{ cf: { cacheTtl: 25 } }"]]],
];

function mutate() {
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout + base.stderr); return 1; }
  let bad = 0;
  for (const [name, file, edits] of MUTATIONS) {
    let text = readFileSync(file, 'utf8'), why = null;
    for (const [from, to] of edits) {
      const at = text.indexOf(from);
      if (at < 0 || text.indexOf(from, at + 1) >= 0) { why = at < 0 ? 'missing' : 'not unique'; break; }
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
    if (why) { console.log(`  ANCHOR     ${name} (${why}): not run`); bad++; continue; }
    const mutant = path.join(path.dirname(file), `.mutant-${process.pid}-no-briefs-${path.basename(file)}`);
    writeFileSync(mutant, text);
    try {
      const envVar = file === INDEX ? 'INDEX_MODULE' : 'AMBIENT_MODULE';
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, [envVar]: mutant } });
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
