#!/usr/bin/env node
// AmbientDO buys one closing line per game, before kickoff, however often it is
// restarted. docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md and
// docs/CC-CMD-2026-10-22-closing-capture-before-kickoff.md.
//
// TASK 0 of the first measured the defect live (outbox/ambient-capture-probe-
// 20261022T002944Z.log): every scores:today write was refused ("A value of size
// 131814 was provided"), every reading met a new instance, and each instance
// restored the same frozen 661-entry snapshot with the capture record empty, so
// a game went "newly live" on every poll and its line was bought every poll.
// The second moved the purchase before kickoff, once per sport per poll, and
// only for games whose archive row still needs a line.
//
// This runs the real AmbientDO class against a storage that enforces the same
// 131072-byte value limit, and replaces the instance after any refused write.
// The clock is pinned and moved by the scenario. The scoreboards are served by
// sport and ignore the date, except in scenarios that set boardByDate, where
// they are keyed by the date asked for, as the relay's are. The archive lookup
// and the purchase are stubbed:
// which games are bought, and how many calls, is what is under test here.
// scripts/check-ambient-capture-write.mjs runs the real lookup and purchase.
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
const LEAGUE = { epl: 'EPL', seriea: 'Serie A', mlb: 'MLB', nfl: 'NFL' };

const RealDate = Date;
let clock = AT;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}

function makeWorld() {
  const store = new Map();
  const world = { store, refused: 0, board: {}, failing: new Set(), captures: [], calls: [], events: [],
    refuseKeys: new Set(), dead: false, failGet: 0, onCapture: null, clock: AT, noRow: new Set(), unconfirmed: 0 };
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
  // Every due game has a row needing a line unless the scenario says not.
  C.prototype._closingRowsFor = async function (starts) {
    return starts.filter(s => !this.__world.noRow.has(s.gameId)).map(s => ({ ...s, row: { id: `row:${s.gameId}` } }));
  };
  // The purchase's own fetch and D1 writes are not under test; its CALLS are.
  C.prototype._captureClosingOdds = async function (sport, due) {
    this.__world.calls.push(sport);
    for (const d of due) this.__world.captures.push(d.gameId);
    if (this.__world.onCapture) this.__world.onCapture(sport);
  };
  C.prototype._fetchLiveOdds = async function () {};
  C.prototype._broadcast = function (type, data) { this.__world.events.push(`${type}:${data?.gameId ?? ''}`); };
  return C;
}

function installFetch(world) {
  globalThis.fetch = async (url) => {
    const q = new URL(url).searchParams, sport = q.get('sport'), date = q.get('date');
    world.asked?.push(`${sport}@${date}`);
    const how = world.failing.has(sport) ? world.failMode || '502' : 'ok';
    if (how === '502') return new Response('upstream down', { status: 502 });
    if (how === 'throw') throw new TypeError('fetch failed');
    if (how === 'no-array') return new Response(JSON.stringify({ error: 'upstream' }), { status: 200 });
    // What the relay serves for an NHLE or NBA CDN failure (src/index.js): a 200
    // whose board is empty.
    if (how === 'soft-empty') return new Response(JSON.stringify({ sport, games: [], source: 'nhle-error' }), { status: 200 });
    const games = world.boardByDate ? world.boardByDate[`${sport}@${date}`] : world.board[sport];
    return new Response(JSON.stringify({ games: games || [] }), { status: 200 });
  };
}

// `start` is an absolute instant; a game with none kicks off far in the future.
const game = (id, sport, state, home = `Home ${id}`, away = `Away ${id}`, start = '2027-01-01T00:00Z') =>
  ({ id, sport, league: LEAGUE[sport] || sport.toUpperCase(), state, start,
     home: { name: home, abbr: 'HOM', score: 0 }, away: { name: away, abbr: 'AWY', score: 0 }, periodNum: 1, periodLabel: '1st', clock: '10:00' });
// A game still 'pre' that kicks off at an absolute instant.
const pre = (id, sport, at) => game(id, sport, 'pre', `Home ${id}`, `Away ${id}`, new Date(at).toISOString());

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
  // (found by search, not guessed), five games due within the window, four
  // polls. The per-game state kept beside the scores is seeded with leftovers.
  {
    const w = makeWorld();
    let lo = 1, hi = 2000;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (serialize(zombies(mid)).length <= LIMIT) lo = mid; else hi = mid - 1; }
    const frozen = zombies(lo);
    const [z0, z1, z2] = Object.keys(frozen);
    frozen['espn:760500'] = { ...frozen[z2], sport: 'wc26' };   // an off-season sport's leftover
    delete frozen[z2];
    const kick = AT + 8 * MIN;
    const due = [1, 2, 3, 4, 5].map(i => ({ ...pre(`espn:74000${i}`, 'epl', kick), home: { name: `Live Home Team Number ${i}`, abbr: 'H', score: 0 } }));
    const ids = due.map(g => g.id);
    w.store.set('scores:today', frozen);
    w.store.set('leaders:today', { [z0]: 'home', 'espn:orphan-leader': 'away' });
    w.store.set('finals:today', [z1, 'espn:orphan-final']);
    w.store.set('wp:today', { [z0]: { homeWP: 0.6 }, 'espn:orphan-wp': { homeWP: 0.5 }, [ids[0]]: { homeWP: 0.55 } });
    eq('S1 precondition: the frozen snapshot fits, and with today\'s games it would not',
      [serialize(frozen).length <= LIMIT, serialize({ ...frozen, ...zombies(5, 'epl') }).length > LIMIT], [true, true]);
    w.board.epl = due;
    await run(C, w, 4, (p, world) => { if (p === 1) world.inst._wpPeaks = { [z0]: 0.7, [ids[0]]: 0.6 }; });
    eq('S1: one closing line per due game across four polls, in one call', [w.captures, w.calls], [ids, ['epl']]);
    eq('S1: no write refused, so no restart', [w.refused, w.instances], [0, 1]);
    eq('S1: the stored scores hold today\'s board, not the frozen leftovers', Object.keys(w.store.get('scores:today') ?? {}).sort(), ids);
    eq('S1: leaders and finals keep only games still kept',
      [Object.keys(w.store.get('leaders:today') ?? {}), w.store.get('finals:today')], [[], []]);
    eq('S1: live odds keep only games still kept', Object.keys(w.store.get('wp:today') ?? {}), [ids[0]]);
    eq('S1: odds peaks keep only games still kept', Object.keys(w.inst._wpPeaks), [ids[0]]);
  }

  // S2 — a restart inside the window, in the poll that bought the line (its
  // scores write is refused): only the stored record stops a second purchase.
  {
    const w = makeWorld();
    const kick = AT + 8 * MIN;
    await run(C, w, 3, (p, world) => {
      world.board.epl = [pre('espn:740002', 'epl', kick)];
      if (p === 0) world.refuseKeys.add('scores:today'); else world.refuseKeys.clear();
    });
    eq('S2 precondition: the poll that bought the line restarted the object', w.instances, 2);
    eq('S2: a restart inside the window does not buy the line again', w.captures, ['espn:740002']);
  }

  // S3 — the board drops a game for one poll, then shows it again: the entry is
  // kept, so nothing is bought or broadcast twice.
  {
    const w = makeWorld();
    const kick = AT + 8 * MIN;
    await run(C, w, 5, (p, world) => {
      world.board.epl = p === 2 ? [] : [game('espn:740003', 'epl', 'live'), pre('espn:740023', 'epl', kick)];
    });
    eq('S3: a due game that blinks off the board is not bought twice', w.captures, ['espn:740023']);
    eq('S3: a live game that blinks is not broadcast again', count(w.events, 'score:espn:740003'), 1);
    const w2 = makeWorld();
    await run(C, w2, 5, (p, world) => { world.board.epl = p === 2 ? [] : [game('espn:740010', 'epl', 'final')]; });
    eq('S3: a final game that blinks is announced final once', count(w2.events, 'final:espn:740010'), 1);
    // Postponed and gone longer than the keep window: the entry is dropped, and
    // only the capture record stops a second purchase when it is due again.
    const w3 = makeWorld();
    let away = null;
    await run(C, w3, 9, (p, world) => {
      world.board.epl = p === 0 || p === 8 ? [pre('espn:740007', 'epl', world.clock + 5 * MIN)] : [];
      if (p === 8) away = 'espn:740007' in (world.store.get('scores:today') ?? {});
    }, HOUR);
    eq('S3 precondition: the entry was dropped while the game was away', away, false);
    eq('S3: a game due again seven hours later is not bought again', w3.captures, ['espn:740007']);
  }

  // S4 — a sport's board is not read, in each way that happens: a non-2xx, a
  // thrown fetch, a 200 without a games array, and the relay's own 200 with an
  // empty board on an upstream error. The live game's entry stays and is not
  // broadcast twice; the due game is bought once.
  for (const mode of ['502', 'throw', 'no-array', 'soft-empty']) {
    const w = makeWorld();
    w.failMode = mode;
    const kick = AT + 8 * MIN;
    let during = null;
    await run(C, w, 4, (p, world) => {
      world.board.epl = [game('espn:740004', 'epl', 'live'), pre('espn:740024', 'epl', kick)];
      if (p === 1 || p === 2) world.failing.add('epl'); else world.failing.delete('epl');
      if (p === 3) during = world.store.get('scores:today')?.['espn:740004']?.state ?? null;
    });
    eq(`S4 (${mode}): kept and still live while unread, bought once, its score broadcast once`,
      [during, w.captures, count(w.events, 'score:espn:740004')], ['live', ['espn:740024'], 1]);
  }

  // S5 — the capture record forgets a game 24 hours after its capture: pinned
  // to the minute on both sides, with and without a capture in the same poll.
  for (const withCapture of [true, false]) {
    const w = makeWorld();
    w.clock = AT - 30_000;
    w.store.set('starts:today', { 'espn:old': AT - 24 * HOUR - MIN, 'espn:recent': AT - 24 * HOUR + MIN });
    w.board.epl = [withCapture ? pre('espn:740006', 'epl', AT + 5 * MIN) : game('espn:740006', 'epl', 'pre')];
    await run(C, w, 1);
    eq(`S5 (${withCapture ? 'with' : 'without'} a capture): 24h + 1 min is dropped, 24h - 1 min is kept`,
      Object.keys(w.store.get('starts:today') ?? {}).sort(), withCapture ? ['espn:740006', 'espn:recent'] : ['espn:recent']);
  }

  // S6 — the object is reset in the middle of the purchase (a deploy), so
  // nothing after the vendor call is written. Two games are due in one call;
  // the record written before the call must hold both.
  {
    const w = makeWorld();
    w.onCapture = () => { w.dead = true; w.onCapture = null; };
    const kick = AT + 8 * MIN;
    await run(C, w, 3, (p, world) => {
      world.board.epl = ['espn:740008', 'espn:740018'].map(id => pre(id, 'epl', kick));
    });
    eq('S6 precondition: the reset happened', w.instances, 2);
    eq('S6: a reset during the purchase buys neither line again', [w.captures, w.calls], [['espn:740008', 'espn:740018'], ['epl']]);
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

  // S10 — the restore read fails once on a new instance. The next poll must
  // restore again instead of running on an empty capture record.
  {
    const w = makeWorld();
    const kick = AT + 8 * MIN;
    await run(C, w, 1, (p, world) => { world.board.epl = [pre('espn:740013', 'epl', kick)]; });
    w.failGet = 1;
    await run(C, w, 2);
    eq('S10: a failed restore read does not buy the line again', w.captures, ['espn:740013']);
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

  // S12 — one vendor call per sport covers every game of it due in the poll.
  {
    const w = makeWorld();
    const kick = AT + 8 * MIN;
    w.board.epl = ['espn:741001', 'espn:741002', 'espn:741003'].map(id => pre(id, 'epl', kick));
    w.board.seriea = ['espn:742001', 'espn:742002'].map(id => pre(id, 'seriea', kick));
    await run(C, w, 2);
    eq('S12: three EPL and two Serie A games due together cost one call per sport',
      [[...w.calls].sort(), w.captures.length], [['epl', 'seriea'], 5]);
  }

  // S13 — which games are due: 'pre', kicking off within ten minutes, not yet
  // started, in a sport with an odds key.
  {
    const w = makeWorld();
    await run(C, w, 1, (p, world) => {
      world.board.epl = [pre('espn:743011', 'epl', world.clock + 11 * MIN), pre('espn:743009', 'epl', world.clock + 9 * MIN),
                         pre('espn:743945', 'epl', world.clock + 9.75 * MIN), pre('espn:741015', 'epl', world.clock + 10.25 * MIN),
                         pre('espn:743000', 'epl', world.clock - MIN), game('espn:743live', 'epl', 'live', 'H', 'A', new Date(world.clock + 5 * MIN).toISOString())];
      world.board.nfl = [pre('espn:743nfl', 'nfl', world.clock + 5 * MIN)];
    });
    const first = [...w.captures];
    await run(C, w, 1, (p, world) => { world.clock += 2 * MIN; });
    eq('S13: due means pre, inside ten minutes to the quarter-minute, not started, and a sport with odds',
      [first, w.captures], [['espn:743009', 'espn:743945'], ['espn:743009', 'espn:743945', 'espn:743011', 'espn:741015']]);
  }

  // S14 — a due game whose archive row does not need a line is not bought and
  // not recorded, so it is bought once its row does.
  {
    const w = makeWorld();
    const kick = AT + 8 * MIN;
    w.noRow.add('espn:744001');
    await run(C, w, 1, (p, world) => { world.board.epl = [pre('espn:744001', 'epl', kick)]; });
    const before = [...w.calls];
    w.noRow.clear();
    await run(C, w, 1);
    eq('S14: no row needing a line, no call and no record; bought once it has one',
      [before, w.captures], [[], ['espn:744001']]);
  }

  // S15 — boards are keyed by the ET date. A 02:30Z kickoff is listed only on
  // the previous date's board, so a poll asking for the UTC date never sees it
  // inside its window (docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md,
  // gap 2). MLS at 02:30Z on 10-25 is a real slot (TASK 0).
  {
    const w = makeWorld();
    w.clock = Date.parse('2026-10-25T02:22:00Z') - 30_000;
    w.boardByDate = { 'mls@2026-10-24': [pre('espn:761901', 'mls', '2026-10-25T02:30:00Z')], 'mls@2026-10-25': [] };
    await run(C, w, 2);
    eq('S15: a 02:30Z kickoff on its ET-dated board is bought once, inside its window', w.captures, ['espn:761901']);
  }

  // S16 — which board each poll asks for: the ET date, held until 4am ET, in
  // daylight and in standard time.
  {
    const asked = [];
    for (const at of ['2026-10-20T03:30:00Z', '2026-10-20T07:30:00Z', '2026-10-20T08:30:00Z',
                      '2026-11-02T04:30:00Z', '2026-11-02T08:30:00Z', '2026-11-02T09:30:00Z',
                      '2027-03-15T04:30:00Z']) {
      const w = makeWorld(); w.asked = [];
      w.clock = Date.parse(at) - 30_000;
      await run(C, w, 1);
      asked.push(`${at.slice(5, 16)}→${[...new Set(w.asked.map(a => a.split('@')[1]))].join(',')}`);
    }
    // The last instant is 00:30 EDT on the Monday after spring-forward, where
    // 24 hours back on the instant named the Saturday (review finding G2).
    eq('S16: the board date is the ET date until 4am ET, in EDT, EST and after spring-forward', asked, [
      '10-20T03:30→2026-10-19', '10-20T07:30→2026-10-19', '10-20T08:30→2026-10-20',
      '11-02T04:30→2026-11-01', '11-02T08:30→2026-11-01', '11-02T09:30→2026-11-02',
      '03-15T04:30→2027-03-14']);
  }

  // S17 — the season month is the slate's. On the night of Oct 31 MLB (in
  // season to October) is still read until 4am ET on Nov 1, for the Oct 31
  // slate, and not after. EST resumes at 06:00Z that morning, so 4:30am ET
  // is 09:30Z. Review finding G6: a month taken from the ET
  // calendar date, or from UTC, drops it at midnight ET or at 00:00Z.
  {
    const mlbAt = async (at) => {
      const w = makeWorld(); w.asked = [];
      w.clock = Date.parse(at) - 30_000;
      await run(C, w, 1);
      return w.asked.filter(a => a.startsWith('mlb@'));
    };
    eq('S17: MLB is read for the Oct 31 slate at 20:30 ET, 00:30 EDT and 02:00 EST, and not at 04:30 EST on Nov 1',
      [await mlbAt('2026-11-01T00:30:00Z'), await mlbAt('2026-11-01T04:30:00Z'), await mlbAt('2026-11-01T07:00:00Z'),
       await mlbAt('2026-11-01T09:30:00Z')],
      [['mlb@2026-10-31'], ['mlb@2026-10-31'], ['mlb@2026-10-31'], []]);
  }

  // S18 — NBA and NHL are read from October to December (gap 1), and a due
  // October game of each is bought once. Review finding G7: checking October
  // alone let November or December be dropped unseen. January is the control,
  // in season before and after the fix.
  {
    const leagues = [];
    for (const at of ['2026-10-20T22:00:00Z', '2026-11-17T00:00:00Z', '2026-12-15T00:00:00Z', '2027-01-15T00:00:00Z']) {
      const w = makeWorld(); w.asked = [];
      w.clock = Date.parse(at) - 30_000;
      await run(C, w, 1);
      leagues.push(`${at.slice(5, 7)}:${w.asked.filter(a => /^(nba|nhl)@/.test(a)).map(a => a.split('@')[0]).sort().join(',')}`);
    }
    eq('S18: NBA and NHL are read in October, November, December and January', leagues,
      ['10:nba,nhl', '11:nba,nhl', '12:nba,nhl', '01:nba,nhl']);
    const w = makeWorld();
    w.clock = Date.parse('2026-10-22T22:52:00Z') - 30_000;
    w.board.nhl = [pre('nhl:2026020141', 'nhl', '2026-10-22T23:00:00Z')];
    w.board.nba = [pre('nba:0022600011', 'nba', '2026-10-22T23:00:00Z')];
    await run(C, w, 3);
    eq('S18: an October NHL game and an October NBA game are each bought once',
      [...w.captures].sort(), ['nba:0022600011', 'nhl:2026020141']);
  }

  // S19 — one instance, polled across the slate change: the date and the
  // month are read on every poll, not once per instance. S16 and S17 start a
  // fresh instance for each instant, so a date or month kept on the instance
  // would pass them (review of the coverage-gaps fix).
  {
    const perPoll = async (from, polls) => {
      const w = makeWorld(); w.asked = [];
      w.clock = Date.parse(from) - MIN;
      const marks = [];
      await run(C, w, polls, (p, world) => marks.push(world.asked.length), MIN);
      marks.push(w.asked.length);
      return { instances: w.instances, polls: marks.slice(0, -1).map((m, i) => w.asked.slice(m, marks[i + 1])) };
    };
    const day = await perPoll('2026-10-20T07:58:00Z', 4);
    eq('S19: one instance asks for 10-19 until 4am EDT and for 10-20 from 4am',
      [day.instances, day.polls.map(asked => [...new Set(asked.map(a => a.split('@')[1]))].join(','))],
      [1, ['2026-10-19', '2026-10-19', '2026-10-20', '2026-10-20']]);
    const month = await perPoll('2026-11-01T08:58:00Z', 4);
    eq('S19: one instance reads MLB until 4am EST on Nov 1, and not after',
      [month.instances, month.polls.map(asked => asked.some(a => a.startsWith('mlb@')))],
      [1, [true, true, false, false]]);
  }

  globalThis.Date = RealDate;
  console.log(failed ? `\nSELF-TEST FAILED: ${failed}` : '\nself-test passed');
  return failed;
}

// Each mutation is one or more [from, to] edits. Every anchor must occur
// exactly once, or the mutation is not run and the gate fails.
const EARLY = "                    this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts))\n                        .catch(";
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
    [EARLY, '                    Promise.resolve()\n                        .catch('],
    ["this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts)),", ''],
    ["this._gameStarts = new Map(Object.entries(stored.get('starts:today') ?? {}));", 'this._gameStarts = new Map();']]],
  ['captures not restored', [["this._gameStarts = new Map(Object.entries(stored.get('starts:today') ?? {}));", 'this._gameStarts = new Map();']]],
  ['record not written before the vendor call', [[EARLY, '                    Promise.resolve()\n                        .catch(']]],
  ['early record holds only the first game due', [[EARLY,
    "                    this.ctx.storage.put('starts:today', Object.fromEntries([...this._gameStarts].filter(([k]) => !due.slice(1).some(s => s.gameId === k))))\n                        .catch("]]],
  ['early record written outside the output gate', [[EARLY,
    "                    this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts), { allowUnconfirmed: true })\n                        .catch("]]],
  ['record not written at the end of the poll', [["this.ctx.storage.put('starts:today', Object.fromEntries(this._gameStarts)),", '']]],
  ['capture record never ages out', [['if (t < captureCutoff) this._gameStarts.delete(id);', '']]],
  ['leaders and live odds kept after their game', [['for (const id of Object.keys(byGame)) if (!(id in this._scores)) delete byGame[id];', '']]],
  ['live odds kept after their game', [['for (const byGame of [this._leaders, this._wpState, this._wpPeaks]) {', 'for (const byGame of [this._leaders, this._wpPeaks]) {']]],
  ['odds peaks kept after their game', [['for (const byGame of [this._leaders, this._wpState, this._wpPeaks]) {', 'for (const byGame of [this._leaders, this._wpState]) {']]],
  ['finals kept after their game', [['for (const id of this._finals) if (!(id in this._scores)) this._finals.delete(id);', '']]],
  ['restore marked done before it succeeds', [
    ['        if (!this._restored) {\n            const stored', '        if (!this._restored) {\n            this._restored = true;\n            const stored'],
    ['            this._restored = true;\n            this._diag.restoredAt', '            this._diag.restoredAt']]],
  ['a game already started is still bought', [["if (state === 'pre' && untilKickoff > 0 && untilKickoff <= CAPTURE_LEAD_MS", "if (state === 'pre' && untilKickoff <= CAPTURE_LEAD_MS"]]],
  ['bought however far off kickoff is', [["if (state === 'pre' && untilKickoff > 0 && untilKickoff <= CAPTURE_LEAD_MS", "if (state === 'pre' && untilKickoff > 0"]]],
  ['bought twenty minutes ahead', [['const CAPTURE_LEAD_MS = 10 * 60_000;', 'const CAPTURE_LEAD_MS = 20 * 60_000;']]],
  ['bought nine minutes ahead', [['const CAPTURE_LEAD_MS = 10 * 60_000;', 'const CAPTURE_LEAD_MS = 9 * 60_000;']]],
  ['bought eleven minutes ahead', [['const CAPTURE_LEAD_MS = 10 * 60_000;', 'const CAPTURE_LEAD_MS = 11 * 60_000;']]],
  ['bought for a sport the vendor does not cover', [['                    && ODDS_SPORT_KEYS[sport] && !this._gameStarts.has(gameId)) {', '                    && !this._gameStarts.has(gameId)) {']]],
  ['one call per game', [['                if (!bySport.has(start.sport)) bySport.set(start.sport, []);\n                bySport.get(start.sport).push(start);',
    '                bySport.set(start.gameId, [start]);']]],
  ['NBA and NHL not read in October to December', [["    'nba':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul\n    'nhl':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul",
    "    'nba':        [0,1,2,3,4,5,6],           // Oct–Jun\n    'nhl':        [0,1,2,3,4,5,6],           // Oct–Jun"]]],
  ['NHL not read in October to December', [["    'nhl':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul", "    'nhl':        [0,1,2,3,4,5,6],   // Oct–Jul"]]],
  ['NBA not read in October to December', [["    'nba':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul", "    'nba':        [0,1,2,3,4,5,6],   // Oct–Jul"]]],
  ['November and December dropped', [["    'nba':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul\n    'nhl':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul",
    "    'nba':        [9,0,1,2,3,4,5,6],   // Oct–Jul\n    'nhl':        [9,0,1,2,3,4,5,6],   // Oct–Jul"]]],
  ['November dropped', [["    'nba':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul\n    'nhl':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul",
    "    'nba':        [9,11,0,1,2,3,4,5,6],   // Oct–Jul\n    'nhl':        [9,11,0,1,2,3,4,5,6],   // Oct–Jul"]]],
  ['December dropped', [["    'nba':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul\n    'nhl':        [9,10,11,0,1,2,3,4,5,6],   // Oct–Jul",
    "    'nba':        [9,10,0,1,2,3,4,5,6],   // Oct–Jul\n    'nhl':        [9,10,0,1,2,3,4,5,6],   // Oct–Jul"]]],
  ['board read by the UTC date', [['const today   = getFieldDateKey();', 'const today   = new Date().toISOString().slice(0, 10);']]],
  ['season month read in UTC', [['const month   = Number(today.slice(5, 7)) - 1;', 'const month   = new Date().getUTCMonth();']]],
  ['season month from the ET calendar date', [['const month   = Number(today.slice(5, 7)) - 1;',
    "const month   = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(5, 7)) - 1;"]]],
  ['season month from UTC less four hours', [['const month   = Number(today.slice(5, 7)) - 1;', 'const month   = new Date(Date.now() - 4 * 3600_000).getUTCMonth();']]],
  ['season month from UTC less five hours', [['const month   = Number(today.slice(5, 7)) - 1;', 'const month   = new Date(Date.now() - 5 * 3600_000).getUTCMonth();']]],
  ['slate date read once per instance', [['const today   = getFieldDateKey();', 'const today   = (this._slateDate ??= getFieldDateKey());']]],
  ['season month read once per instance', [['const month   = Number(today.slice(5, 7)) - 1;', 'const month   = (this._slateMonth ??= Number(today.slice(5, 7)) - 1);']]],
  ['the old 24-hour slate body kept inline', [['const today   = getFieldDateKey();',
    "const today   = (() => { const h = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }), 10); const b = new Date(); if (h < 4) b.setTime(b.getTime() - 24 * 60 * 60 * 1000); return b.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); })();"]]],
  ['recorded before the row check', [
    ['                    const due = (await this._closingRowsFor(starts)).filter(d => !this._gameStarts.has(d.gameId));\n                    if (!due.length) continue;\n                    for (const d of due) this._gameStarts.set(d.gameId, Date.now());',
     '                    for (const d of starts) this._gameStarts.set(d.gameId, Date.now());\n                    const due = await this._closingRowsFor(starts);\n                    if (!due.length) continue;']]],
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
    const mutant = path.join(path.dirname(SRC), `.mutant-${process.pid}-dedup-ambient-do.js`);
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
