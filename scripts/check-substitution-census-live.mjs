#!/usr/bin/env node
// Assert a committed /identity/substitution-census response against an
// expectation written BEFORE the response was fetched.
//
// WHY THIS EXISTS. The census's cross-sport classification is behaviour, and
// scripts/check-team-key-substitution.mjs says so in its own output: those
// assertions read the source and would all pass if the classifier returned
// nothing. The classification is proven here instead, against named keys whose
// answer was derived independently — by running resolveTeamKey locally on both
// the archive's short name and the vendor's full name for the same team.
//
// The MUST_NOT list is the half that matters. Anyone can predict that a broken
// resolver flags something; predicting what it must NOT flag is what separates
// a working classifier from one that flags everything.
//
//   node scripts/check-substitution-census-live.mjs outbox/<file>.json
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: check-substitution-census-live.mjs <census.json>'); process.exit(2); }
const d = JSON.parse(readFileSync(path, 'utf8'));

let failed = 0, checked = 0;
const ok   = (l) => { checked++; console.log(`ok    ${l}`); };
const fail = (l, why) => { checked++; failed++; console.log(`FAIL  ${l} — ${why}`); };

// ── the scan covered the archive ───────────────────────────────────────────
d.complete === true ? ok('complete') : fail('complete', `complete=${d.complete}`);
/^scanned (\d+) of \1 rows/.test(d.coverage || '')
    ? ok(`coverage: ${d.coverage}`)
    : fail('coverage says scanned == total', `coverage=${JSON.stringify(d.coverage)}`);

// ── the capped list reports its own cap ────────────────────────────────────
const found = d.rows_with_odds_under_a_substituted_key_found;
const shown = d.rows_with_odds_under_a_substituted_key_shown;
const omitted = d.rows_with_odds_under_a_substituted_key_omitted;
(Number.isInteger(found) && Number.isInteger(shown) && omitted === found - shown
 && shown === (d.rows_with_odds_under_a_substituted_key || []).length)
    ? ok(`odds-carrying rows: ${shown} shown of ${found} found`)
    : fail('the capped list reports found/shown/omitted consistently',
           `found=${found} shown=${shown} omitted=${omitted} len=${(d.rows_with_odds_under_a_substituted_key||[]).length}`);

// ── the enumerated pairs ───────────────────────────────────────────────────
// Each was derived locally before this ran, by resolving the archive's short
// name and the other sport's name and seeing them meet.
const byKey = new Map((d.ambiguous_keys || []).map(a => [a.key, a]));
const MUST = [
    ['hullcity',          ['MLB', 'soccer'],  'Detroit `Tigers` and Hull City share a nickname'],
    ['stlouiscardinals',  ['NFL', 'MLB'],     'Arizona `Cardinals` and the St. Louis Cardinals'],
    ['sanfranciscogiants',['NFL', 'MLB'],     'New York `Giants` and the San Francisco Giants'],
    ['texasrangers',      ['soccer', 'MLB'],  'Rangers FC and the Texas Rangers'],
    ['coloradorapids',    ['CFB', 'soccer'],  'Colorado the school and the Colorado Rapids'],
    ['minnesotaunitedfc', ['CFB', 'soccer'],  'Minnesota the school and Minnesota United'],
    ['fccincinnati',      ['CFB', 'soccer'],  'Cincinnati the school and FC Cincinnati'],
    ['houstondynamofc',   ['CFB', 'soccer'],  'Houston the school and the Houston Dynamo'],
    ['charlottefc',       ['CFB', 'soccer'],  'Charlotte the school and Charlotte FC'],
    ['intermiamicf',      ['CFB', 'soccer'],  'Miami the school and Inter Miami'],
    ['newyorkliberty',    ['CFB', 'WNBA'],    'Liberty the school and the New York Liberty'],
];
for (const [key, fams, why] of MUST) {
    const e = byKey.get(key);
    if (!e) { fail(`MUST ${key}`, `absent from ambiguous_keys (${why})`); continue; }
    const got = Object.keys(e.families).sort();
    const want = [...fams].sort();
    got.join(',') === want.join(',')
        ? ok(`MUST ${key}: ${got.join(' + ')} — ${why}`)
        : fail(`MUST ${key}`, `families ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}

// ── and what must NOT be flagged ───────────────────────────────────────────
const MUST_NOT = [
    ['brightonhovealbion', 'Brighton in EPL and in Europa Conference qualifying is ONE club in two competitions'],
    ['manchestercity',     'Man City in EPL and in the Champions League is ONE club in two competitions'],
    ['connecticutsun',     'the Connecticut Sun are claimed by WNBA alone'],
    ['atlantabraves',      'an ordinary within-sport nickname alias'],
    ['lasvegasaces',       'claimed by WNBA and wnba — the SAME sport under two labels'],
];
for (const [key, why] of MUST_NOT) {
    const e = byKey.get(key);
    if (!e) { ok(`MUST NOT ${key} — ${why}`); continue; }
    fail(`MUST NOT ${key}`, `flagged with families ${JSON.stringify(Object.keys(e.families))} — ${why}`);
}

// ── every reported row actually touches an ambiguous key ───────────────────
const rows = d.cross_sport_rows || [];
const bad = rows.filter(r => !r.home_key_ambiguous && !r.away_key_ambiguous);
bad.length === 0
    ? ok(`all ${rows.length} reported row(s) touch an ambiguous key`)
    : fail('every reported row touches an ambiguous key', `${bad.length} do not, e.g. ${JSON.stringify(bad[0])}`);

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked}`
          + ` — ${(d.ambiguous_keys || []).length} ambiguous key(s), ${rows.length} row(s),`
          + ` ${d.totals?.ambiguous_rows_with_odds} of them carrying odds`);
process.exit(failed ? 1 : 0);
