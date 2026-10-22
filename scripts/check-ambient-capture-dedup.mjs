#!/usr/bin/env node
// AmbientDO buys one closing line per game, however often it is restarted.
// docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md.
//
// TASK 0 measured the defect live (outbox/ambient-capture-probe-20261022T002944Z.log):
//   - every scores:today write was refused: "Values cannot be larger than 131072
//     bytes. A value of size 131814 was provided.";
//   - every reading met a new instance (19 of 19), with _gameStarts empty;
//   - each instance restored the same frozen 661-entry snapshot.
// So a game that went live after the freeze was "newly live" on every poll, and
// every poll bought its closing line again at 3 credits.
//
// This runs the real AmbientDO class against a storage that enforces the same
// 131072-byte value limit, and replaces the instance after any refused write,
// as the runtime did. The clock is pinned and moved by the scenario, because the
// class reads the time for the scoreboard date, the in-season sports, and both
// keep windows. The scoreboards are served by sport and ignore the date, so a
// scenario says which games each board lists at each poll.
//
//   node scripts/check-ambient-capture-dedup.mjs            # self-test
//   node scripts/check-ambient-capture-dedup.mjs --mutate   # Rule 90

import { serialize } from 'node:v8';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src/ambient-do.js');
const MODULE = process.env.AMBIENT_MODULE || SRC;
const LIMIT = 131072;
const AT = Date.parse('2026-10-19T18:00:00Z');   // a Monday: EPL, Serie A and MLB in season
const MIN = 60_000, HOUR = 3_600_000;

const RealDate = Date;
let clock = AT;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}

function makeWorld() {
  const store = new Map();
  const world = { store, refused: 0, board: {}, failing: new Set(), captures: [], events: [],
    refuseKeys: new Set(), dead: false, failGet: 0, onCapture: null, clock: AT, unconfirmed: 0 };
  world.storage = {
    async get(k) {
      if (world.failGet > 0) { world.failGet--; throw new Error('storage read failed'); }
      if (Array.isArray(k)) return new Map(k.filter(x => store.has(x)).map(x => [x, structuredClone(store.get(x))]));
      return store.has(k) ? structuredClone(store.get(k)) : undefined;
    },
    put(k, v, opts) {
      // This fake applies a write at once, which is what the output gate makes
      // true of a confirmed write. A write that opts out is counted, so a
      // scenario can say the code never relies on one.
      if (opts?.allowUnconfirmed) world.unconfirmed++;
      const size = serialize(v).length;
      // A write the runtime refuses: over the value limit, injected for one key,
      // or any write once the object is being reset (a deploy mid-poll).
      if (size > LIMIT || world.refuseKeys.has(k) || world.dead) {
        world.refused++;
        return Promise.reject(new RangeError(size > LIMIT
          ? `Values cannot be larger than ${LIMIT} bytes. A value of size ${size} was provided.`
          : `write refused: ${k}`));
      }
      store.set(k, structuredClone(v));
      return Promise.resolve();
    },
    setAlarm() { return Promise.resolve(); },
  };
  return world;
}

async function load() {
  const m = await import(pathToFileURL(MODULE).href + `?v=${Math.random()}`);
  const C = m.AmbientDO;
  // The capture's own fetch and D1 writes are not under test; its CALLS are.
  C.prototype._captureClosingOdds = async function ({ gameId }) {
    this.__world.captures.push(gameId);
    if (this.__world.onCapture) this.__world.onCapture(gameId);
  };
  C.prototype._fetchLiveOdds = async function () {};
  C.prototype._broadcast = function (type, data) { this.__world.events.push(`${type}:${data?.gameId ?? ''}`); };
  return C;
}

function installFetch(world) {
  globalThis.fetch = async (url) => {
    const sport = new URL(url).searchParams.get('sport');
    const how = world.failing.has(sport) ? world.failMode || '502' : 'ok';
    if (how === '502') return new Response('upstream down', { status: 502 });
    if (how === 'throw') throw new TypeError('fetch failed');
    if (how === 'no-array') return new Response(JSON.stringify({ error: 'upstream' }), { status: 200 });
    // What the relay serves for an NHLE or NBA CDN failure (src/index.js): a 200
    // whose board is empty.
    if (how === 'soft-empty') return new Response(JSON.stringify({ sport, games: [], source: 'nhle-error' }), { status: 200 });
    return new Response(JSON.stringify({ games: world.board[sport] || [] }), { status: 200 });
  };
}

const game = (id, sport, state, home = `Home ${id}`, away = `Away ${id}`) =>
  ({ id, sport, state, home: { name: home, abbr: 'HOM', score: 0 }, away: { name: away, abbr: 'AWY', score: 0 }, periodNum: 1, periodLabel: '1st', clock: '10:00' });

// A frozen snapshot like the live one: entries of games long gone from every
// scoreboard, still reading 'live'.
function zombies(n, sport = 'mlb') {
  const out = {};
  for (let i = 0; i < n; i++) {
    out[`espn:4018${String(i).padStart(5, '0')}`] = { sport, home: `Zombie Home Team Number ${i}`, away: `Zombie Away Team Number ${i}`,
      homeScore: 3, awayScore: 2, homeAbbr: 'ZHT', awayAbbr: 'ZAT', bsdEventId: null, period: 4, periodLabel: 'Top 4th', clock: '', state: 'live' };
  }
  return out;
}

// Polls the class as the runtime would. Before each poll the clock moves `step`
// (default 30 s), then `each(p, world)` may set boards, failures, or the clock.
// A new instance starts the first poll of every run(), and after any poll in
// which a write was refused. The clock carries across run() calls.
async function run(C, world, polls, each, step = 30_000) {
  installFetch(world);
  const ctx = { storage: world.storage, id: 'test', waitUntil(p) { ctx.pending.push(p); }, pending: [] };
  let inst = null, resetNext = true;
  world.instances ??= 0;
  for (let p = 0; p < polls; p++) {
    world.clock += step;
    if (each) each(p, world);
    clock = world.clock;
    if (resetNext) {
      world.dead = false;
      inst = new C(ctx, {}); inst.__world = world; inst.env = { ODDS_API_KEY: 'k', RELAY_BASE: 'http://relay.test' };
      world.instances++;
    }
    const before = world.refused;
    await inst.alarm();
    await Promise.allSettled(ctx.pending.splice(0));
    resetNext = world.refused > before;          // a refused write resets the object
    world.inst = inst;
  }
  return world;
}

const count = (arr, x) => arr.filter(e => e === x).length;

async function selfTest() {
  globalThis.Date = PinnedDate;
  const C = await load();
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };

  // S1 — the measured defect. A frozen snapshot that is the largest that fits
  // (found by search, not guessed), five games going live after the freeze,
  // four polls. The per-game state kept beside the scores is seeded with
  // leftovers too.
  {
    const w = makeWorld();
    let lo = 1, hi = 2000;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (serialize(zombies(mid)).length <= LIMIT) lo = mid; else hi = mid - 1; }
    const frozen = zombies(lo);
    const [z0, z1, z2] = Object.keys(frozen);
    frozen['espn:760500'] = { ...frozen[z2], sport: 'wc26' };   // an off-season sport's leftover
    delete frozen[z2];
    const live = [1, 2, 3, 4, 5].map(i => game(`espn:74000${i}`, 'epl', 'live', `Live Home Team Number ${i}`, `Live Away Team Number ${i}`));
    const ids = live.map(g => g.id);
    w.store.set('scores:today', frozen);
    w.store.set('leaders:today', { [z0]: 'home', 'espn:orphan-leader': 'away' });
    w.store.set('finals:today', [z1, 'espn:orphan-final']);
    w.store.set('wp:today', { [z0]: { homeWP: 0.6 }, 'espn:orphan-wp': { homeWP: 0.5 }, [ids[0]]: { homeWP: 0.55 } });
    eq('S1 precondition: the frozen snapshot fits, and with today\'s games it would not',
      [serialize(frozen).length <= LIMIT, serialize({ ...frozen, ...zombies(5, 'epl') }).length > LIMIT], [true, true]);
    w.board.epl = live;
    await run(C, w, 4, (p, world) => { if (p === 1) world.inst._wpPeaks = { [z0]: 0.7, [ids[0]]: 0.6 }; });
    eq('S1: one closing line per game live across four polls', w.captures, ids);
    eq('S1: no write refused, so no restart', [w.refused, w.instances], [0, 1]);
    eq('S1: the stored scores hold today\'s board, not the frozen leftovers', Object.keys(w.store.get('scores:today') ?? {}).sort(), ids);
    eq('S1: leaders and finals keep only games still kept',
      [Object.keys(w.store.get('leaders:today') ?? {}).sort(), w.store.get('finals:today')], [ids, []]);
    eq('S1: live odds keep only games still kept', Object.keys(w.store.get('wp:today') ?? {}), [ids[0]]);
    eq('S1: odds peaks keep only games still kept', Object.keys(w.inst._wpPeaks), [ids[0]]);
  }

  // S2 — a restart mid-game that loses the game's scores entry: the write of
  // the scores is refused in the poll that bought the line, so the next
  // instance restores the game as 'pre'. Only the capture record can stop a
  // second purchase. (A plain restart restores the 'live' entry and cannot
  // tell the record's presence from its absence.)
  {
    const w = makeWorld();
    let restoredAs = null;
    await run(C, w, 3, (p, world) => {
      world.board.epl = [game('espn:740002', 'epl', p === 0 ? 'pre' : 'live')];
      if (p === 1) world.refuseKeys.add('scores:today'); else world.refuseKeys.clear();
      if (p === 2) restoredAs = world.store.get('scores:today')?.['espn:740002']?.state ?? null;
    });
    eq('S2 precondition: the poll that bought the line restarted the object, which restored the game as pre',
      [w.instances, restoredAs], [2, 'pre']);
    eq('S2: a restart that loses the scores entry does not buy the line again', w.captures, ['espn:740002']);
  }

  // S3 — the board drops a game for one poll, then shows it again: the entry is
  // kept, so nothing is bought or broadcast twice.
  {
    const w = makeWorld();
    await run(C, w, 5, (p, world) => { world.board.epl = p === 2 ? [] : [game('espn:740003', 'epl', 'live')]; });
    eq('S3: a game that blinks off the board is not bought twice', w.captures, ['espn:740003']);
    eq('S3: nor is its score broadcast again', count(w.events, 'score:espn:740003'), 1);
    const w2 = makeWorld();
    await run(C, w2, 5, (p, world) => { world.board.epl = p === 2 ? [] : [game('espn:740010', 'epl', 'final')]; });
    eq('S3: a final game that blinks is announced final once', count(w2.events, 'final:espn:740010'), 1);
    // Gone longer than the keep window: the entry is dropped, and only the
    // capture record stops a second purchase when the game returns.
    const w3 = makeWorld();
    let away = null;
    await run(C, w3, 9, (p, world) => {
      world.board.epl = p === 0 || p === 8 ? [game('espn:740007', 'epl', 'live')] : [];
      if (p === 8) away = 'espn:740007' in (world.store.get('scores:today') ?? {});
    }, HOUR);
    eq('S3 precondition: the entry was dropped while the game was away', away, false);
    eq('S3: a game gone seven hours comes back without a second purchase', w3.captures, ['espn:740007']);
  }

  // S4 — a sport's board is not read while its game is live, in each way that
  // happens: a non-2xx, a thrown fetch, a 200 without a games array, and the
  // relay's own 200 with an empty board on an upstream error. The entry stays,
  // nothing is bought or broadcast twice, and the game is still live after.
  for (const mode of ['502', 'throw', 'no-array', 'soft-empty']) {
    const w = makeWorld();
    w.failMode = mode;
    let during = null;
    await run(C, w, 4, (p, world) => {
      world.board.epl = [game('espn:740004', 'epl', 'live')];
      if (p === 1 || p === 2) world.failing.add('epl'); else world.failing.delete('epl');
      if (p === 3) during = world.store.get('scores:today')?.['espn:740004']?.state ?? null;
    });
    eq(`S4 (${mode}): kept and still live while unread, bought once, its score broadcast once`,
      [during, w.captures, count(w.events, 'score:espn:740004')], ['live', ['espn:740004'], 1]);
  }

  // S5 — the capture record forgets a game 24 hours after its capture: pinned
  // to the minute on both sides, with and without a capture in the same poll.
  for (const withCapture of [true, false]) {
    const w = makeWorld();
    w.clock = AT - 30_000;
    w.store.set('starts:today', { 'espn:old': AT - 24 * HOUR - MIN, 'espn:recent': AT - 24 * HOUR + MIN });
    w.board.epl = [game('espn:740006', 'epl', withCapture ? 'live' : 'pre')];
    await run(C, w, 1);
    eq(`S5 (${withCapture ? 'with' : 'without'} a capture): 24h + 1 min is dropped, 24h - 1 min is kept`,
      Object.keys(w.store.get('starts:today') ?? {}).sort(), withCapture ? ['espn:740006', 'espn:recent'] : ['espn:recent']);
  }

  // S6 — the object is reset in the middle of the capture loop (a deploy), so
  // nothing after the vendor call is written. The record must already be.
  // Two games go live in the same poll and the reset lands on the first
  // capture, so the record written before the loop must hold both.
  {
    const w = makeWorld();
    w.onCapture = () => { w.dead = true; w.onCapture = null; };
    await run(C, w, 3, (p, world) => {
      world.board.epl = ['espn:740008', 'espn:740018'].map(id => game(id, 'epl', p === 0 ? 'pre' : 'live'));
    });
    eq('S6 precondition: the reset happened', w.instances, 2);
    eq('S6: a reset during the capture loop does not buy either line again', w.captures, ['espn:740008', 'espn:740018']);
    eq('S6: no write opts out of the output gate that holds the vendor call', w.unconfirmed, 0);
  }

  // S7 — the keep window, pinned to the minute on both sides.
  {
    const w = makeWorld();
    await run(C, w, 1, (p, world) => { world.board.epl = [game('espn:740009', 'epl', 'live')]; });
    const t0 = w.clock;
    await run(C, w, 1, (p, world) => { world.board.epl = []; world.clock = t0 + 6 * HOUR - MIN; });
    const kept = 'espn:740009' in (w.store.get('scores:today') ?? {});
    await run(C, w, 1, (p, world) => { world.clock = t0 + 6 * HOUR + MIN; });
    const dropped = !('espn:740009' in (w.store.get('scores:today') ?? {}));
    eq('S7: an entry is kept 6h - 1 min after its last board, and dropped at 6h + 1 min', [kept, dropped], [true, true]);
    eq('S7: and its seen record goes with it', Object.keys(w.store.get('seen:today') ?? {}), []);
  }

  // S8 — the date turns mid-game. MLB's board stops listing a game still being
  // played; then an EPL game goes final. The MLB game must still count as live,
  // so all_final is not announced, including across a restart.
  {
    const w = makeWorld();
    w.clock = Date.parse('2026-10-19T23:50:00Z') - 30_000;
    await run(C, w, 1, (p, world) => {
      world.board.mlb = [game('espn:401900', 'mlb', 'live')];
      world.board.epl = [game('espn:740011', 'epl', 'live')];
    });
    await run(C, w, 1, (p, world) => { world.board.mlb = []; world.clock = Date.parse('2026-10-20T00:10:00Z'); });
    await run(C, w, 1, (p, world) => {          // a new instance: a restart after midnight
      world.board.epl = [game('espn:740011', 'epl', 'final')];
      world.clock = Date.parse('2026-10-20T03:30:00Z');
    });
    eq('S8: the EPL final announced, and no all_final while the MLB game is still live',
      [count(w.events, 'final:espn:740011'), count(w.events, 'all_final:')], [1, 0]);
  }

  // S9 — a final game stays on its board all day: the entry is refreshed by
  // every board that lists it, so it is announced final once.
  {
    const w = makeWorld();
    await run(C, w, 9, (p, world) => { world.board.epl = [game('espn:740012', 'epl', 'final')]; }, HOUR);
    eq('S9: a game on the board for nine hours is announced final once', count(w.events, 'final:espn:740012'), 1);
  }

  // S11 — a game leaves a board that still lists other games of its sport,
  // which is how the frozen entries piled up: freshness is per game.
  {
    const w = makeWorld();
    await run(C, w, 8, (p, world) => {
      world.board.mlb = p === 0 ? [game('espn:401901', 'mlb', 'live')] : [game('espn:401902', 'mlb', 'pre')];
    }, HOUR);
    eq('S11: the departed game is dropped, the listed one kept', Object.keys(w.store.get('scores:today') ?? {}), ['espn:401902']);
  }

  // S10 — the restore read fails once on a new instance. The next poll must
  // restore again instead of running on an empty capture record.
  {
    const w = makeWorld();
    await run(C, w, 2, (p, world) => { world.board.epl = [game('espn:740013', 'epl', p === 0 ? 'pre' : 'live')]; });
    w.failGet = 1;
    await run(C, w, 2);
    eq('S10: a failed restore read does not buy the line again', w.captures, ['espn:740013']);
  }

  globalThis.Date = RealDate;
  console.log(failed ? `\nSELF-TEST FAILED: ${failed}` : '\nself-test passed');
  return failed;
}

// Each mutation is one or more [from, to] edits. Every anchor must occur
// exactly once, or the mutation is not run and the gate fails.
const MUTATIONS = [
  ['no prune', [['this._pruneScores(now);', '']]],
  ['prune by absence from one poll', [['if (this._seenAt.get(id) >= cutoff) continue;', 'if (this._seenAt.get(id) === now) continue;']]],
  ['a missing seen record reads as fresh', [['if (this._seenAt.get(id) >= cutoff) continue;', 'if (!(this._seenAt.get(id) < cutoff)) continue;']]],
  ['seen only on first sight', [['this._seenAt.set(gameId, now);', 'if (!this._seenAt.has(gameId)) this._seenAt.set(gameId, now);']]],
  ['seen record never ages out', [['if (t < cutoff) this._seenAt.delete(id);', '']]],
  ['fresh by sport, not by game', [
    ['this._seenAt.set(gameId, now);', "this._seenAt.set(gameId, now); this._seenAt.set('sport:' + sport, now);"],
    ['if (this._seenAt.get(id) >= cutoff) continue;', "if (this._seenAt.get(id) >= cutoff || this._seenAt.get('sport:' + this._scores[id].sport) >= cutoff) continue;"]]],
  ['seen record not persisted', [["this.ctx.storage.put('seen:today',   Object.fromEntries(this._seenAt)),", '']]],
  ['seen record not restored', [["this._seenAt = new Map(Object.entries(stored.get('seen:today') ?? {}));", 'this._seenAt = new Map();']]],
  ['keep window 5h', [['const SCORES_KEEP_MS  = 6 * 3600_000;', 'const SCORES_KEEP_MS  = 5 * 3600_000;']]],
  ['keep window 7h', [['const SCORES_KEEP_MS  = 6 * 3600_000;', 'const SCORES_KEEP_MS  = 7 * 3600_000;']]],
  ['capture window 23h', [['const CAPTURE_KEEP_MS = 24 * 3600_000;', 'const CAPTURE_KEEP_MS = 23 * 3600_000;']]],
  ['capture window 25h', [['const CAPTURE_KEEP_MS = 24 * 3600_000;', 'const CAPTURE_KEEP_MS = 25 * 3600_000;']]],
  ['per-instance dedup (record neither persisted nor restored)', [
    ["            this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts))\n                .catch(", '            Promise.resolve()\n                .catch('],
    ["this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts)),", ''],
    ["this._gameStarts = new Map(Object.entries(stored.get('starts:today') ?? {}));", 'this._gameStarts = new Map();']]],
  ['captures not restored', [["this._gameStarts = new Map(Object.entries(stored.get('starts:today') ?? {}));", 'this._gameStarts = new Map();']]],
  ['record not written before the vendor call', [["            this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts))\n                .catch(", '            Promise.resolve()\n                .catch(']]],
  ['early record holds only the first game going live', [["            this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts))\n                .catch(",
    "            this.ctx.storage.put('starts:today', Object.fromEntries([...this._gameStarts].filter(([k]) => !pendingStarts.slice(1).some(s => s.gameId === k))))\n                .catch("]]],
  ['early record written outside the output gate', [["            this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts))\n                .catch(",
    "            this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts), { allowUnconfirmed: true })\n                .catch("]]],
  ['record not written at the end of the poll', [["this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts)),", '']]],
  ['capture record never ages out', [['if (t < captureCutoff) this._gameStarts.delete(id);', '']]],
  ['leaders and live odds kept after their game', [['for (const id of Object.keys(byGame)) if (!(id in this._scores)) delete byGame[id];', '']]],
  ['live odds kept after their game', [['for (const byGame of [this._leaders, this._wpState, this._wpPeaks]) {', 'for (const byGame of [this._leaders, this._wpPeaks]) {']]],
  ['odds peaks kept after their game', [['for (const byGame of [this._leaders, this._wpState, this._wpPeaks]) {', 'for (const byGame of [this._leaders, this._wpState]) {']]],
  ['finals kept after their game', [['for (const id of this._finals) if (!(id in this._scores)) this._finals.delete(id);', '']]],
  ['restore marked done before it succeeds', [
    ['        if (!this._restored) {\n            const stored', '        if (!this._restored) {\n            this._restored = true;\n            const stored'],
    ['            this._restored = true;\n            this._diag.restoredAt', '            this._diag.restoredAt']]],
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
    const mutant = path.join(path.dirname(SRC), '.mutant-ambient-do.js');
    writeFileSync(mutant, text);
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, AMBIENT_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (.*)$/gm) || []).map(l => l.slice(7));
      // Caught means the assertions ran and one failed. A mutant that does not
      // load, or dies before reporting, has proven nothing.
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
