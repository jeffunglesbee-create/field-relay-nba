// Is a resolved key derived from the name it came from?
//
// WHAT THIS GUARDS. `resolveTeamKey` is sport-blind: its alias map turns a bare
// city into that city's best-known club, so CFB `Colorado` resolves to
// `coloradorapids` (MLS). The predicate that tells such a substitution from an
// ordinary accent difference is the whole diagnostic — `San José St` ->
// `sanjosest` must NOT be flagged, and if it is, the five real CFB->MLS rows
// drown in eighty false ones.
//
// It is also the predicate that was written twice — once inline in
// /identity/mismatches, once for the census — which is the duplication this
// repo extracted src/odds-sport-keys.js to stop. Assertion D holds the single
// definition in place.
//
// Rule 90: every assertion here was made to fail on purpose first. See
// scripts/mutate-team-key-substitution.mjs.
import { readFileSync } from 'node:fs';
import { foldTeamName, substitutedKey } from '../src/identity-resolver.js';
import { routes, bodyOf } from './lib/route-scan.mjs';

let failed = 0, checked = 0;
const ok   = (label) => { checked++; console.log(`ok    ${label}`); };
const fail = (label, detail) => { checked++; failed++; console.log(`FAIL  ${label} — ${detail}`); };
const eq = (label, got, want) =>
    (got === want) ? ok(label) : fail(label, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── A. foldTeamName is the comparison baseline, not a resolver ──────────────
// It must reduce a name to its own letters and digits and nothing else. If it
// ever consulted the alias map it would agree with resolveTeamKey by
// construction and the predicate could never flag anything.
for (const [input, want] of [
    ['Colorado',            'colorado'],
    ['Colorado Buffaloes',  'coloradobuffaloes'],
    ['San José St',         'sanjosest'],
    ['CF Montréal',         'cfmontreal'],
    ['D.C. United',         'dcunited'],
    ['',                    ''],
    [null,                  ''],
]) eq(`A fold ${JSON.stringify(input)}`, foldTeamName(input), want);

// ── B. substitutedKey flags a key that is not its own name, and only that ───
// The first five are the measured CFB->MLS substitutions (2026-09-12,
// /identity/mismatches?date=2026-09-12&sports=CFB,MLS,EPL,NFL). The vendor-side
// full names below them are the SAME cities and must all be clean — that pairing
// is the asymmetry the join actually misses on, so both halves are enumerated.
for (const [input, want] of [
    ['Colorado',            'coloradorapids'],
    ['Minnesota',           'minnesotaunitedfc'],
    ['Houston',             'houstondynamofc'],
    ['Cincinnati',          'fccincinnati'],
    ['Charlotte',           'charlottefc'],
    ['Colorado Buffaloes',  null],
    ['Minnesota Golden Gophers', null],
    ['Houston Cougars',     null],
    ['Cincinnati Bearcats', null],
    ['Charlotte 49ers',     null],
    ['Houston Texans',      null],
    ['San José St',         null],
    ['',                    null],
    [null,                  null],
]) eq(`B substitutedKey ${JSON.stringify(input)}`, substitutedKey(input), want);

// ── C. accent folding is what makes B discriminate ─────────────────────────
// Stated as its own assertion because B would still pass if `San José St`
// happened to have no alias AND the fold were broken — the two failures cancel
// on that one input. This one cannot cancel: it asserts the accented and
// unaccented spellings of the same name fold together.
eq('C accented and plain spellings fold alike',
   foldTeamName('San José St') === foldTeamName('San Jose St'), true);
eq('C CF Montréal folds to its plain form',
   foldTeamName('CF Montréal') === foldTeamName('CF Montreal'), true);

// ── D. one definition, not two ─────────────────────────────────────────────
const indexSrc = readFileSync('src/index.js', 'utf8');
if (/\bsubstitutedKey\b/.test(indexSrc) && /from '\.\/identity-resolver\.js'/.test(indexSrc)) {
    ok('D index.js imports the shared predicate');
} else {
    fail('D index.js imports the shared predicate', 'no substitutedKey import found');
}
// A re-implementation would reach for NFKD, as the deleted inline copy did.
const nfkdInIndex = (indexSrc.match(/normalize\('NFKD'\)/g) || []).length;
eq('D index.js carries no second fold implementation', nfkdInIndex, 0);

// ── E. the census reports its own denominator (Rule 91) ────────────────────
const census = routes.find(r => r.path === '/identity/substitution-census');
if (!census) {
    fail('E census route is registered', 'no route matching /identity/substitution-census');
} else {
    ok('E census route is registered');
    const body = bodyOf(census.line).text;
    if (body && !bodyOf(census.line).truncated) ok('E census body read whole');
    else fail('E census body read whole', 'brace balance did not resolve');
    eq('E census emits a coverage string', /coverage:\s*`scanned \$\{/.test(body), true);
    eq('E census emits per-table complete', /complete:\s*allComplete/.test(body), true);

    // ── F. the census is read-only ─────────────────────────────────────────
    // It exists to inform a backfill DECISION. A live mutation of archive rows
    // is the user's call, case by case, and is never wired into a diagnostic.
    for (const verb of ['UPDATE ', 'INSERT ', 'DELETE ', 'DROP ', 'ALTER ']) {
        eq(`F census contains no ${verb.trim()}`, body.includes(verb), false);
    }
    eq('F census calls no write helper',
       /\b(reconcile|recordD1Write)\s*\(/.test(body), false);
}

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` (predicate + ${census ? 'census route' : 'NO CENSUS ROUTE'})`);
process.exit(failed ? 1 : 0);
