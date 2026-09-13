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
// Rule 62: one list of soccer labels. A second hand-written one would drift the
// moment a competition is added — EFL Cup and the three UEFA qualifying labels
// were all added after their first consumer was written.
if (/const SOCCER_SPORT_LABEL_SET = new Set\(Object\.values\(SOCCER_LEAGUE_LABELS\)\)/.test(indexSrc)) {
    ok('D the soccer family set is derived from SOCCER_LEAGUE_LABELS');
} else {
    fail('D the soccer family set is derived from SOCCER_LEAGUE_LABELS', 'relisted or missing');
}
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
    // The named-rows list is capped. A capped list that does not say so reads
    // as complete — the first live run found 1225 and showed 100 (Rule 99).
    eq('E census reports found alongside shown',
       /rows_with_odds_under_a_substituted_key_found/.test(body)
       && /rows_with_odds_under_a_substituted_key_shown/.test(body), true);
    // sport_filter is present and null when unfiltered, so a one-sport scan
    // cannot be read as the whole archive.
    eq('E census always carries sport_filter', /sport_filter:\s*sportFilter \|\| null/.test(body), true);
    // The cross-sport classification is derived from the archive's own rows,
    // not from a vendor response — that is what makes it free. If it ever
    // reached for fetchSportOddsLive it would cost a credit per sport.
    eq('E census classifies from its own key sets', /keySetBySport/.test(body), true);
    eq('E census spends no Odds-API credit', /fetchSportOdds/.test(body), false);
    eq('E census reports which sports it could compare',
       /sports_compared:\s*\[\.\.\.keySetBySport\.keys\(\)\]/.test(body), true);
    // The cross-sport list is the one the fix is aimed at. Unlike the
    // odds-carrying list it is NOT capped, and must not become so silently.
    eq('E cross-sport rows are uncapped',
       /cross_sport_rows:\s*crossRows,/.test(body) && !/crossRows\.slice/.test(body), true);

    // BEHAVIOURAL PROOF LIVES ELSEWHERE, and saying so here is the point.
    // These four assertions read the source. They would all still pass if
    // alsoIn() returned [] for every key — a source check cannot see that.
    // The classification is proven instead by the committed live response in
    // outbox/, which must contain a named row whose also_in is non-empty
    // (Rule 89: the artifact, not the action).
    // Soccer is one sport across many archive labels. Without the family test,
    // `Brighton` in Europa Conference qualifying reads as cross-sport because
    // Brighton is also in EPL — the same club in another competition.
    eq('E soccer competitions count as one family',
       /sportFamily = \(sp\) => SOCCER_SPORT_LABEL_SET\.has\(sp\)/.test(body), true);
    // `wnba` and `WNBA` are both real archive labels; without a case fold every
    // WNBA club reads as two families claiming one key.
    eq('E labels differing only by case are one family',
       /String\(sp\)\.toUpperCase\(\)/.test(body), true);
    // AMBIGUITY, NOT VERDICT. This census compares against the ARCHIVE's own key
    // sets, which the substitutions themselves pollute — CFB's wrong row and
    // MLS's correct one each make the other look cross-sport. The data supports
    // "two families claim this key", not "this one is wrong", and the report
    // must name BOTH sides rather than pick one.
    eq('E a key is ambiguous only when two FAMILIES claim it',
       /if \(owners\.size < 2\) continue;/.test(body), true);
    eq('E both claimants are named, not just the suspect one',
       /names:\s*\[\.\.\.o\.names\]\.sort\(\)/.test(body)
       && /sports:\s*\[\.\.\.o\.sports\]\.sort\(\)/.test(body), true);
    eq('E the enumerated pair list is served', /ambiguous_keys:\s*ambiguousKeys/.test(body), true);

    ok('E (classification behaviour is proven by the committed live response, not here)');

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
