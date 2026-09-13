// A variant that means two teams is recorded, not resolved — and the join
// resolves it from the payload it already holds.
//
// WHAT WENT WRONG. `Tigers` is Detroit's nickname and Hull City's. The builder
// assigned both into one slot, so the winner was whichever line sat lower in the
// file. ['Tigers','Hull City'] landed 2026-08-21 and took MLB's entry; Detroit
// stopped matching its own odds and nothing said so for three weeks.
//
// THE REGRESSION HALF IS THE IMPORTANT HALF. Section D pins eighteen names by
// hand and demands `Tigers` is the only one whose answer changed. A fix to an
// identity table that quietly moves other teams is worse than the bug it fixes,
// and an identity table is exactly where a quiet move goes unnoticed.
import { readFileSync } from 'node:fs';
import {
  resolveTeamKey, resolveTeamCandidates, resolveTeamKeyIn, AMBIGUOUS_TEAM,
} from '../src/identity-resolver.js';
import { indexOddsByPair, findOddsForRow } from '../src/odds-join.js';

let failed = 0, checked = 0;
const ok   = (l) => { checked++; console.log(`ok    ${l}`); };
const fail = (l, why) => { checked++; failed++; console.log(`FAIL  ${l} — ${why}`); };
const eq = (l, got, want) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(l) : fail(l, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── A. the table records the ambiguity ─────────────────────────────────────
eq('A tigers is recorded ambiguous', AMBIGUOUS_TEAM.tigers, ['detroittigers', 'hullcity']);
eq('A exactly one ambiguous key today', Object.keys(AMBIGUOUS_TEAM).length, 1);
// The bare fold, not either club. An honest unknown can miss a join; a wrong
// winner asserts a team that was never named.
eq('A an ambiguous name resolves to its own fold', resolveTeamKey('Tigers'), 'tigers');
eq('A candidates are both clubs', resolveTeamCandidates('Tigers'), ['detroittigers', 'hullcity']);
eq('A an ordinary name has one candidate', resolveTeamCandidates('Braves'), ['atlantabraves']);

// ── B. the payload decides ─────────────────────────────────────────────────
const MLB = new Set(['detroittigers', 'chicagowhitesox', 'houstonastros']);
const EPL = new Set(['hullcity', 'manchesterunited', 'chelsea']);
eq('B Tigers in a baseball payload is Detroit', resolveTeamKeyIn('Tigers', MLB), 'detroittigers');
eq('B Tigers in a football payload is Hull',    resolveTeamKeyIn('Tigers', EPL), 'hullcity');
// Zero present: this sport did not field the team. One present: decided. Two
// present: the payload genuinely contains both and either pick is a guess.
eq('B absent from the payload is a miss, not a guess',
   resolveTeamKeyIn('Tigers', new Set(['chelsea'])), 'tigers');
eq('B both present refuses to pick',
   resolveTeamKeyIn('Tigers', new Set(['detroittigers', 'hullcity'])), 'tigers');
eq('B no payload behaves as the plain resolver', resolveTeamKeyIn('Tigers', undefined), 'tigers');
// CONTRACT CHANGED 2026-09-13, deliberately. This asserted that an unambiguous
// name IGNORES the payload — `Braves` returned atlantabraves even when asked
// against an EPL response, asserting an MLB club into a soccer join. The
// sport-blind fix (CC-CMD-2026-09-13-team-key-sport-blind Task 2) makes the
// scoping universal: never return a key the payload does not contain. Nothing
// is lost, because if the alias is absent the pair lookup was going to miss
// either way; what goes is the cross-sport assertion on the way to that miss.
eq('B an unambiguous name is scoped to the payload too',
   resolveTeamKeyIn('Braves', EPL), 'braves');
eq('B and resolves normally when the payload does contain it',
   resolveTeamKeyIn('Braves', new Set(['atlantabraves', 'newyorkmets'])), 'atlantabraves');
eq('B empty input stays empty', resolveTeamKeyIn('', MLB), '');

// ── C. end to end, through the REAL join ───────────────────────────────────
// These call src/odds-join.js, not a local re-implementation. The first draft
// of this section rebuilt the index inline, and mutation N5 — which breaks the
// real findOddsForRow — left it green. A check that re-implements its subject
// verifies the copy and reports on the source. That is the exact substitution
// this repo's rules name, and it is why odds-join.js was extracted.
const mlbIdx = indexOddsByPair([
  { home_team: 'Detroit Tigers', away_team: 'Chicago White Sox', id: 'mlb-game' },
  { home_team: 'Houston Astros', away_team: 'Texas Rangers',     id: 'other' },
]);
const eplIdx = indexOddsByPair([
  { home_team: 'Hull City', away_team: 'Manchester United', id: 'epl-game' },
]);
eq('C the real D1 row finds its own game',
   findOddsForRow(mlbIdx, 'Tigers', 'White Sox')?.id, 'mlb-game');
eq('C a soccer row still finds its own',
   findOddsForRow(eplIdx, 'Hull', 'Man United')?.id, 'epl-game');
// The failure this whole design exists to make impossible.
eq('C a baseball row cannot match a football game',
   findOddsForRow(eplIdx, 'Tigers', 'White Sox'), undefined);
eq('C a football row cannot match a baseball game',
   findOddsForRow(mlbIdx, 'Hull', 'Man United'), undefined);
eq('C an empty payload matches nothing',
   findOddsForRow(indexOddsByPair([]), 'Tigers', 'White Sox'), undefined);

// ── D. nothing else moved ──────────────────────────────────────────────────
// HAND-WRITTEN, not diffed against a previous commit. The first draft compared
// every variant against `git show HEAD:` — which silently becomes a no-op the
// moment the fix IS HEAD, so in CI it would have compared the file to itself and
// passed while asserting nothing. An expectation that the code can satisfy by
// changing is not an expectation.
//
// Two per sport, chosen where a collision would be most likely and most costly:
// nicknames, cities shared with another league, and the promoted PL clubs whose
// addition caused this bug.
for (const [name, want] of [
  ['Braves',            'atlantabraves'],
  ['Detroit Tigers',    'detroittigers'],
  ['White Sox',         'chicagowhitesox'],
  ['Rangers',           'texasrangers'],
  ['Hull',              'hullcity'],
  ['the Tigers',        'hullcity'],
  ['Ipswich',           'ipswichtown'],
  ['Coventry',          'coventrycity'],
  ['Man United',        'manchesterunited'],
  ['Spurs',             'tottenhamhotspur'],
  ['Aces',              'lasvegasaces'],
  ['Liberty',           'newyorkliberty'],
  ['Columbus',          'columbuscrew'],
  ['Colorado',          'coloradorapids'],
  ['Athletics',         'athletics'],
  ['CF Montréal',       'cfmontreal'],
  ['San José St',       'sanjosest'],
  ['Richmond',          'richmond'],
]) eq(`D ${JSON.stringify(name)} is unchanged`, resolveTeamKey(name), want);

// And the one name that DID change, stated as its own assertion so the table
// above can never quietly absorb it.
eq('D Tigers alone moved, from a club to an honest unknown', resolveTeamKey('Tigers'), 'tigers');

// ── E. every join site consults the payload ────────────────────────────────
// A site left resolving without context is the bug, reintroduced.
const idx = readFileSync('src/index.js', 'utf8');
eq('E no join resolves a row without the payload in hand',
   (idx.match(/byPair\.get\(`\$\{resolveTeamKey\(/g) || []).length, 0);
// 3 joins + 1 census probe = 4, and the probe is pinned by its own call shape
// on the next line so the total cannot quietly absorb a FOURTH JOIN. A new join
// site pushes this to 5 and goes red; the reach probe is accounted for by name,
// not by loosening the number.
eq('E three joins and the census reach probe go through the one helper',
   (idx.match(/findOddsForRow\(/g) || []).length, 4);
eq('E the extra call is the census cross-sport reach probe, not a join',
   (idx.match(/findOddsForRow\(present, name, REACH_CONTROL_B\)/g) || []).length, 1);
eq('E and index.js no longer carries its own copy',
   /function indexOddsByPair/.test(idx), false);

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` (${Object.keys(AMBIGUOUS_TEAM).length} ambiguous key of ${Object.keys(AMBIGUOUS_TEAM).length + 268})`);
process.exit(failed ? 1 : 0);
