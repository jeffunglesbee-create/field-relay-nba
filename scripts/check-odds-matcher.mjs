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
import { teamTokens, nameMatches, findVendorEvent, h2hPrices } from '../src/odds-name-match.js';

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

console.log(`\nCOVERAGE: one sport-date (cfb 2026-09-12) plus ${PAIRS.length + 4} synthetic cases.`);
console.log(`Zero ambiguity is measured on a 95-event payload; a larger one has more`);
console.log(`collision room. No other sport-date has been measured.`);
console.log(failed ? `\n${failed} FAILED` : `\nall checks passed`);
process.exit(failed ? 1 : 0);
