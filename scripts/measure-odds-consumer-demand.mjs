#!/usr/bin/env node
// What each odds consumer NEEDS, next to what it was charged and what the
// vendor's receipts kept. CC-CMD-2026-09-16-odds-spend-attribution, Task 2.
//
// "Not what did it spend — what does it NEED." Every demand figure below is
// computed from inputs that do not read a spend counter: the archive schedule
// (sport, date, start_time, finalized_at, created_at), change_log's
// closing-odds writes, and the vendor URL each consumer builds, priced by the
// worker's own oddsCreditCost. A demand derived from the counter it is compared
// with would verify a copy of itself (Rule 100), so no model here reads
// odds_budget*, odds_reconcile_state or odds_history.
//
// TWO SPEND COLUMNS, because they disagree and the disagreement is a finding:
//   charged — odds_budget_site.used, the counter the 3800 ceiling enforces.
//   kept    — SUM(credits_kept) in odds_reconcile_state: what reconcile kept
//             after the vendor's receipt (or kept for want of one).
// On 2026-10-17 handleCFLOddsProbs was charged 2058 and kept 144.
//
// THE MODELS, one per consumer. Each is the NEED of what the consumer exists to
// serve, stated as a unit of vendor calls. The unit's price is that consumer's
// URL as written in src/, priced by oddsCreditCost — read from source, never
// restated here, so a markets= edit cannot leave this script pricing the old one.
//
//   ambientCaptureClosingOdds  one closing snapshot per distinct (sport, kickoff
//     instant) of an ambient-covered sport (AMBIENT_SPORT_TO_ODDS_KEY, the World
//     Cup included), on the UTC day of kickoff. One call returns the whole sport,
//     so games sharing a kickoff share a snapshot.
//   handleCFLOddsProbs  one snapshot per ET game-day with a CFL game (the
//     archive's `date`). The client never refreshes odds in-session, so the
//     floor is one per day; any higher cadence is an owner ruling, not a need.
//   fetchSportOddsLive  one opening-line snapshot per mapped sport per FIELD day
//     that has a row seeded BEFORE its own kickoff (created_at < start_time).
//     The snapshot cron fills opening_odds only on unfinished rows, so a row
//     the archive first writes at the final (CFL's are) is never its to serve.
//   fetchSportOddsHistorical  one noon snapshot per (sport, archive date) with a
//     final game that has no closing line captured before it went final, no
//     in-play relabel, and a kickoff after the snapshot instant (before it the
//     write is refused: `_preKickoff` in the /archive/game closing path,
//     src/index.js). Counted on the UTC day of the unit's first finalization.
//     Units in JOIN_UNWRITABLE sports are printed apart and kept out of demand:
//     the fetch is paid for, but findOddsForRow cannot match those archive
//     names to the vendor's, so no closing line is ever written by this path.
//   getWCPregameLambdas  one snapshot per distinct World Cup kickoff instant.
//   handleWCOddsProbs  96 snapshots (the 15-minute cron cadence) per day inside
//     the cron's own World Cup window (_wcOpen.._wcClose, read from source)
//     while any fixture remains unplayed; otherwise 0.
//   ambientFetchLiveOdds  UNSERVED while ODDS_LIVE_PATH_404 is true (the vendor
//     404s /odds-live). Its demand IF SERVED is the CC-CMD's own formula: live
//     minutes per sport / _getOddsCooldown, times cost. Printed apart from the
//     served totals, never added to them.
//   wpResolver  UNKNOWN: its trigger is a resolved pick, and pick volume lives
//     in UserDO and localStorage, which CI cannot read.
//   oddsProxyRoute  0: the public /odds/* proxy has no FIELD consumer (grep of
//     all four repos, 2026-10-21). Anonymous traffic is exposure, not demand.
//
// A CLOSED DAY IS ONE WHOSE INPUTS HAVE LANDED. CFL rows are written when the
// game is final, and a late final is archived at the 10:00Z cron tick, so the
// window ends the day before yesterday until 10:15Z (closedDays).
//
// READ-ONLY. The d1 helper refuses any statement that is not a SELECT.
//
//   node scripts/measure-odds-consumer-demand.mjs [--days=7]
//   node scripts/measure-odds-consumer-demand.mjs --self-test
//   node scripts/measure-odds-consumer-demand.mjs --mutate

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { oddsCreditCost } from '../src/budget-helpers.js';
import { archiveSportToOddsKey, backfillSportToOddsKey, AMBIENT_SPORT_TO_ODDS_KEY } from '../src/odds-sport-keys.js';
import { asUtc } from './lib/utc.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DAY_MS = 86400000;

// The four sports whose closing line the historical path fetches and cannot
// write. Measured 2026-10-21: findOddsForRow matched 0 of 19 NHL, NFL, NBA and
// CFB games against the vendor's names for 10-15..10-20, and change_log holds
// no archive_game_closing write for any of them since 2026-09-01. A dated
// constant, not a measurement: it is removed by the CC-CMD that fixes the join.
export const JOIN_UNWRITABLE = {
  asOf: '2026-10-21',
  doc: 'docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md',
  keys: new Set(['basketball_nba', 'icehockey_nhl', 'americanfootball_nfl', 'americanfootball_ncaaf']),
};

// ── Source reads: the price of each unit, and three code facts ──────────────

/** The vendor URL a consumer builds, with every ${...} replaced, read from the
 *  statement that starts at `anchor`. The anchor must occur exactly once: a
 *  second match means this could be pricing the wrong URL (Rule 90). */
export function urlFromSource(text, anchor) {
  const first = text.indexOf(anchor);
  if (first < 0) throw new Error(`anchor not found: ${anchor}`);
  if (text.indexOf(anchor, first + 1) >= 0) throw new Error(`anchor not unique: ${anchor}`);
  const stmt = text.slice(first, text.indexOf(';', first));
  const parts = [...stmt.matchAll(/`([^`]*)`/g)].map(m => m[1]);
  if (!parts.length) throw new Error(`no template literal after: ${anchor}`);
  let url = parts.join('').replace(/\$\{[^}]*\}/g, 'X');
  if (url.startsWith('X/v4/')) url = 'https://api.the-odds-api.com' + url.slice(1);
  if (!/^https:\/\/api\.the-odds-api\.com\/v4\//.test(url)) throw new Error(`not a vendor URL: ${url}`);
  return url;
}

const URL_ANCHORS = {
  ambientCaptureClosingOdds: ['src/ambient-do.js', 'const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/odds`'],
  handleCFLOddsProbs:        ['src/index.js', 'const _cflUrl = `'],
  fetchSportOddsLive:        ['src/index.js', 'const _liveUrl = `'],
  fetchSportOddsHistorical:  ['src/index.js', 'const url = `${ODDS_BASE}/v4/historical/sports/${sportKey}/odds`'],
  getWCPregameLambdas:       ['src/index.js', 'const _wcUrl = `'],
  handleWCOddsProbs:         ['src/index.js', 'const _wcProbsUrl = `'],
  ambientFetchLiveOdds:      ['src/ambient-do.js', '`https://api.the-odds-api.com/v4/sports/${oddsSportKey}/odds-live?'],
  wpResolver:                ['src/wp-resolver.js', 'const _url = `${ODDS_BASE}/v4/sports/${sportKey}/odds?'],
};

function readSrc(rel) { return readFileSync(path.join(ROOT, rel), 'utf8'); }

export function costsFromSource(read = readSrc) {
  const out = {};
  for (const [site, [file, anchor]] of Object.entries(URL_ANCHORS)) {
    const url = urlFromSource(read(file), anchor);
    out[site] = { url: url.replace(/apiKey=X&?/, ''), cost: oddsCreditCost(url) };
  }
  return out;
}

/** AmbientDO's live-odds kill switch and its cooldown function, evaluated from
 *  the source text with the day pinned — _getOddsCooldown reads `new Date()`. */
export function ambientFromSource(text) {
  const flag = text.match(/^const ODDS_LIVE_PATH_404 = (true|false);/m);
  if (!flag) throw new Error('ODDS_LIVE_PATH_404 not found');
  const pri = text.match(/^const ODDS_PRIORITY = \{[\s\S]*?^\};/m);
  const fn = text.match(/^function _getOddsCooldown\(sport\) \{[\s\S]*?^\}/m);
  if (!pri || !fn) throw new Error('ODDS_PRIORITY or _getOddsCooldown not found');
  const cooldownOn = (sport, dayIso) => {
    const at = Date.parse(dayIso + 'T12:00:00Z');
    class PinnedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(at); } }
    return new Function('Date', `${pri[0]}\n${fn[0]}\nreturn _getOddsCooldown;`)(PinnedDate)(sport);
  };
  return { liveDisabled: flag[1] === 'true', cooldownOn };
}

/** The World Cup cron window, from the two literals that gate it. */
export function wcGateFromSource(text) {
  const one = (name) => {
    const re = new RegExp(`const ${name}\\s*= new Date\\('(\\d{4}-\\d{2}-\\d{2})T00:00:00Z'\\)`, 'g');
    const all = [...text.matchAll(re)];
    if (all.length !== 1) throw new Error(`${name}: ${all.length} declarations, expected exactly 1`);
    return all[0][1];
  };
  return { open: one('_wcOpen'), close: one('_wcClose') };
}

// ── The models: pure, so the self-test and the mutations can reach them ─────

export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const AMBIENT_KEYS = new Set(Object.values(AMBIENT_SPORT_TO_ODDS_KEY));
const AMBIENT_CODE_OF = Object.fromEntries(Object.entries(AMBIENT_SPORT_TO_ODDS_KEY).map(([c, k]) => [k, c]));
const isWC = (sport) => String(sport || '').toLowerCase() === 'fifa world cup';
const lc = (s) => String(s || '').trim().toLowerCase();

/** Rows as the models read them: one parse, so no model re-reads a raw string.
 *  Two keys, because the worker has two lookups: the archive map (the opening
 *  and historical paths, which refuse the World Cup) and the wider backfill map
 *  (which carries it), filtered to AmbientDO's sports for the ambient paths. */
export function prepare(rows) {
  return rows.map(r => ({
    ...r,
    oddsKey: archiveSportToOddsKey(r.sport),
    ambientKey: AMBIENT_KEYS.has(backfillSportToOddsKey(r.sport)) ? backfillSportToOddsKey(r.sport) : null,
    startMs: asUtc(r.start_time),
    finalMs: asUtc(r.finalized_at),
    createdMs: asUtc(r.created_at),
  }));
}

/** The last N closed UTC days. A day is closed once its archive inputs have
 *  landed: until 10:15Z the window ends a day earlier, because a CFL final
 *  after 02:45Z is archived at the 10:00Z cron tick. */
export function closedDays(nowMs, n, settleMinutes = 615) {
  const today = Date.parse(utcDay(nowMs) + 'T00:00:00Z');
  const settled = nowMs >= today + settleMinutes * 60000;
  const last = today - (settled ? 1 : 2) * DAY_MS;
  return {
    days: Array.from({ length: n }, (_, i) => utcDay(last - (n - 1 - i) * DAY_MS)),
    note: settled ? null : `${utcDay(today - DAY_MS)} excluded: before 10:15Z its late finals are not yet archived`,
  };
}

export function closingCaptureDemand(games, days, cost) {
  const out = {};
  for (const d of days) {
    const slots = new Set(), seen = new Set();
    for (const g of games) {
      if (!g.ambientKey || !Number.isFinite(g.startMs) || utcDay(g.startMs) !== d) continue;
      slots.add(`${g.ambientKey}|${g.startMs}`);
      seen.add(`${g.ambientKey}|${g.startMs}|${lc(g.home)}|${lc(g.away)}`);
    }
    out[d] = { demand: cost * slots.size, units: slots.size, note: `${seen.size} games` };
  }
  return out;
}

export function cflDemand(games, days, cost) {
  const out = {};
  for (const d of days) {
    const day = games.filter(g => lc(g.sport) === 'cfl' && g.date === d);
    const kick = new Set(day.filter(g => Number.isFinite(g.startMs)).map(g => g.startMs));
    out[d] = { demand: day.length ? cost : 0, units: day.length ? 1 : 0, note: `${day.length} games, ${kick.size} kickoffs` };
  }
  return out;
}

export function openingSnapshotDemand(games, days, cost) {
  const out = {};
  for (const d of days) {
    const keys = new Set(games.filter(g => g.date === d && g.oddsKey
      && Number.isFinite(g.startMs) && g.createdMs < g.startMs).map(g => g.oddsKey));
    out[d] = { demand: cost * keys.size, units: keys.size, note: `${keys.size} sport-days` };
  }
  return out;
}

export function historicalClosingDemand(games, closingWrites, days, cost, unwritable = JOIN_UNWRITABLE.keys) {
  const capturedBefore = new Map();   // game id -> earliest closing write
  for (const w of closingWrites) {
    const t = asUtc(w.ts);
    if (!Number.isFinite(t)) continue;
    if (!capturedBefore.has(w.game_id) || t < capturedBefore.get(w.game_id)) capturedBefore.set(w.game_id, t);
  }
  const units = new Map();            // `${oddsKey}|${date}` -> earliest finalization
  for (const g of games) {
    if (!g.oddsKey || !Number.isFinite(g.finalMs) || !Number.isFinite(g.startMs)) continue;
    if (g.has_inplay) continue;
    if (g.startMs <= Date.parse(`${g.date}T12:00:00Z`)) continue;
    const cap = capturedBefore.get(g.id);
    if (cap !== undefined && cap < g.finalMs) continue;
    const k = `${g.oddsKey}|${g.date}`;
    if (!units.has(k) || g.finalMs < units.get(k)) units.set(k, g.finalMs);
  }
  const out = {};
  for (const d of days) {
    const on = [...units].filter(([, t]) => utcDay(t) === d).map(([k]) => k.split('|')[0]);
    const n = on.filter(k => !unwritable.has(k)).length, nU = on.length - n;
    out[d] = { demand: cost * n, units: n, unwritable: cost * nU,
      note: `${n} sport-dates${nU ? `, +${nU} unwritable` : ''}` };
  }
  return out;
}

export function wcLambdaDemand(games, days, cost) {
  const out = {};
  for (const d of days) {
    const wc = games.filter(g => isWC(g.sport));
    const known = new Set(wc.filter(g => Number.isFinite(g.startMs) && utcDay(g.startMs) === d).map(g => g.startMs)).size;
    const unknown = wc.filter(g => !Number.isFinite(g.startMs) && g.date === d).length;
    out[d] = { demand: cost * (known + unknown), units: known + unknown,
      note: unknown ? `${known} kickoffs + ${unknown} with no start_time (upper bound)` : `${known} kickoffs` };
  }
  return out;
}

export function wcProbsDemand(lastWcDate, gate, days, cost, perDay = 96) {
  const out = {};
  for (const d of days) {
    const inGate = d >= gate.open && d < gate.close;
    const open = inGate && lastWcDate != null && lastWcDate >= d;
    out[d] = { demand: open ? cost * perDay : 0, units: open ? perDay : 0,
      note: open ? `fixtures remain to ${lastWcDate}`
        : !inGate ? `outside the cron window ${gate.open}..${gate.close}` : `no fixture on or after ${d} (last ${lastWcDate ?? 'none'})` };
  }
  return out;
}

/** Median minutes from kickoff to finalization per ambient key: the live window. */
export function liveMinutesByKey(sample) {
  const by = new Map();
  for (const r of sample) {
    const k = backfillSportToOddsKey(r.sport);
    const m = (asUtc(r.finalized_at) - asUtc(r.start_time)) / 60000;
    if (!k || !AMBIENT_KEYS.has(k) || !Number.isFinite(m) || m <= 0 || m > 600) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(m);
  }
  const out = {};
  for (const [k, ms] of by) {
    ms.sort((a, b) => a - b);
    const mid = Math.floor(ms.length / 2);
    out[k] = { minutes: ms.length % 2 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2, n: ms.length };
  }
  return out;
}

export function liveOddsDemandIfServed(games, days, cost, liveMinutes, cooldownOn) {
  const out = {};
  for (const d of days) {
    const d0 = Date.parse(d + 'T00:00:00Z'), d1 = d0 + DAY_MS;
    const byKey = new Map();
    for (const g of games) {
      if (!g.ambientKey || !Number.isFinite(g.startMs)) continue;
      const lm = liveMinutes[g.ambientKey];
      if (!lm) continue;
      const a = Math.max(g.startMs, d0), b = Math.min(g.startMs + lm.minutes * 60000, d1);
      if (b <= a) continue;
      if (!byKey.has(g.ambientKey)) byKey.set(g.ambientKey, []);
      byKey.get(g.ambientKey).push([a, b]);
    }
    let units = 0;
    for (const [k, iv] of byKey) {
      iv.sort((x, y) => x[0] - y[0]);
      let union = 0, [cs, ce] = iv[0];
      for (const [s, e] of iv.slice(1)) {
        if (s > ce) { union += ce - cs; [cs, ce] = [s, e]; } else ce = Math.max(ce, e);
      }
      union += ce - cs;
      units += Math.ceil(union / cooldownOn(AMBIENT_CODE_OF[k], d));
    }
    out[d] = { demand: cost * units, units, note: `${byKey.size} sports live` };
  }
  return out;
}

export function ratio(spend, demand) {
  if (demand == null) return 'UNKNOWN';
  if (demand === 0) return spend > 0 ? 'spend, no need' : 'both 0';
  return `${(spend / demand).toFixed(1)}x`;
}

// ── Self-test and mutations (Rule 90) ────────────────────────────────────────

function selfTest() {
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };
  const D = ['2026-10-16', '2026-10-17'];
  const SEEDED = '2026-10-16 10:00:00';
  const G = prepare([
    // two MLB games at one instant: one slot, two games
    { id: 'a', sport: 'MLB', date: '2026-10-16', start_time: '2026-10-16T23:05Z', created_at: SEEDED, home: 'A', away: 'B' },
    { id: 'b', sport: 'MLB', date: '2026-10-16', start_time: '2026-10-16T23:05:00+00:00', created_at: SEEDED, home: 'C', away: 'D' },
    // a CFL game on ET day 10-16 that kicks off on UTC day 10-17, written at its final
    { id: 'c', sport: 'CFL', date: '2026-10-16', start_time: '2026-10-17T01:30Z', finalized_at: '2026-10-17 04:40:00', created_at: '2026-10-17 04:40:00', home: 'E', away: 'F' },
    // an MLS placeholder, seeded early but with no kickoff: no slot and no sport-day
    { id: 'd', sport: 'MLS', date: '2026-10-17', start_time: null, created_at: '2026-10-17 10:00:00', home: 'G', away: 'H' },
    // CFB is mapped but not ambient-covered, and this row was written after kickoff
    { id: 'e', sport: 'CFB', date: '2026-10-17', start_time: '2026-10-17T16:00Z', finalized_at: '2026-10-17 19:30:00', created_at: '2026-10-17 19:30:00', home: 'I', away: 'J' },
    // a final MLB game whose closing line was captured before it went final
    { id: 'f', sport: 'MLB', date: '2026-10-17', start_time: '2026-10-17T17:00Z', finalized_at: '2026-10-17 20:00:00', created_at: '2026-10-17 10:00:00', home: 'K', away: 'L' },
    // a final game that kicked off before the noon snapshot: refused, no unit
    { id: 'g', sport: 'EPL', date: '2026-10-17', start_time: '2026-10-17T11:30Z', finalized_at: '2026-10-17 13:30:00', created_at: '2026-10-17 10:00:00', home: 'M', away: 'N' },
    // a final relabelled game: excluded
    { id: 'h', sport: 'WNBA', date: '2026-10-17', start_time: '2026-10-17T23:00Z', finalized_at: '2026-10-18 01:30:00', created_at: '2026-10-17 10:00:00', home: 'O', away: 'P', has_inplay: 1 },
    // FIELD day 10-16, but it kicks off after UTC midnight: its closing line is a 10-17 need
    { id: 'i', sport: 'MLB', date: '2026-10-16', start_time: '2026-10-17T00:10Z', created_at: SEEDED, home: 'Q', away: 'R' },
    // a second CFL game the same ET day: still one snapshot
    { id: 'j', sport: 'CFL', date: '2026-10-16', start_time: '2026-10-16T23:00Z', created_at: '2026-10-17 02:10:00', home: 'S', away: 'T' },
    // an NHL final the historical path would fetch for and cannot write
    { id: 'k', sport: 'NHL', date: '2026-10-17', start_time: '2026-10-17T23:00Z', finalized_at: '2026-10-18 01:40:00', created_at: '2026-10-17 10:00:00', home: 'U', away: 'V' },
    // a World Cup kickoff: ambient-covered, though the archive map has no key for it
    { id: 'l', sport: 'FIFA World Cup', date: '2026-10-18', start_time: '2026-10-18T19:00Z', home: 'W', away: 'X' },
  ]);
  const W = [{ game_id: 'f', ts: '2026-10-17 17:00:30' }, { game_id: 'c', ts: '2026-10-17 05:00:00' }];

  eq('closing: two games at one instant are one slot', closingCaptureDemand(G, D, 3)['2026-10-16'], { demand: 3, units: 1, note: '2 games' });
  eq('closing: bucketed by UTC kickoff, not by the archive date', closingCaptureDemand(G, D, 3)['2026-10-17'], { demand: 15, units: 5, note: '5 games' });
  eq('closing: the World Cup is ambient-covered', closingCaptureDemand(G, ['2026-10-18'], 3)['2026-10-18'], { demand: 3, units: 1, note: '1 games' });
  eq('cfl: one snapshot per ET game-day, on the archive date', cflDemand(G, D, 6)['2026-10-16'], { demand: 6, units: 1, note: '2 games, 2 kickoffs' });
  eq('cfl: the UTC kickoff day is not a game-day', cflDemand(G, D, 6)['2026-10-17'], { demand: 0, units: 0, note: '0 games, 0 kickoffs' });
  eq('opening: only sports with a row seeded before its own kickoff', openingSnapshotDemand(G, D, 3)['2026-10-17'], { demand: 12, units: 4, note: '4 sport-days' });
  eq('opening: a CFL row written at its final is never the cron\'s to serve', openingSnapshotDemand(G, D, 3)['2026-10-16'], { demand: 3, units: 1, note: '1 sport-days' });
  eq('historical: only the orphaned finals, on the UTC day of first final',
    historicalClosingDemand(G, W, ['2026-10-17'], 30)['2026-10-17'], { demand: 30, units: 1, unwritable: 30, note: '1 sport-dates, +1 unwritable' });
  eq('historical: an unwritable sport is printed apart, a relabelled final not at all',
    historicalClosingDemand(G, W, ['2026-10-18'], 30)['2026-10-18'], { demand: 0, units: 0, unwritable: 30, note: '0 sport-dates, +1 unwritable' });
  eq('wc lambdas: none scheduled is 0', wcLambdaDemand(G, D, 4)['2026-10-16'], { demand: 0, units: 0, note: '0 kickoffs' });
  eq('wc probs: open only inside the cron window, while fixtures remain',
    wcProbsDemand('2026-07-19', { open: '2026-06-11', close: '2026-07-20' }, ['2026-06-10', '2026-07-19', '2026-07-20'], 4),
    { '2026-06-10': { demand: 0, units: 0, note: 'outside the cron window 2026-06-11..2026-07-20' },
      '2026-07-19': { demand: 384, units: 96, note: 'fixtures remain to 2026-07-19' },
      '2026-07-20': { demand: 0, units: 0, note: 'outside the cron window 2026-06-11..2026-07-20' } });
  eq('wc probs: inside the window with no fixture left is 0',
    wcProbsDemand('2026-07-01', { open: '2026-06-11', close: '2026-07-20' }, ['2026-07-02'], 4)['2026-07-02'],
    { demand: 0, units: 0, note: 'no fixture on or after 2026-07-02 (last 2026-07-01)' });
  eq('live minutes: the median, junk dropped', liveMinutesByKey([
    { sport: 'MLB', start_time: '2026-10-16T23:00Z', finalized_at: '2026-10-17 02:00:00' },
    { sport: 'MLB', start_time: '2026-10-16T23:00Z', finalized_at: '2026-10-17 01:00:00' },
    { sport: 'MLB', start_time: '2026-10-16T23:00Z', finalized_at: '2026-10-17 04:00:00' },
    { sport: 'MLB', start_time: '2026-10-16T23:00Z', finalized_at: '2027-01-01 00:00:00' },
  ]).baseball_mlb, { minutes: 180, n: 3 });
  // 22:00-23:30 and 23:00-00:30 overlap, and the second crosses midnight: the
  // 10-16 union is 22:00-24:00, 120 minutes, 12 polls at 10 minutes, 2 credits each.
  const live = liveOddsDemandIfServed(prepare([
    { sport: 'MLB', start_time: '2026-10-16T22:00Z' }, { sport: 'MLB', start_time: '2026-10-16T23:00Z' },
  ]), ['2026-10-16'], 2, { baseball_mlb: { minutes: 90 } }, () => 600000);
  eq('live if served: overlapping windows are unioned, clipped at midnight', live['2026-10-16'], { demand: 24, units: 12, note: '1 sports live' });
  eq('ratio: no need and some spend is said, not divided', ratio(36, 0), 'spend, no need');
  eq('ratio: unknown stays unknown', ratio(5, null), 'UNKNOWN');
  eq('ratio: spend over demand', ratio(2058, 6), '343.0x');
  eq('closed days: before 10:15Z yesterday is not closed yet', closedDays(Date.parse('2026-10-21T05:00:00Z'), 2),
    { days: ['2026-10-18', '2026-10-19'], note: '2026-10-20 excluded: before 10:15Z its late finals are not yet archived' });
  eq('closed days: after 10:15Z yesterday is', closedDays(Date.parse('2026-10-21T11:00:00Z'), 2).days, ['2026-10-19', '2026-10-20']);

  const src = readSrc('src/ambient-do.js');
  const amb = ambientFromSource(src);
  // NBA is medium outside June and high in June, so a cooldown read from the
  // runner's clock disagrees with one of these two in every month of the year.
  eq('ambient: the cooldown is read from source with the day pinned (NBA in October is medium)', amb.cooldownOn('nba', '2026-10-17'), 60000);
  eq('ambient: and follows the pinned month, not the clock (NBA in June is high)', amb.cooldownOn('nba', '2026-06-10'), 30000);
  let threw = null;
  try { urlFromSource('const _x = `a`; const _x = `a`;', 'const _x = `'); } catch (e) { threw = e.message; }
  eq('source: a non-unique anchor refuses to price', threw, 'anchor not unique: const _x = `');
  const costs = costsFromSource();
  eq('source: every consumer has a priced URL', Object.keys(costs).sort(), Object.keys(URL_ANCHORS).sort());
  eq('source: the historical URL carries the 10x multiplier', costs.fetchSportOddsHistorical.url.includes('/v4/historical/'), true);
  eq('source: the World Cup cron window', wcGateFromSource(readSrc('src/index.js')), { open: '2026-06-11', close: '2026-07-20' });

  console.log(failed ? `\nSELF-TEST FAILED: ${failed}` : '\nself-test passed');
  return failed;
}

const MUTATIONS = [
  ['slots keyed by game, not by instant', "slots.add(`${g.ambientKey}|${g.startMs}`);", "slots.add(`${g.ambientKey}|${g.startMs}|${lc(g.home)}`);"],
  ['closing bucketed by archive date', 'utcDay(g.startMs) !== d) continue;\n      slots', 'g.date !== d) continue;\n      slots'],
  ['ambient models keyed by the archive map', "ambientKey: AMBIENT_KEYS.has(backfillSportToOddsKey(r.sport)) ? backfillSportToOddsKey(r.sport) : null,", "ambientKey: AMBIENT_KEYS.has(archiveSportToOddsKey(r.sport)) ? archiveSportToOddsKey(r.sport) : null,"],
  ['cfl one per game, not per day', "out[d] = { demand: day.length ? cost : 0,", "out[d] = { demand: cost * day.length,"],
  ['cfl bucketed by UTC kickoff', "lc(g.sport) === 'cfl' && g.date === d", "lc(g.sport) === 'cfl' && Number.isFinite(g.startMs) && utcDay(g.startMs) === d"],
  ['opening counts rows with no kickoff', '&& Number.isFinite(g.startMs) && g.createdMs < g.startMs)', '&& !(g.createdMs >= g.startMs))'],
  ['opening counts rows written after kickoff', '&& Number.isFinite(g.startMs) && g.createdMs < g.startMs)', '&& Number.isFinite(g.startMs))'],
  ['historical ignores the closing capture', 'if (cap !== undefined && cap < g.finalMs) continue;', ''],
  ['historical ignores the noon refusal', "if (g.startMs <= Date.parse(`${g.date}T12:00:00Z`)) continue;", ''],
  ['historical keeps relabelled rows', 'if (g.has_inplay) continue;', ''],
  ['historical counts unwritable units as demand', 'const n = on.filter(k => !unwritable.has(k)).length, nU = on.length - n;', 'const n = on.length, nU = 0;'],
  ['wc probs never closes', 'const open = inGate && lastWcDate != null && lastWcDate >= d;', 'const open = inGate && lastWcDate != null;'],
  ['wc probs ignores the cron window', 'const inGate = d >= gate.open && d < gate.close;', 'const inGate = true;'],
  ['live windows summed, not unioned', 'if (s > ce) { union += ce - cs; [cs, ce] = [s, e]; } else ce = Math.max(ce, e);', 'union += ce - cs; [cs, ce] = [s, e];'],
  ['live window not clipped at midnight', 'const a = Math.max(g.startMs, d0), b = Math.min(g.startMs + lm.minutes * 60000, d1);', 'const a = g.startMs, b = g.startMs + lm.minutes * 60000;'],
  ['median replaced by mean', 'minutes: ms.length % 2 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2,', 'minutes: ms.reduce((x, y) => x + y, 0) / ms.length,'],
  ['zero demand divided', "if (demand === 0) return spend > 0 ? 'spend, no need' : 'both 0';", ''],
  ['cooldown read from the clock', 'else super(at); } }', 'else super(); } }'],
  ['a duplicate anchor is accepted', "if (text.indexOf(anchor, first + 1) >= 0) throw new Error(`anchor not unique: ${anchor}`);", ''],
  ['yesterday counted closed before it settles', 'const settled = nowMs >= today + settleMinutes * 60000;', 'const settled = true;'],
];

function mutate() {
  const self = fileURLToPath(import.meta.url);
  const src = readFileSync(self, 'utf8');
  // Anchors are searched in the code ABOVE this table only: the table quotes
  // every anchor, so a whole-file search would find each one twice.
  const cut = src.indexOf('const MUTATIONS = [');
  const code = src.slice(0, cut), rest = src.slice(cut);
  const base = spawnSync(process.execPath, [self, '--self-test'], { encoding: 'utf8' });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout); return 1; }
  let notCaught = 0;
  for (const [name, from, to] of MUTATIONS) {
    const at = code.indexOf(from);
    if (at < 0 || code.indexOf(from, at + 1) >= 0) { console.log(`  ANCHOR  ${name} (${at < 0 ? 'missing' : 'not unique'})`); notCaught++; continue; }
    const mutant = path.join(HERE, `.mutant-consumer-demand.mjs`);
    writeFileSync(mutant, code.slice(0, at) + to + code.slice(at + from.length) + rest);
    try {
      const r = spawnSync(process.execPath, [mutant, '--self-test'], { encoding: 'utf8' });
      const caught = r.status !== 0;
      if (!caught) notCaught++;
      console.log(`  ${caught ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}`);
    } finally { unlinkSync(mutant); }
  }
  console.log(`\nmutations: ${MUTATIONS.length - notCaught} of ${MUTATIONS.length} caught`);
  return notCaught ? 1 : 0;
}

// ── The measurement ──────────────────────────────────────────────────────────

async function measure() {
  const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
  const GATE = process.env.RELAY_SHARED_SECRET;
  if (!GATE) { console.log('FAIL: RELAY_SHARED_SECRET is unset, so no read can be made.'); process.exit(1); }
  const rawDays = process.argv.find(a => a.startsWith('--days='))?.split('=')[1];
  const N = Number(rawDays ?? 7);
  if (!Number.isInteger(N) || N < 1) { console.log(`FAIL: --days must be a positive integer, got ${JSON.stringify(rawDays)}`); process.exit(1); }
  const d1 = async (sql, params = []) => {
    if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refusing non-SELECT: ${sql.slice(0, 60)}`);
    const res = await fetch(`${RELAY}/d1/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
      body: JSON.stringify({ sql, params }),
    });
    // Text first: a 401 or an HTML error page is not JSON, and its status is the reason.
    const text = await res.text();
    if (!res.ok) throw new Error(`d1 HTTP ${res.status}: ${text.slice(0, 300)}`);
    let body;
    try { body = JSON.parse(text); } catch (_) { throw new Error(`d1 HTTP ${res.status}: not JSON: ${text.slice(0, 300)}`); }
    // /d1/execute answers { success, results: rows, meta } (src/index.js, the
    // /d1/execute route). Any other shape is a contract change, and reading it
    // as "no rows" would print a demand of zero for a read that never happened.
    if (body.success !== true || !Array.isArray(body.results)) throw new Error(`d1: unexpected body ${text.slice(0, 300)}`);
    return body.results;
  };

  const { days, note: windowNote } = closedDays(Date.now(), N);
  const pad = (d, n) => utcDay(Date.parse(d + 'T00:00:00Z') + n * DAY_MS);
  const lo = pad(days[0], -2), hi = pad(days[N - 1], 1);

  console.log(`=== odds per-consumer demand  utc=${new Date().toISOString()} ===`);
  console.log(`days: ${days[0]} .. ${days[N - 1]} (${N} closed UTC days)   games read for dates ${lo} .. ${hi}`);
  if (windowNote) console.log(windowNote);
  console.log('');

  const costs = costsFromSource();
  const amb = ambientFromSource(readSrc('src/ambient-do.js'));
  const wcGate = wcGateFromSource(readSrc('src/index.js'));
  const games = prepare(await d1(
    `SELECT id, sport, date, start_time, finalized_at, created_at, home, away, inplay_odds IS NOT NULL AS has_inplay
       FROM regular_season_games WHERE date BETWEEN ? AND ?
     UNION ALL
     SELECT id, sport, date, start_time, finalized_at, created_at, home, away, inplay_odds IS NOT NULL AS has_inplay
       FROM postseason_games WHERE date BETWEEN ? AND ?`, [lo, hi, lo, hi]));
  if (!games.length) {
    console.log(`FAIL: no game rows for ${lo} .. ${hi}. An absent schedule is not a demand of zero.`);
    process.exit(1);
  }
  const closingWrites = await d1(
    `SELECT game_id, ts FROM change_log WHERE field = 'closing_odds' AND ts >= ?`, [pad(lo, -1)]);
  const durSample = await d1(
    `SELECT sport, start_time, finalized_at FROM regular_season_games
      WHERE date BETWEEN ? AND ? AND start_time IS NOT NULL AND finalized_at IS NOT NULL`, [pad(days[0], -60), days[N - 1]]);
  const lastWc = (await d1(`SELECT MAX(date) AS last FROM regular_season_games WHERE sport = 'FIFA World Cup'`))[0]?.last ?? null;
  const charged = await d1(`SELECT day, site, used FROM odds_budget_site WHERE day BETWEEN ? AND ?`, [days[0], days[N - 1]]);
  const kept = await d1(`SELECT day, site, SUM(credits_kept) AS kept FROM odds_reconcile_state
                          WHERE day BETWEEN ? AND ? GROUP BY day, site`, [days[0], days[N - 1]]);
  const daily = await d1(`SELECT day, used FROM odds_budget WHERE day BETWEEN ? AND ?`, [days[0], days[N - 1]]);

  const spendOf = (rows, col) => {
    const m = {};
    for (const r of rows) (m[r.site] ||= {})[r.day] = Number(r[col]) || 0;
    return m;
  };
  const C = spendOf(charged, 'used'), K = spendOf(kept, 'kept');
  const liveMin = liveMinutesByKey(durSample);
  const hist = historicalClosingDemand(games, closingWrites, days, costs.fetchSportOddsHistorical.cost);

  const served = [
    ['ambientCaptureClosingOdds', closingCaptureDemand(games, days, costs.ambientCaptureClosingOdds.cost)],
    ['handleCFLOddsProbs', cflDemand(games, days, costs.handleCFLOddsProbs.cost)],
    ['fetchSportOddsLive', openingSnapshotDemand(games, days, costs.fetchSportOddsLive.cost)],
    ['fetchSportOddsHistorical', hist],
    ['getWCPregameLambdas', wcLambdaDemand(games, days, costs.getWCPregameLambdas.cost)],
    ['handleWCOddsProbs', wcProbsDemand(lastWc, wcGate, days, costs.handleWCOddsProbs.cost)],
    ['oddsProxyRoute', Object.fromEntries(days.map(d => [d, { demand: 0, units: 0, note: 'no FIELD consumer' }]))],
    ['wpResolver', Object.fromEntries(days.map(d => [d, { demand: null, units: null, note: 'pick volume not readable from CI' }]))],
  ];
  const liveIfServed = liveOddsDemandIfServed(games, days, costs.ambientFetchLiveOdds.cost, liveMin, amb.cooldownOn);

  const pad6 = (v) => String(v ?? '—').padStart(6);
  for (const [site, model] of served) {
    const cost = costs[site] ? `${costs[site].cost} credits/call  ${costs[site].url}` : '';
    console.log(`── ${site}  ${cost}`);
    console.log(`  day          demand  charged    kept   charged/demand  kept/demand   units`);
    for (const d of days) {
      const m = model[d], c = C[site]?.[d] ?? 0, k = K[site]?.[d] ?? 0;
      console.log(`  ${d}  ${pad6(m.demand)}  ${pad6(c)}  ${pad6(k)}   ${ratio(c, m.demand).padStart(14)}  ${ratio(k, m.demand).padStart(11)}   ${m.note}`);
    }
    console.log('');
  }
  const unwritableTot = days.reduce((s, d) => s + hist[d].unwritable, 0);
  console.log(`  fetchSportOddsHistorical: ${unwritableTot} credits of units in ${[...JOIN_UNWRITABLE.keys].join(', ')} are`);
  console.log(`  printed as "unwritable" and kept out of demand: the join cannot write their closing line`);
  console.log(`  (as of ${JOIN_UNWRITABLE.asOf}, ${JOIN_UNWRITABLE.doc}). Their fetches are inside "charged".\n`);

  console.log(`── ambientFetchLiveOdds  ${costs.ambientFetchLiveOdds.cost} credits/call  ${costs.ambientFetchLiveOdds.url}`);
  console.log(`  ${amb.liveDisabled ? 'UNSERVED: ODDS_LIVE_PATH_404 is true in src/ambient-do.js, so this path never calls the vendor.' : 'SERVED: ODDS_LIVE_PATH_404 is false.'}`);
  console.log(`  Demand IF SERVED = live minutes per sport / _getOddsCooldown x cost. Not added to any total below.`);
  console.log(`  live window per sport = median(finalized_at - start_time) over ${durSample.length} finals since ${pad(days[0], -60)}:`);
  for (const [k, v] of Object.entries(liveMin).sort()) console.log(`    ${k.padEnd(28)} ${Math.round(v.minutes)} min  (n=${v.n})`);
  console.log(`  day          if-served  charged    kept`);
  for (const d of days) console.log(`  ${d}  ${pad6(liveIfServed[d].demand).padStart(9)}  ${pad6(C.ambientFetchLiveOdds?.[d] ?? 0)}  ${pad6(K.ambientFetchLiveOdds?.[d] ?? 0)}   ${liveIfServed[d].note}`);
  console.log('');

  // The summary the done condition names: demand next to spend, ratio stated.
  console.log(`── ${N}-day summary`);
  console.log(`  consumer                     demand  charged     kept   charged/demand  kept/demand`);
  const tot = { demand: 0, charged: 0, kept: 0, unknownCharged: 0 };
  for (const [site, model] of served) {
    const dem = days.some(d => model[d].demand == null) ? null : days.reduce((s, d) => s + model[d].demand, 0);
    const c = days.reduce((s, d) => s + (C[site]?.[d] ?? 0), 0), k = days.reduce((s, d) => s + (K[site]?.[d] ?? 0), 0);
    if (dem == null) tot.unknownCharged += c; else { tot.demand += dem; tot.charged += c; tot.kept += k; }
    console.log(`  ${site.padEnd(26)}  ${pad6(dem)}  ${String(c).padStart(7)}  ${String(k).padStart(7)}   ${ratio(c, dem).padStart(14)}  ${ratio(k, dem).padStart(11)}`);
  }
  console.log(`  ${'MODELLED TOTAL'.padEnd(26)}  ${pad6(tot.demand)}  ${String(tot.charged).padStart(7)}  ${String(tot.kept).padStart(7)}   ${ratio(tot.charged, tot.demand).padStart(14)}  ${ratio(tot.kept, tot.demand).padStart(11)}`);
  const liveTot = days.reduce((s, d) => s + liveIfServed[d].demand, 0);
  console.log(`  fetchSportOddsHistorical, unwritable: ${unwritableTot} credits, outside the total above`);
  console.log(`  ambientFetchLiveOdds, IF SERVED: ${liveTot} credits over ${N} days (${Math.round(liveTot / N)}/day), outside the total above`);
  // Spend on a site no row above names (unattributed, or a site added to the
  // worker after this script) is printed, never dropped from the reader's view.
  const named = new Set([...served.map(([s]) => s), 'ambientFetchLiveOdds']);
  for (const site of Object.keys(C).filter(s => !named.has(s))) {
    console.log(`  ${site}: charged ${days.reduce((s, d) => s + (C[site][d] ?? 0), 0)} with no demand model`);
  }

  // The per-site counter against the daily counter it splits. The charge is one
  // batch (5edb19ad), but a reconcile refund is dated when its fetch returns, so
  // the two can differ on a day; that is a ledger finding, printed, not a bad
  // read. Site rows on a day with no daily row at all IS a bad read.
  const dayTot = Object.fromEntries(daily.map(r => [r.day, Number(r.used) || 0]));
  let orphan = 0;
  for (const d of days) {
    const s = Object.values(C).reduce((a, m) => a + (m[d] ?? 0), 0);
    if (!(d in dayTot)) { if (s) { orphan++; console.log(`  READ: ${d} has site rows summing ${s} and no odds_budget row`); } continue; }
    if (s !== dayTot[d]) console.log(`  LEDGER: ${d} sites sum ${s}, odds_budget ${dayTot[d]} (${s - dayTot[d] > 0 ? '+' : ''}${s - dayTot[d]})`);
  }
  const unpriced = games.filter(g => !Number.isFinite(g.startMs)).length;
  console.log(`\nCOVERAGE: ${served.length - 1} of 9 consumers have a demand model; wpResolver is UNKNOWN (charged ${tot.unknownCharged}`);
  console.log(`in ${N} days) and ambientFetchLiveOdds is printed IF SERVED, apart. ${games.length} game rows read, ${unpriced} with`);
  console.log(`no usable start_time: the CFL day count and the World Cup upper bound read them; every`);
  console.log(`other model skips them. Demand is a FLOOR of need under each model stated in the header`);
  console.log(`— a cadence above it is a product choice, not measured need. CI-triggered calls (probes,`);
  console.log(`the deploy step) are traffic and sit inside "charged", not "demand". The vendor may not`);
  console.log(`list every scheduled game (preseason, unlisted leagues); such games still count as demand.`);
  if (orphan) { console.log(`\nFAIL: ${orphan} day(s) with site spend and no daily row — the read does not stand.`); process.exit(1); }
}

// Only when run, never when imported: importing the watch script earlier on
// 2026-10-21 ran its top-level read against the live relay by accident.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);
  else if (process.argv.includes('--mutate')) process.exit(mutate());
  else await measure();
}
