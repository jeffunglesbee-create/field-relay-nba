// A short form means its club only inside its own sport.
//
// 94 of 281 aliases are a short form of their canonical — `Colorado` for the
// Rapids, `Liberty` for the New York Liberty. Nothing in the string says which
// sport, so the alias table answers the same way everywhere: a CFB row named
// `Colorado` resolved to an MLS club. Measured 2026-09-12, 14 CFB rows across 7
// names.
//
// THE FIX IS IN THE ONE PLACE THAT KNOWS THE SPORT. A vendor response is one
// sport and is indexed before any D1 row is read, so resolveTeamKeyIn refuses
// to return a key the payload does not contain. It is NOT a change to
// resolveTeamKey: three call sites bridge a vendor name to a FIELD name with no
// payload in hand and rely on these aliases. Section D holds that set closed.
import { readFileSync } from 'node:fs';
import { resolveTeamKey, resolveTeamKeyIn, foldTeamName } from '../src/identity-resolver.js';
import { indexOddsByPair, findOddsForRow } from '../src/odds-join.js';

let failed = 0, checked = 0;
const eq = (l, got, want) => { checked++;
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`ok    ${l}`);
  else { failed++; console.log(`FAIL  ${l} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };

const keys = (names) => new Set(names.map(resolveTeamKey));
const MLS   = keys(['Colorado Rapids', 'Houston Dynamo FC', 'FC Cincinnati', 'Charlotte FC',
                    'Minnesota United FC', 'Inter Miami CF', 'Columbus Crew']);
const NCAAF = keys(['Colorado Buffaloes', 'Houston Cougars', 'Liberty Flames', 'Weber St',
                    'Charlotte 49ers', 'Cincinnati Bearcats', 'Miami Hurricanes']);
const WNBA  = keys(['New York Liberty', 'Las Vegas Aces', 'Minnesota Lynx']);

// ── A. THE ENUMERATED PAIR the CC-CMD names: Colorado under CFB and under MLS
eq('A Colorado in an MLS payload is the Rapids',  resolveTeamKeyIn('Colorado', MLS),   'coloradorapids');
eq('A Colorado in an NCAAF payload is a place',   resolveTeamKeyIn('Colorado', NCAAF), 'colorado');
// The same string, two sports, two answers — and neither is the other's club.
eq('A the two answers differ',
   resolveTeamKeyIn('Colorado', MLS) !== resolveTeamKeyIn('Colorado', NCAAF), true);

// ── B. every measured CFB substitution, both directions ────────────────────
// Left: the club, inside its own sport. Right: plain text, in CFB.
for (const [name, club] of [
  ['Colorado',   'coloradorapids'],
  ['Houston',    'houstondynamofc'],
  ['Cincinnati', 'fccincinnati'],
  ['Charlotte',  'charlottefc'],
  ['Minnesota',  'minnesotaunitedfc'],
  ['Miami',      'intermiamicf'],
]) {
  eq(`B ${name} is ${club} in MLS`, resolveTeamKeyIn(name, MLS), club);
  eq(`B ${name} is plain text in CFB`, resolveTeamKeyIn(name, NCAAF), foldTeamName(name));
}
eq('B Liberty is the WNBA side in a WNBA payload', resolveTeamKeyIn('Liberty', WNBA), 'newyorkliberty');
eq('B Liberty is plain text in CFB', resolveTeamKeyIn('Liberty', NCAAF), 'liberty');

// ── C. no cross-sport key can survive into a join ──────────────────────────
// The property, stated once over every measured name rather than case by case.
const CROSS = ['coloradorapids', 'houstondynamofc', 'fccincinnati', 'charlottefc',
               'minnesotaunitedfc', 'intermiamicf', 'newyorkliberty'];
const leaked = ['Colorado', 'Houston', 'Cincinnati', 'Charlotte', 'Minnesota', 'Miami', 'Liberty']
  .map(n => resolveTeamKeyIn(n, NCAAF)).filter(k => CROSS.includes(k));
eq('C no MLS or WNBA key reaches an NCAAF join', leaked, []);

// And the pair lookup, which is where a matcher would have acted on it.
const ncaafIdx = indexOddsByPair([
  { home_team: 'Colorado Buffaloes', away_team: 'Weber St', id: 'cfb-game' },
]);
const mlsIdx = indexOddsByPair([
  { home_team: 'Colorado Rapids', away_team: 'Sporting Kansas City', id: 'mls-game' },
]);
eq('C an MLS row still finds its own game', findOddsForRow(mlsIdx, 'Colorado', 'Kansas City')?.id, 'mls-game');
eq('C a CFB row cannot reach the MLS game', findOddsForRow(mlsIdx, 'Colorado', 'Weber St'), undefined);
eq('C a CFB row misses cleanly in its own payload',
   findOddsForRow(ncaafIdx, 'Colorado', 'Weber St'), undefined);

// ── D. the three bridging callers stay a closed set ────────────────────────
// They use the PLAIN resolver against a vendor name with no payload, and rely
// on these aliases. The fix deliberately leaves them alone; this keeps a fourth
// from appearing unnoticed, which is how a latent trap becomes a live one.
const DECLARED = [
  ['src/ambient-do.js',   'DO state vs Odds-API event; the events array is in hand but not indexed'],
  ['src/wp-resolver.js',  'oddsName vs fieldName, two names only'],
  ['src/index.js',        'oddsName vs fieldName, two names only (~line 1219)'],
  ['src/context-assembler.js', 'D1 row vs D1 row — same naming convention both sides'],
  ['src/odds-join.js',    'indexes the vendor side, then uses resolveTeamKeyIn for rows'],
];
const declaredFiles = new Set(DECLARED.map(d => d[0]));
const users = new Set();
for (const f of ['src/ambient-do.js', 'src/wp-resolver.js', 'src/index.js',
                 'src/context-assembler.js', 'src/odds-join.js', 'src/game-do.js',
                 'src/soccer-wp.js', 'src/journalism-quality.js']) {
  let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
  if (/\bresolveTeamKey\s*\(/.test(src)) users.add(f);
}
eq('D every plain-resolver caller is declared', [...users].filter(f => !declaredFiles.has(f)), []);
eq('D every declaration carries a reason', DECLARED.every(d => d[1].length > 15), true);

// ── E. the standalone resolver is deliberately unchanged ───────────────────
// Stated as an assertion so the decision is visible rather than inferred: the
// short form still names its club with no payload, because three sites need it
// to. The fix removes the false assertion from the join, not from the table.
eq('E resolveTeamKey is untouched for a bare form', resolveTeamKey('Colorado'), 'coloradorapids');
eq('E and for a nickname form', resolveTeamKey('Liberty'), 'newyorkliberty');
eq('E no payload behaves exactly as before', resolveTeamKeyIn('Colorado', undefined), 'coloradorapids');

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`);
process.exit(failed ? 1 : 0);
