#!/usr/bin/env node
// Enumerated assertions for src/odds-name-match.js. Offline, 0 credits.
//
// Two corpora, because the fixture cannot exercise everything:
//
//   A. outbox/fixture-cfb-2026-09-12.json — 80 archive rows, 95 vendor events,
//      bought once for 20 credits. Asserts exact counts AND names the 7 rows
//      that must remain unmatched, so a change that "improves" the number by
//      matching the wrong thing still fails.
//
//   B. a synthetic corpus for ambiguity and orientation swap. The fixture has
//      zero of each, so a mutation that deletes the ambiguity guard or the swap
//      branch would survive corpus A. Rule 90's corollary: a mutation that
//      cannot be caught means the check is missing a case, not that the guard
//      is safe.
//
// The kickoff instant appears here ONLY as an independent cross-check on
// pairings the names already chose — never as a filter. See the module header.

import fs from 'node:fs';
import { teamTokens, nameMatches, findVendorEvent, h2hPrices, slateWindow, matchSlate,
  couldAbbreviate, pairOrientation, pricesByTeam, kickoffGapMinutes,
  KICKOFF_REFUSE_MINUTES, CONTESTED_KICKOFF_MINUTES } from '../src/odds-name-match.js';

const FIXTURE = 'outbox/fixture-cfb-2026-09-12.json';
let failed = 0;
const ok  = (m) => console.log(`  PASS  ${m}`);
const bad = (m, got, want) => { failed++; console.log(`  FAIL  ${m}\n          got  ${got}\n          want ${want}`); };
const eq  = (m, got, want) => (String(got) === String(want) ? ok(`${m} = ${got}`) : bad(m, got, want));

console.log('=== odds team-name matcher ===\n');

// ── A. the CFB fixture ──────────────────────────────────────────────────────
const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
console.log(`A. ${FIXTURE}  (${fx.archive.length} archive rows, ${fx.vendor.length} vendor events)`);

const inst = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : null; };
let solved = 0, ambiguous = 0, swaps = 0, instAgree = 0;
const unmatched = [], instDiffer = [];
for (const g of fx.archive) {
  const r = findVendorEvent(g, fx.vendor);
  if (r.ambiguous) { ambiguous++; continue; }
  if (!r.event) { unmatched.push(`${g.away} @ ${g.home}`); continue; }
  solved++;
  if (r.swapped) swaps++;
  const d = inst(r.event.commence_time) - inst(g.start_time);
  if (d === 0) instAgree++; else instDiffer.push(`${g.away} @ ${g.home} ${d / 60000}min`);
}
eq('solved',    solved,    73);
eq('ambiguous', ambiguous, 0);
eq('unmatched', unmatched.length, 7);
eq('orientation swaps', swaps, 0);

// Naming the residue is the half that stops a wrong "improvement" passing.
const EXPECT_UNMATCHED = [
  'Western KY @ Georgia', 'ETSU @ North Carolina', 'GA Southern @ Clemson',
  'Navy @ FAU', 'Buffalo @ FIU', 'Jax State @ Ohio', 'MTSU @ Marshall',
].sort();
const gotUnmatched = [...unmatched].sort();
String(gotUnmatched) === String(EXPECT_UNMATCHED)
  ? ok(`the 7 unmatched are exactly the known initialisms`)
  : bad('unmatched set', gotUnmatched.join(' | '), EXPECT_UNMATCHED.join(' | '));

// The cross-check: names chose 73, and the kickoff instant independently
// agrees on 68 of them. The 5 that differ are named, so a silent drift shows.
eq('instant agrees', instAgree, 68);
eq('instant differs', instDiffer.length, 5);
const EXPECT_DIFFER = [
  'Arkansas @ Utah -15min', 'Southern Miss @ Auburn -65min', 'Oregon @ Oklahoma St -90min',
  'Prairie View @ Baylor -8min', "New Mexico St @ Hawai'i 1min",
].sort();
String([...instDiffer].sort()) === String(EXPECT_DIFFER)
  ? ok('the 5 kickoff disagreements are the known ones')
  : bad('kickoff disagreements', [...instDiffer].sort().join(' | '), EXPECT_DIFFER.join(' | '));

// The regression this whole change exists for.
const wholeStringEq = (a, b) => teamTokens(a).join('') === teamTokens(b).join('');
let oldMatcher = 0;
for (const g of fx.archive)
  if (fx.vendor.some(e => wholeStringEq(g.home, e.home_team) && wholeStringEq(g.away, e.away_team))) oldMatcher++;
eq('the equality matcher this replaces', oldMatcher, 0);

// ── B. synthetic: ambiguity and swap ────────────────────────────────────────
console.log('\nB. synthetic corpus (the fixture has 0 of each)');

const AMBIG_EVENTS = [
  { home_team: 'Ohio Bobcats',        away_team: 'Buffalo Bulls' },
  { home_team: 'Ohio State Buckeyes', away_team: 'Buffalo Bulls' },
];
const amb = findVendorEvent({ home: 'Ohio', away: 'Buffalo' }, AMBIG_EVENTS);
amb.ambiguous && amb.event === null && amb.candidates.length === 2
  ? ok('two candidates -> ambiguous, event null, never a guess')
  : bad('ambiguity guard', JSON.stringify({ a: amb.ambiguous, e: !!amb.event, n: amb.candidates.length }),
        '{ambiguous:true, event:null, candidates:2}');

// "Ohio State" must still resolve against the same two — the guard must not be
// a blanket refusal whenever a prefix collision exists in the payload.
const okState = findVendorEvent({ home: 'Ohio State', away: 'Buffalo' }, AMBIG_EVENTS);
okState.event?.home_team === 'Ohio State Buckeyes' && !okState.ambiguous
  ? ok('the longer name still resolves against the same colliding payload')
  : bad('collision is not a blanket refusal', okState.event?.home_team ?? 'null', 'Ohio State Buckeyes');

const SWAP_EVENTS = [{ home_team: 'Toledo Rockets', away_team: 'Central Connecticut Blue Devils' }];
const sw = findVendorEvent({ home: 'C Connecticut', away: 'Toledo' }, SWAP_EVENTS);
sw.event && sw.swapped === true
  ? ok('reversed orientation matches and is flagged swapped')
  : bad('swap branch', JSON.stringify({ e: !!sw.event, s: sw.swapped }), '{event:true, swapped:true}');

const none = findVendorEvent({ home: 'Georgia', away: 'Alabama' }, SWAP_EVENTS);
!none.event && !none.ambiguous
  ? ok('no counterpart -> event null, not ambiguous')
  : bad('empty case', JSON.stringify(none), '{event:null, ambiguous:false}');

// Token-level pairs, each a real row from the fixture or its failure mode.
const PAIRS = [
  ['N Colorado',    'Northern Colorado Bears',        true,  'single-letter direction token'],
  ['Illinois St',   'Illinois State Redbirds',        true,  'St -> State'],
  ["Hawai'i",       'Hawaii Rainbow Warriors',        true,  'apostrophe removed, not split on'],
  ['Michigan St',   'Michigan State Spartans',        true,  'two expansions in one name'],
  ['Western KY',    'Western Kentucky Hilltoppers',   false, 'postal code is not a prefix — a known residue'],
  ['MTSU',          'Middle Tennessee Blue Raiders',  false, 'initialism — a known residue'],
  ['Georgia',       'Georgia Southern Eagles',        true,  'PREFIX IS PERMISSIVE: pair + ambiguity guard carries this, not the predicate'],
  ['Georgia Tech',  'Georgia Bulldogs',               false, 'second token disagrees'],
  ['Ohio State Buckeyes', 'Ohio State',                false, 'MORE archive tokens than vendor: refuse, do not read past the end'],
  ['',              'Tampa Bay Rays',                false, 'an EMPTY archive name must match nothing: every() on [] is vacuously true'],
  ['   ',           'Tampa Bay Rays',                false, 'whitespace tokenises to [] — same trap'],
];
for (const [a, v, want, why] of PAIRS) {
  const got = nameMatches(a, v);
  got === want ? ok(`"${a}" ~ "${v}" = ${got}  (${why})`)
               : bad(`"${a}" ~ "${v}"  (${why})`, got, want);
}

// ── C. h2h price reading ────────────────────────────────────────────────────
console.log('\nC. h2h price reading');

const EV = { home_team: 'Georgia Bulldogs', away_team: 'Western Kentucky Hilltoppers' };
const OUT = [
  { name: 'Georgia Bulldogs', price: -2500 },
  { name: 'Western Kentucky Hilltoppers', price: 1200 },
];
const px = h2hPrices(OUT, EV);
eq('home price keyed off the vendor name', px.home, -2500);
eq('away price keyed off the vendor name', px.away, 1200);
eq('no draw in an h2h college market', String(px.draw), 'null');

// The defect this replaces: keying off the ARCHIVE's name returns nothing.
const archiveKeyed = OUT.find(o => teamTokens(o.name).join('') === teamTokens('Georgia').join(''));
eq('the archive-keyed lookup this replaces', String(archiveKeyed ?? null), 'null');

// Orientation: the prices must follow the event, not the argument order.
const flipped = h2hPrices(OUT, { home_team: EV.away_team, away_team: EV.home_team });
flipped.home === 1200 && flipped.away === -2500
  ? ok('reversing the event reverses the prices')
  : bad('orientation', `${flipped.home}/${flipped.away}`, '1200/-2500');

const soccer = h2hPrices(
  [{ name: 'Arsenal', price: 150 }, { name: 'Chelsea', price: 200 }, { name: 'Draw', price: 240 }],
  { home_team: 'Arsenal', away_team: 'Chelsea' });
eq('draw price on a soccer market', soccer.draw, 240);

const missing = h2hPrices([{ name: 'Someone Else', price: 100 }], EV);
missing.home === null && missing.away === null
  ? ok('an outcome list naming neither team yields nulls, not a wrong price')
  : bad('absent outcomes', `${missing.home}/${missing.away}`, 'null/null');

// ── D. the slate matcher: window + elimination ──────────────────────────────
console.log('\nD. slate window and elimination');

const slate = matchSlate(fx.archive, fx.vendor, fx.date);
eq('events dropped as out-of-window', slate.droppedOutOfWindow, 15);
eq('in-window pool',                  slate.poolSize,           80);
eq('stage 1 (both sides, unique)',    slate.stage1,             73);
eq('stage 2 (one side + elimination)',slate.stage2,              7);
eq('unmatched',                       slate.unmatched,           0);
eq('ambiguous',                       slate.ambiguous,           0);

// The 7 stage-2 rows are exactly the initialisms stage 1 cannot read. Naming
// them stops a change that raises the count by forcing the WRONG event.
const FORCED = {
  'Western KY @ Georgia':      'Western Kentucky Hilltoppers @ Georgia Bulldogs',
  'ETSU @ North Carolina':     'East Tennessee State Buccaneers @ North Carolina Tar Heels',
  'GA Southern @ Clemson':     'Georgia Southern Eagles @ Clemson Tigers',
  'Navy @ FAU':                'Navy Midshipmen @ Florida Atlantic Owls',
  'Buffalo @ FIU':             'Buffalo Bulls @ Florida International Panthers',
  'Jax State @ Ohio':          'Jacksonville State Gamecocks @ Ohio Bobcats',
  'MTSU @ Marshall':           'Middle Tennessee Blue Raiders @ Marshall Thundering Herd',
};
let forcedOk = 0, zeroDelta = 0;
for (const g of fx.archive) {
  const m = slate.byGameId.get(g.id);
  if (!m || m.stage !== 2) continue;
  const key = `${g.away} @ ${g.home}`;
  const got = `${m.event.away_team} @ ${m.event.home_team}`;
  got === FORCED[key] ? forcedOk++ : bad(`stage-2 pairing for ${key}`, got, FORCED[key] ?? '(not an expected stage-2 row)');
  if (inst(m.event.commence_time) - inst(g.start_time) === 0) zeroDelta++;
}
eq('stage-2 pairings matching the named expectation', forcedOk, 7);
// The cross-check, on the weaker evidence: a forced pairing rests on ONE side's
// name, so the kickoff agreeing independently is what makes it credible.
eq('of those, confirmed by exact kickoff equality', zeroDelta, 6);

// GA Southern is the one that is not zero, and it is the reason the window
// exists: without it the payload offers a second Clemson game a week later.
const gaS = fx.archive.find(g => g.away === 'GA Southern');
const gaM = slate.byGameId.get(gaS.id);
eq('GA Southern kickoff delta (min)', (inst(gaM.event.commence_time) - inst(gaS.start_time)) / 60000, -120);
const clemsons = fx.vendor.filter(e => /Clemson/.test(e.home_team));
eq('Clemson home events in the raw payload', clemsons.length, 2);
eq('Clemson home events after windowing', slateWindow(clemsons, fx.date).length, 1);

// ── D2. a SECOND sport, because one was not enough ─────────────────────────
//
// The index-0 predicate scored 73/80 here and 0 of 26 in production on
// 2026-09-15 (run 35110321483, 80 credits, nothing filled). CFB puts the school
// in prefix position; MLB holds the nickname ALONE and the vendor prefixes a
// city of varying length. One sport-date could not see that, and the coverage
// line saying "one sport-date" did not stop it shipping.
console.log('\nD2. a second sport — the one the cron actually runs daily');

const mlb = JSON.parse(fs.readFileSync('outbox/fixture-mlb-2026-09-15.json', 'utf8'));
const ms = matchSlate(mlb.archive, mlb.vendor, mlb.date);
eq('MLB archive rows',        mlb.archive.length, 15);
eq('MLB stage 1',             ms.stage1,          15);
eq('MLB stage 2',             ms.stage2,           0);
eq('MLB unmatched',           ms.unmatched,        0);
eq('MLB ambiguous',           ms.ambiguous,        0);

// The three offsets that broke index-0 anchoring, named so a future change
// cannot pass by matching only the easy one.
const OFFSETS = [
  ['Rays',      'Tampa Bay Rays',       'nickname at index 2'],
  ['Guardians', 'Cleveland Guardians',  'index 1'],
  ['Athletics', 'Athletics',            'index 0 — no city at all'],
  ['White Sox', 'Chicago White Sox',    'a two-token nickname at index 1'],
];
for (const [a, v, why] of OFFSETS) {
  nameMatches(a, v) ? ok(`"${a}" ~ "${v}"  (${why})`)
                    : bad(`"${a}" ~ "${v}"  (${why})`, false, true);
}
// And the window must stay CONTIGUOUS: tokens may not be matched out of order
// or with gaps, or "Red Sox" would find "Red ... Sox" across unrelated names.
nameMatches('Red Jays', 'Boston Red Sox Toronto Blue Jays') === false
  ? ok('a non-contiguous token run does not match')
  : bad('contiguity', true, false);

// ── E. it must degrade safely, and that is tested, not assumed ──────────────
console.log('\nE. adversarial — elimination under a gap on either side');

const stage2Rows = fx.archive.filter(g => slate.byGameId.get(g.id)?.stage === 2);
const ids = stage2Rows.map(g => slate.byGameId.get(g.id).event.id);
eq('the 7 forced pairings claim 7 DISTINCT events', new Set(ids).size, 7);

// An archive gap must not let a surviving row take the missing row's event.
let misforced = 0;
for (const drop of fx.archive) {
  const r = matchSlate(fx.archive.filter(g => g.id !== drop.id), fx.vendor, fx.date);
  const truth = slate.byGameId.get(drop.id)?.event;
  if (!truth) continue;
  for (const g of fx.archive) {
    if (g.id === drop.id) continue;
    const m = r.byGameId.get(g.id);
    if (m && m.event.id === truth.id) { misforced++; break; }
  }
}
eq('archive rows dropped one at a time -> mis-forced', misforced, 0);

// A vendor gap must make the row UNMATCHED, not send it to a substitute.
let substituted = 0;
for (const g of stage2Rows) {
  const real = slate.byGameId.get(g.id).event;
  const r = matchSlate(fx.archive, fx.vendor.filter(e => e.id !== real.id), fx.date);
  if (r.byGameId.has(g.id)) substituted++;
}
eq('forced events removed one at a time -> substituted', substituted, 0);

// A row with SEVERAL stage-2 candidates is refused. The fixture cannot reach
// this — after windowing, each of its 7 residual rows has exactly one — so
// without this case a mutation that takes the first candidate survives. The
// collision is real in CFB: "Ohio" prefixes both Ohio Bobcats and Ohio State
// Buckeyes, "Miami" both Hurricanes and RedHawks.
const MANY_EVENTS = [
  { id: 'e1', home_team: 'Ohio Bobcats',       away_team: 'Kent State Golden Flashes',
    commence_time: '2026-09-12T18:00:00Z' },
  { id: 'e2', home_team: 'Ohio State Buckeyes', away_team: 'Rice Owls',
    commence_time: '2026-09-12T20:00:00Z' },
];
// away "ETSU" matches neither, so stage 1 cannot pair it and stage 2 sees two.
const many = matchSlate([{ id: 'g1', home: 'Ohio', away: 'ETSU' }], MANY_EVENTS, '2026-09-12');
many.byGameId.size === 0 && many.unmatched === 1
  ? ok('one row, two stage-2 candidates -> refused, not taken by payload order')
  : bad('multi-candidate stage-2 row',
        `matched ${many.byGameId.size} (${[...many.byGameId.values()].map(m => m.event.id).join()})`,
        'matched 0, unmatched 1');

// Since the stage-2 side rule (2026-10-19) the case above is ALSO refused by
// that rule, since "ETSU" cannot be Kent State, so it stopped isolating the
// exactly-one requirement: mutation M17 went NOT CAUGHT. It stays as it is; this
// case isolates the requirement again. "KSU" could abbreviate either opponent,
// so only the candidate count can refuse it.
const MANY_K = [
  { id: 'k1', home_team: 'Ohio Bobcats',        away_team: 'Kent State Golden Flashes',
    commence_time: '2026-09-12T18:00:00Z' },
  { id: 'k2', home_team: 'Ohio State Buckeyes', away_team: 'Kansas State Wildcats',
    commence_time: '2026-09-12T20:00:00Z' },
];
const manyK = matchSlate([{ id: 'g1', home: 'Ohio', away: 'KSU' }], MANY_K, '2026-09-12');
manyK.byGameId.size === 0 && manyK.contradicted === 0
  ? ok('two stage-2 candidates the side rule cannot tell apart -> refused for the count alone')
  : bad('multi-candidate row, side rule satisfied by both',
        `matched ${manyK.byGameId.size}, contradicted ${manyK.contradicted}`, 'matched 0, contradicted 0');

// Two rows that would force the SAME event are both refused, not ordered.
const COLLIDE_EVENTS = [{ id: 'x1', home_team: 'Ohio Bobcats', away_team: 'Kent State Golden Flashes',
                          commence_time: '2026-09-12T18:00:00Z' }];
const COLLIDE_GAMES = [{ id: 'a', home: 'Ohio', away: 'ZZZ Nobody' },
                       { id: 'b', home: 'Ohio', away: 'YYY Nobody' }];
const col = matchSlate(COLLIDE_GAMES, COLLIDE_EVENTS, '2026-09-12');
col.byGameId.size === 0 && col.ambiguous === 2
  ? ok('two rows forcing one event -> both refused, neither wins by order')
  : bad('collision', `matched ${col.byGameId.size}, ambiguous ${col.ambiguous}`, 'matched 0, ambiguous 2');

// No date: the window changes nothing rather than dropping everything.
eq('slateWindow with no date returns the payload whole', slateWindow(fx.vendor, null).length, fx.vendor.length);

// ── F. stage 2 may not pair against a contradicting side ───────────────────
//
// docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md task 1. Real rows: every
// odds_history row stored since the shared matcher landed, exported from D1 on
// 2026-10-19 (outbox/fixture-odds-pairs-2026-10-19.json, 776 rows; its `meta`
// holds the SELECT and the aggregates it was checked against).
console.log('\nF. stage 2 — the unread side must be able to be that team (real rows)');

const PX = 'outbox/fixture-odds-pairs-2026-10-19.json';
const pairs = JSON.parse(fs.readFileSync(PX, 'utf8')).rows;
eq('rows in the export', pairs.length, 776);

// The real 2026-09-19 slate, reduced to the rows involved: Georgia @ Arkansas
// took Jacksonville State's event, and that event's own game went unpriced.
const GA_EVENT = { id: 'ga', home_team: 'Jacksonville State Gamecocks', away_team: 'Georgia Southern Eagles',
                   commence_time: '2026-09-19T23:02:23Z' };
const ga = matchSlate([
  { id: 'CFB_2026-09-19_e401856686', home: 'Arkansas',  away: 'Georgia' },
  { id: 'CFB_2026-09-19_e401869948', home: 'Jax State', away: 'GA Southern' },
], [GA_EVENT], '2026-09-19');
ga.byGameId.size === 0 && ga.contradicted === 1
  ? ok('Georgia @ Arkansas is refused Jacksonville State\'s event (the 2026-09-19 wrong pair)')
  : bad('Georgia @ Arkansas', `paired ${ga.byGameId.size}, contradicted ${ga.contradicted}`, 'paired 0, contradicted 1');

// Every one-sided stored pair, on its own reduced slate. These are the rows
// stage 2 actually produced. The 11 refused for being another team's game are
// named, and so is the one right pair the rule costs.
const OTHER_GAME = [
  'CFB_2026-09-19_e401856686_draftkings_close',   // Arkansas    <- Jacksonville State Gamecocks
  'MLB_2026-09-16_e401816961_fanduel_close',      // Blue Jays   <- Chicago White Sox
  'MLB_2026-09-17_e401816975_fanduel_close',      // Brewers     <- Kansas City Royals
  'MLB_2026-09-20_e401817020_fanduel_close',      // Rangers     <- Baltimore Orioles
  'MLB_2026-09-20_e401817021_fanduel_close',      // Cardinals   <- Detroit Tigers
  'MLB_2026-09-24_e401817063_fanduel_close',      // Pirates     <- Milwaukee Brewers
  'MLB_2026-09-24_e401817065_fanduel_close',      // White Sox   <- Cleveland Guardians
  'MLB_2026-09-24_e401817067_fanduel_close',      // Rangers     <- Washington Nationals
  'NHL_2026-10-04_e401892442_draftkings_close',   // Red Wings   <- Pittsburgh Penguins
  'NHL_2026-10-10_e401892470_draftkings_close',   // Devils      <- New York Rangers
  'NHL_2026-10-12_e401892485_draftkings_close',   // Sabres      <- Columbus Blue Jackets
];
const COST = ['EFL Cup_2026-08-25_doncaster_boro_targeted'];   // Boro <- Middlesbrough: a nickname
const oneSided = pairs.filter(r => {
  const hh = nameMatches(r.a_home, r.v_home), aa = nameMatches(r.a_away, r.v_away);
  const ah = nameMatches(r.a_away, r.v_home), ha = nameMatches(r.a_home, r.v_away);
  return !((hh && aa) || (ah && ha)) && (hh || aa || ah || ha);
});
eq('one-sided stored pairs (the stage-2 class)', oneSided.length, 49);
const refusedIds = [], keptWrong = [];
let keptRight = 0;
for (const r of oneSided) {
  const s1 = matchSlate([{ id: r.id, home: r.a_home, away: r.a_away }],
    [{ id: 'ev', home_team: r.v_home, away_team: r.v_away, commence_time: r.commence_time }], r.date);
  const m = s1.byGameId.get(r.id);
  if (!m) refusedIds.push(r.id);
  else if (m.stage === 2) keptRight++;
  else keptWrong.push(`${r.id} paired at stage ${m.stage}`);
}
String([...refusedIds].sort()) === String([...OTHER_GAME, ...COST].sort())
  ? ok(`refused exactly the 11 other-game pairs and the 1 named cost (${refusedIds.length} of ${oneSided.length})`)
  : bad('refused set', [...refusedIds].sort().join(' | '), [...OTHER_GAME, ...COST].sort().join(' | '));
eq('right pairs still paired at stage 2', keptRight, 37);
eq('one-sided rows paired at another stage', keptWrong.length, 0);

// The other-game pairs share a signature the kickoff cross-check sees and the
// rule does not use: every one is more than 7 hours off. Independent evidence
// that the refused 11 are wrong, recorded rather than filtered on.
const gapMin = (r) => (Date.parse(r.commence_time) - Date.parse(r.start_time)) / 60000;
eq('of the 11, kickoff gaps over 420 minutes',
  pairs.filter(r => OTHER_GAME.includes(r.id) && gapMin(r) > 420).length, 11);

// REFUSING MAY ONLY REMOVE PAIRS. A refused row keeps its claim on the event,
// so the row it collides with is refused too, as before the rule existed.
// Dropping the refused proposal earlier would hand the event to the other row.
const clash = matchSlate([
  { id: 'arkansas', home: 'Arkansas',  away: 'Georgia' },   // refused by the rule
  { id: 'jax',      home: 'Jax State', away: 'Georgia' },   // passes the rule on its own
], [GA_EVENT], '2026-09-19');
clash.byGameId.size === 0 && clash.ambiguous === 2 && clash.contradicted === 0
  ? ok('a refused row still collides: neither row takes the event')
  : bad('collision with a refused row', `paired ${clash.byGameId.size}, ambiguous ${clash.ambiguous}, contradicted ${clash.contradicted}`,
        'paired 0, ambiguous 2, contradicted 0');

// The FIRST vendor token, not any: "Yankees" shares a letter with "New York"'s
// second word. Same shape as the 7 MLB rows: one team right, the other a
// different team the next day.
const nyy = matchSlate([{ id: 'nyy', home: 'Yankees', away: 'Phillies' }],
  [{ id: 'nym', home_team: 'New York Mets', away_team: 'Philadelphia Phillies', commence_time: '2026-09-20T23:00:00Z' }],
  '2026-09-20');
nyy.byGameId.size === 0
  ? ok('"Yankees" cannot be New York Mets: the first letter is compared with the FIRST vendor word')
  : bad('first-token rule', 'paired', 'refused');

const ABBREV = [
  ['Jax State',     'Jacksonville State Gamecocks',     true,  'first letter kept'],
  ['UAlbany',       'Albany Great Danes',               true,  'contains the vendor\'s first word'],
  ['The Citadel',   'Citadel Bulldogs',                 true,  '"the" is not stripped; containment reads it'],
  ['ETSU',          'East Tennessee State Buccaneers',  true,  'an initialism keeps its first letter'],
  ['Arkansas',      'Jacksonville State Gamecocks',     false, 'the 2026-09-19 wrong pair'],
  ['Blue Jays',     'Chicago White Sox',                false, 'a nickname against another team'],
  ['Boro',          'Middlesbrough',                    false, 'the measured cost: a nickname, not an abbreviation'],
  ['',              'Albany Great Danes',               false, 'an empty name is nothing\'s abbreviation'],
  ['Alb',           'Albany Great Danes',               true,  'containment needs 4 letters; the first letter carries this'],
  ['Xalb',          'Alb Tigers',                       false, 'a 3-letter vendor word is too short to contain'],
];
for (const [a, v, want, why] of ABBREV) {
  const got = couldAbbreviate(a, v);
  got === want ? ok(`couldAbbreviate("${a}", "${v}") = ${got}  (${why})`)
               : bad(`couldAbbreviate("${a}", "${v}")  (${why})`, got, want);
}

// ── G. the sync gives each team its own price ──────────────────────────────
//
// Task 2. odds_history keeps the vendor's orientation; the sync must re-key it
// to the archive's teams. The real row priced Virginia at West Virginia's +870.
console.log('\nG. prices follow the team, not the position (real rows)');

const wvu = pairs.find(r => r.id === 'CFB_2026-09-19_e401856802_draftkings_close');
const wvuGame = { home: wvu.a_home, away: wvu.a_away };
const wvuRow  = { home_team: wvu.v_home, away_team: wvu.v_away, home_ml: wvu.home_ml, away_ml: wvu.away_ml };
eq('e401856802 archive home', wvu.a_home, 'Virginia');
eq('e401856802 vendor home',  wvu.v_home, 'West Virginia Mountaineers');
eq('e401856802 orientation', pairOrientation(wvuGame, wvuRow), 'swapped');
const wp = pricesByTeam(wvuGame, wvuRow);
wp && wp.home === 1.06 && wp.away === 9.7
  ? ok('Virginia gets 1.06 (its own price) and West Virginia 9.7')
  : bad('e401856802 prices by team', JSON.stringify(wp), '{home:1.06, away:9.7}');
// What the sync stored, from the same row: the archive home team carries +870.
eq('the stored game row it replaces (home)', wvu.opening_odds_ml_home, 870);

const straightRow = pairs.find(r => r.id === 'CFB_2026-09-19_e401864443_draftkings_close');  // Nevada @ MTSU, stage 2
const sp = pricesByTeam({ home: straightRow.a_home, away: straightRow.a_away },
  { home_team: straightRow.v_home, away_team: straightRow.v_away, home_ml: straightRow.home_ml, away_ml: straightRow.away_ml });
sp && sp.orientation === 'straight' && sp.home === straightRow.home_ml && sp.away === straightRow.away_ml
  ? ok('a straight stage-2 row (MTSU, one side readable) keeps its prices in place')
  : bad('straight stage-2 row', JSON.stringify(sp), `{straight, ${straightRow.home_ml}/${straightRow.away_ml}}`);

eq('unrelated names -> null, never a guess',
  String(pricesByTeam({ home: 'Georgia', away: 'Alabama' }, { home_team: 'Toledo Rockets', away_team: 'Kent State Golden Flashes', home_ml: 1.5, away_ml: 2.6 })), 'null');

// Every stored row: how many the sync can orient. A sync that skips rows it
// used to write would be a silent loss, so the count is pinned.
const ori = pairs.reduce((m, r) => {
  const o = pairOrientation({ home: r.a_home, away: r.a_away }, { home_team: r.v_home, away_team: r.v_away }) ?? 'null';
  m[o] = (m[o] || 0) + 1; return m;
}, {});
eq('stored rows oriented straight', ori.straight, 775);
eq('stored rows oriented swapped',  ori.swapped,  1);
eq('stored rows the sync would skip', ori.null ?? 0, 0);

// ── H. the collision corpus (CC-CMD-2026-09-11 task 1, never built) ────────
//
// Names where one school's name sits inside another's. The predicate matches
// both, by design (B above); the PAIR is what must choose.
console.log('\nH. collision corpus — one school\'s name inside another\'s');

const COLLIDE = [
  { why: 'Virginia / West Virginia, the real 2026-09-19 pairing, vendor reversed',
    games: [{ id: 'g', home: 'Virginia', away: 'West Virginia' }],
    events: [{ id: 'e', home_team: 'West Virginia Mountaineers', away_team: 'Virginia Cavaliers', commence_time: '2026-09-19T23:35:29Z' }],
    want: { g: ['e', true] } },
  { why: 'Virginia and West Virginia on one slate, each against its own opponent',
    games: [{ id: 'v', home: 'Virginia', away: 'NC State' }, { id: 'w', home: 'West Virginia', away: 'Coastal' }],
    events: [{ id: 'ev', home_team: 'Virginia Cavaliers', away_team: 'NC State Wolfpack', commence_time: '2026-09-05T23:00:00Z' },
             { id: 'ew', home_team: 'West Virginia Mountaineers', away_team: 'Coastal Carolina Chanticleers', commence_time: '2026-09-05T23:00:00Z' }],
    want: { v: ['ev', false], w: ['ew', false] } },
  { why: 'Georgia and Georgia Southern on one slate, both priced',
    games: [{ id: 'gb', home: 'Arkansas', away: 'Georgia' }, { id: 'gs', home: 'Jax State', away: 'GA Southern' }],
    events: [{ id: 'eb', home_team: 'Arkansas Razorbacks', away_team: 'Georgia Bulldogs', commence_time: '2026-09-19T16:00:00Z' },
             { id: 'es', home_team: 'Jacksonville State Gamecocks', away_team: 'Georgia Southern Eagles', commence_time: '2026-09-19T23:00:00Z' }],
    want: { gb: ['eb', false], gs: [null, false] } },   // GA Southern @ Jax State: both sides abbreviated, nothing to stand on
  { why: 'Miami and Miami (OH)',
    games: [{ id: 'm', home: 'Miami', away: 'Florida St' }, { id: 'o', home: 'Pitt', away: 'Miami OH' }],
    events: [{ id: 'em', home_team: 'Miami Hurricanes', away_team: 'Florida State Seminoles', commence_time: '2026-09-05T23:00:00Z' },
             { id: 'eo', home_team: 'Pittsburgh Panthers', away_team: 'Miami (OH) RedHawks', commence_time: '2026-09-05T23:00:00Z' }],
    want: { m: ['em', false], o: ['eo', false] } },
  { why: 'Washington and Washington State',
    games: [{ id: 'w1', home: 'Washington', away: 'Oregon' }, { id: 'w2', home: 'Washington St', away: 'Idaho' }],
    events: [{ id: 'e1', home_team: 'Washington Huskies', away_team: 'Oregon Ducks', commence_time: '2026-09-05T23:00:00Z' },
             { id: 'e2', home_team: 'Washington State Cougars', away_team: 'Idaho Vandals', commence_time: '2026-09-05T23:00:00Z' }],
    want: { w1: ['e1', false], w2: ['e2', false] } },
];
for (const c of COLLIDE) {
  const r = matchSlate(c.games, c.events, c.events[0].commence_time.slice(0, 10));
  const got = Object.fromEntries(c.games.map(g => { const m = r.byGameId.get(g.id); return [g.id, m ? [m.event.id, m.swapped] : [null, false]]; }));
  JSON.stringify(got) === JSON.stringify(c.want)
    ? ok(c.why) : bad(c.why, JSON.stringify(got), JSON.stringify(c.want));
}

// ── I. the kickoff may refuse (owner ruling 2026-10-19) ────────────────────
//
// docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md TASK 1, ruled (c) both, with
// "only the far twin" for the claim check. Real rows from the same export.
console.log('\nI. kickoff refusal and the claim check (real rows)');

eq('KICKOFF_REFUSE_MINUTES', KICKOFF_REFUSE_MINUTES, 720);
eq('CONTESTED_KICKOFF_MINUTES', CONTESTED_KICKOFF_MINUTES, 90);
const asGame = (r) => ({ id: r.game_id, home: r.a_home, away: r.a_away, start_time: r.start_time });
const asEvent = (r, id = 'ev') => ({ id, home_team: r.v_home, away_team: r.v_away, commence_time: r.commence_time });
const byRow = (id) => pairs.find(r => r.id === id);

// The next-day class: same two teams, the series' next game. Each one alone.
const NEXT_DAY = [
  'MLB_2026-09-19_e401817001_fanduel_close', 'MLB_2026-09-19_e401817002_fanduel_close',
  'MLB_2026-09-19_e401817004_fanduel_close', 'MLB_2026-09-22_e401817035_fanduel_close',
  'MLB_2026-09-26_e401817087_draftkings_close', 'MLB_2026-09-26_e401817090_fanduel_close',
  'MLB_2026-09-26_e401817091_draftkings_close', 'MLB_2026-09-26_e401817092_draftkings_close',
  'MLB_2026-09-29_e401907965_fanduel_close', 'MLB_2026-09-30_e401907972_draftkings_close',
  'MLB_2026-10-07_e401907992_draftkings_close', 'MLB_2026-10-15_e401908025_draftkings_close',
];
const bothSides = (r) => (nameMatches(r.a_home, r.v_home) && nameMatches(r.a_away, r.v_away))
  || (nameMatches(r.a_away, r.v_home) && nameMatches(r.a_home, r.v_away));
const overLimit = pairs.filter(r => bothSides(r) && Math.abs(kickoffGapMinutes(asGame(r), asEvent(r)) ?? 0) > KICKOFF_REFUSE_MINUTES)
  .map(r => r.id).sort();
String(overLimit) === String([...NEXT_DAY].sort())
  ? ok(`the both-sides pairs past ${KICKOFF_REFUSE_MINUTES} min are exactly the 12 next-day games`)
  : bad('pairs past the limit', overLimit.join(' | '), [...NEXT_DAY].sort().join(' | '));
let nextRefused = 0;
for (const id of NEXT_DAY) {
  const r = byRow(id), sl = matchSlate([asGame(r)], [asEvent(r)], r.date);
  if (!sl.byGameId.size && sl.lateKickoff === 1) nextRefused++;
}
eq('next-day games refused for the kickoff, each on its own slate', nextRefused, 12);

// Right pairs keep their pair: the largest gaps among both-sides pairs that are
// the right game. A rain delay (+235) and a moved start (+121) included.
const RIGHT_FAR = [
  'CFB_2026-09-05_e401856660_targeted',            // Clemson @ LSU, -130
  'MLB_2026-09-20_e401817019_fanduel_close',       // rain delay, +235
  'MLB_2026-09-26_e401817097_fanduel_close',       // moved start, +121
];
let rightKept = 0;
for (const id of RIGHT_FAR) {
  const r = byRow(id), sl = matchSlate([asGame(r)], [asEvent(r)], r.date);
  if (sl.byGameId.size === 1 && sl.lateKickoff === 0) rightKept++;
}
eq('right pairs 121 to 235 min off keep their pair', rightKept, RIGHT_FAR.length);

// One event, several games: each shared group from the export, on its own slate.
const groups = new Map();
for (const r of pairs) {
  const k = `${r.snapshot_type}|${r.v_home}|${r.v_away}|${r.commence_time}`;
  groups.set(k, [...(groups.get(k) || []), r]);
}
const shared = [...groups.values()].filter(g => g.length > 1);
eq('events stored against 2+ games', shared.length, 46);
const keptBy = (g) => {
  const sl = matchSlate(g.map(asGame), [asEvent(g[0])], g[0].date);
  return { sl, kept: g.filter(r => sl.byGameId.has(r.game_id)).map(r => r.game_id).sort() };
};
const DOUBLEHEADER = {                              // the near game keeps the event
  'MLB_2026-09-23_e401817050': 'MLB_2026-09-23_e401923610',
  'MLB_2026-09-25_e401817073': 'MLB_2026-09-25_e401817088',
  'MLB_2026-09-25_e401817074': 'MLB_2026-09-25_e401817104',
};
let dhOk = 0;
for (const [near, far] of Object.entries(DOUBLEHEADER)) {
  const g = shared.find(x => x.some(r => r.game_id === near) && x.some(r => r.game_id === far));
  const { sl, kept } = g ? keptBy(g) : { sl: {}, kept: [] };
  String(kept) === near && sl.sharedRefused === 1 ? dhOk++
    : bad(`doubleheader ${near} / ${far}`, `kept ${kept.join(',') || 'none'}, sharedRefused ${sl.sharedRefused}`, `kept ${near}, sharedRefused 1`);
}
eq('doubleheaders: the near game keeps the event, the far twin is refused', dhOk, 3);
const brewers = keptBy(shared.find(x => x.some(r => r.game_id === 'MLB_2026-09-19_e401817001')));
String(brewers.kept) === 'MLB_2026-09-20_e401817016' && brewers.sl.lateKickoff === 1 && brewers.sl.sharedRefused === 0
  ? ok('a next-day claimant is refused by the kickoff, and the day\'s own game keeps the event')
  : bad('Brewers @ Orioles 09-19/09-20', JSON.stringify({ kept: brewers.kept, late: brewers.sl.lateKickoff, shared: brewers.sl.sharedRefused }),
        'kept e401817016, late 1, shared 0');
const mls = shared.filter(g => g[0].sport === 'MLS');
const mlsAllKept = mls.filter(g => keptBy(g).kept.length === g.length).length;
eq('MLS fixtures archived twice: every copy keeps its pair', `${mlsAllKept} of ${mls.length}`, `${mls.length} of 42`);

// A refusal frees nothing. A refused game is not sent to elimination, and its
// event stays claimed: a refusal must never create a pair somewhere else.
const D = '2026-09-29', A = { id: 'A', home: 'Braves', away: 'Phillies', start_time: `${D}T18:00Z` };
const NEXT = { id: 'next', home_team: 'Atlanta Braves', away_team: 'Philadelphia Phillies', commence_time: '2026-09-30T18:00:00Z' };
const ELSE = { id: 'else', home_team: 'Boston Red Sox', away_team: 'Philadelphia Phillies', commence_time: `${D}T18:05:00Z` };
const B = { id: 'B', home: 'Braves', away: 'Phls' };       // no kickoff; could take NEXT by elimination
const free1 = matchSlate([A, B], [NEXT], D);
free1.byGameId.size === 0 && free1.lateKickoff === 1
  ? ok('a refused game\'s event stays claimed: no other row takes it by elimination')
  : bad('event freed by a refusal', [...free1.byGameId.keys()].join(',') || 'none', 'none paired, lateKickoff 1');
const free2 = matchSlate([A], [NEXT, ELSE], D);
free2.byGameId.size === 0
  ? ok('a refused game is not sent to elimination, where it would find another event')
  : bad('refused game re-paired', [...free2.byGameId.values()].map(m => m.event.id).join(','), 'none');

// Stage 2 is held to the same limit: an elimination a day away is refused.
const late2 = matchSlate([{ id: 'j', home: 'Jax State', away: 'Ohio', start_time: '2026-09-12T18:00Z' }],
  [{ id: 'jx', home_team: 'Jacksonville State Gamecocks', away_team: 'Ohio Bobcats', commence_time: '2026-09-13T18:00:00Z' }], '2026-09-12');
late2.byGameId.size === 0 && late2.lateKickoff === 1
  ? ok('stage 2: a forced pairing a day off is refused for the kickoff')
  : bad('stage-2 kickoff', `paired ${late2.byGameId.size}, late ${late2.lateKickoff}`, 'paired 0, late 1');

// A missing instant refuses nothing: it is counted elsewhere, never judged.
const unknown = matchSlate([{ id: 'u', home: 'Braves', away: 'Phillies' }], [NEXT], D);
unknown.byGameId.size === 1 && unknown.lateKickoff === 0
  ? ok('a game with no kickoff is not refused for lacking one')
  : bad('missing kickoff', `paired ${unknown.byGameId.size}, late ${unknown.lateKickoff}`, 'paired 1, late 0');
eq('kickoffGapMinutes on an unreadable instant', String(kickoffGapMinutes({ start_time: 'TBD' }, NEXT)), 'null');
// ── found by the 2026-10-20 adversarial review, each with a mutation ──────

// A claim counts before any refusal: a twin 206 off is refused even when the
// other claimant (751 off) was refused for its kickoff first.
const E2 = { id: 'E', home_team: 'New York Yankees', away_team: 'Baltimore Orioles', commence_time: '2026-09-25T23:31:00Z' };
const near206 = { id: 'A', home: 'Yankees', away: 'Orioles', start_time: '2026-09-25T20:05Z' };
const far751 = { id: 'B', home: 'Yankees', away: 'Orioles', start_time: '2026-09-25T11:00Z' };
const both = matchSlate([near206, far751], [E2], '2026-09-25');
both.byGameId.size === 0 && both.lateKickoff === 1 && both.sharedRefused === 1
  ? ok('a claimant refused for its kickoff still makes the event shared')
  : bad('claim counted before refusal', JSON.stringify({ paired: [...both.byGameId.keys()], late: both.lateKickoff, shared: both.sharedRefused }), 'paired none, late 1, shared 1');

// The near copy has no kickoff and the far twin is 206 off: still shared.
const blindNear = matchSlate([{ id: 'n', home: 'Yankees', away: 'Orioles' }, near206], [E2], '2026-09-25');
String([...blindNear.byGameId.keys()]) === 'n' && blindNear.sharedRefused === 1
  ? ok('a claimant without a kickoff still counts toward a shared event')
  : bad('claimant without kickoff', [...blindNear.byGameId.keys()].join(','), 'n only');

// The claim check is per event: a doubleheader elsewhere on the slate does not
// refuse a lone rain-delayed game (+235) on its own event.
const rain = { id: 'r', home: 'White Sox', away: 'Tigers', start_time: '2026-09-25T18:10Z' };
const rainEv = { id: 'R', home_team: 'Chicago White Sox', away_team: 'Detroit Tigers', commence_time: '2026-09-25T22:05:00Z' };
const nearDH = { id: 'n2', home: 'Yankees', away: 'Orioles', start_time: '2026-09-25T23:30Z' };
const perEvent = matchSlate([nearDH, near206, rain], [E2, rainEv], '2026-09-25');
perEvent.byGameId.has('r') && perEvent.byGameId.has('n2') && !perEvent.byGameId.has('A') && perEvent.sharedRefused === 1
  ? ok('the claim check is per event: a lone +235 game keeps its own event beside a doubleheader')
  : bad('per-event scope', [...perEvent.byGameId.keys()].join(','), 'n2,r');

// Direction: an event a day EARLIER is as wrong as a day later, and a twin
// whose kickoff is after the event is as far as one before it.
const earlier = matchSlate([{ id: 'x', home: 'Braves', away: 'Phillies', start_time: '2026-09-30T18:00Z' }],
  [{ id: 'X', home_team: 'Atlanta Braves', away_team: 'Philadelphia Phillies', commence_time: '2026-09-29T18:00:00Z' }], '2026-09-29');
earlier.byGameId.size === 0 && earlier.lateKickoff === 1
  ? ok('an event a day before the archive kickoff is refused too (|gap|, not gap)')
  : bad('negative gap', `paired ${earlier.byGameId.size}`, 'paired 0');
const twinAfter = matchSlate([nearDH, { id: 'L', home: 'Yankees', away: 'Orioles', start_time: '2026-09-26T02:57Z' }], [E2], '2026-09-25');
String([...twinAfter.byGameId.keys()]) === 'n2' && twinAfter.sharedRefused === 1
  ? ok('a twin whose kickoff is 206 min AFTER the event is refused as far')
  : bad('twin after the event', [...twinAfter.byGameId.keys()].join(','), 'n2');

// A twin refused by the claim check is not sent to elimination either.
// "York" passes the side rule for "Yankees", so only the claim check's refusal
// stands between the twin and this event.
const ELSE2 = { id: 'else2', home_team: 'York Revolution', away_team: 'Baltimore Orioles', commence_time: '2026-09-25T20:10:00Z' };
const twinFree = matchSlate([nearDH, near206], [E2, ELSE2], '2026-09-25');
!twinFree.byGameId.has('A')
  ? ok('a twin refused by the claim check does not find another event by elimination')
  : bad('claim-refused twin re-paired', twinFree.byGameId.get('A')?.event.id, 'unpaired');

// Stage 2's kickoff refusal comes after the collision test: two rows forcing
// one event are both refused even when one of them is also a day off.
const colE = { id: 'C', home_team: 'Ohio Bobcats', away_team: 'Kent State Golden Flashes', commence_time: '2026-09-12T18:00:00Z' };
const col2 = matchSlate([{ id: 'far', home: 'Ohio', away: 'KSU', start_time: '2026-09-11T10:00Z' },
                         { id: 'nok', home: 'Ohio', away: 'Kent St Flash' }], [colE], '2026-09-12');
col2.byGameId.size === 0 && col2.ambiguous === 2
  ? ok('stage 2: a far row still collides, so its rival gains nothing from the refusal')
  : bad('stage-2 collision with a far row', `paired ${[...col2.byGameId.keys()]}, ambiguous ${col2.ambiguous}`, 'paired none, ambiguous 2');

// The limits are inclusive: exactly 720 and exactly 90 keep the pair.
const at = (min) => new Date(Date.parse('2026-09-25T12:00:00Z') + min * 60000).toISOString();
const lim = (min) => matchSlate([{ id: 'g', home: 'Braves', away: 'Phillies', start_time: '2026-09-25T12:00Z' }],
  [{ id: 'e', home_team: 'Atlanta Braves', away_team: 'Philadelphia Phillies', commence_time: at(min) }], '2026-09-25').byGameId.size;
eq('a pair exactly 720 min off is kept, 721 refused', `${lim(720)}/${lim(721)}`, '1/0');
const twinAt = (min) => {
  const sl = matchSlate([nearDH, { id: 't', home: 'Yankees', away: 'Orioles',
    start_time: new Date(Date.parse(E2.commence_time) - min * 60000).toISOString() }], [E2], '2026-09-25');
  return sl.byGameId.has('t') ? 1 : 0;
};
eq('on a shared event, a claimant exactly 90 min off keeps it, 91 is refused', `${twinAt(90)}/${twinAt(91)}`, '1/0');

// Unjudged pairs are counted, so a slate with no kickoffs cannot print the
// same zeros as a slate that was fully checked (Rule 91).
const mlsGroup = mls[0];
const mlsSl = matchSlate(mlsGroup.map(asGame), [asEvent(mlsGroup[0])], mlsGroup[0].date);
eq('an MLS duplicate pair: the copy without a kickoff is counted as unjudged', mlsSl.unjudgedKickoff, mlsGroup.filter(r => !r.start_time).length);
eq('a single game without a kickoff is unjudged, not refused', `${unknown.byGameId.size}/${unknown.unjudgedKickoff}`, '1/1');
const s2blind = matchSlate([{ id: 's', home: 'Jax State', away: 'Ohio' }],
  [{ id: 'S', home_team: 'Jacksonville State Gamecocks', away_team: 'Ohio Bobcats', commence_time: '2026-09-12T18:00:00Z' }], '2026-09-12');
eq('a stage-2 pair without a kickoff is unjudged too', `${s2blind.stage2}/${s2blind.unjudgedKickoff}`, '1/1');
const judgedAll = pairs.map(r => matchSlate([asGame(r)], [asEvent(r)], r.date));
eq('over the 776 rows, pairs kept without a kickoff (unjudged)', judgedAll.reduce((n, sl) => n + sl.unjudgedKickoff, 0), 50);

// The archive's two kickoff spellings, measured 2026-10-20 over 3197 rows since
// 2026-08-01: 2740 'YYYY-MM-DDTHH:MMZ', 42 '...:00+00:00', 415 NULL, 0 date-only.
eq('gap from a "T17:00Z" kickoff', kickoffGapMinutes({ start_time: '2026-08-01T17:00Z' }, { commence_time: '2026-08-01T17:30:00Z' }), 30);
eq('gap from a "+00:00" kickoff', kickoffGapMinutes({ start_time: '2026-08-08T01:00:00+00:00' }, { commence_time: '2026-08-08T01:30:00Z' }), 30);

console.log(`\nCOVERAGE: TWO sport-dates (cfb 2026-09-12, mlb 2026-09-15) plus ${PAIRS.length + 6} synthetic cases,\nand ${fx.archive.length + 7} single-gap adversarial runs.`);
console.log(`Kickoff rules: ${NEXT_DAY.length} next-day games, ${RIGHT_FAR.length} far right pairs, all ${shared.length} shared events of the`);
console.log(`export, each on its own slate. Not seen: a full live payload, and doubleheaders where one copy lacks a kickoff.`);
console.log(`Stage 2's side rule: all ${oneSided.length} one-sided pairs stored 2026-09-16 to 2026-10-19 (of ${pairs.length}), each on`);
console.log(`its own reduced slate, plus ${ABBREV.length} name cases and ${COLLIDE.length} collision slates. Not seen: a full live`);
console.log(`payload, where a wrong team that shares the first letter (about 5% of name pairs) still passes.`);
console.log(`Zero ambiguity is measured on a 95-event payload; a larger one has more`);
console.log(`collision room. No other sport-date has been measured.`);
console.log(failed ? `\n${failed} FAILED` : `\nall checks passed`);
process.exit(failed ? 1 : 0);
