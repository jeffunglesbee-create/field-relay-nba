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
import { teamTokens, nameMatches, findVendorEvent, h2hPrices, slateWindow, matchSlate }
  from '../src/odds-name-match.js';

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

console.log(`\nCOVERAGE: TWO sport-dates (cfb 2026-09-12, mlb 2026-09-15) plus ${PAIRS.length + 6} synthetic cases,\nand ${fx.archive.length + 7} single-gap adversarial runs.`);
console.log(`Zero ambiguity is measured on a 95-event payload; a larger one has more`);
console.log(`collision room. No other sport-date has been measured.`);
console.log(failed ? `\n${failed} FAILED` : `\nall checks passed`);
process.exit(failed ? 1 : 0);
