#!/usr/bin/env node
// Guards the odds team-name join (src/identity-resolver.js).
//
// THE FAILURE THIS EXISTS TO PREVENT: two DIFFERENT clubs resolving to the same
// key. A missing alias is a miss — the odds column stays NULL, which is the
// status quo and merely unhelpful. A collision is far worse: the odds join is
// `byPair.get(resolveTeamKey(home) + '|' + resolveTeamKey(away))`, so two clubs
// sharing a key can attach one club's line to another club's game, silently,
// and the result looks entirely plausible on the card.
//
// The concrete hazard: the tempting way to make 'Betis' match 'Real Betis' is to
// strip a leading "Real". That also collapses Real Sociedad and Real Madrid —
// and Real Betis and Real Sociedad are different clubs (Seville and San
// Sebastián) who played each other on 2026-08-21, the very fixture that exposed
// the missing La Liga aliases. A token rule would have had a live opportunity to
// swap them that same day.
//
// So the alias table must stay explicitly per-club, and this asserts it.

import { resolveTeamKey } from '../src/identity-resolver.js';

let failed = false;
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`); };

// 1. The named hazard, asserted directly and by name.
const REAL_CLUBS = ['Real Betis', 'Real Sociedad', 'Real Madrid', 'Real Oviedo'];
for (let i = 0; i < REAL_CLUBS.length; i++) {
    for (let j = i + 1; j < REAL_CLUBS.length; j++) {
        const a = REAL_CLUBS[i], b = REAL_CLUBS[j];
        if (resolveTeamKey(a) === resolveTeamKey(b)) {
            fail(`"${a}" and "${b}" resolve to the same key ("${resolveTeamKey(a)}").`);
            console.error('       These are different clubs. A "strip leading Real" rule causes');
            console.error('       this, and would attach one club\'s odds to another\'s game.');
        }
    }
}
if (!failed) console.log(`ok: the four "Real ..." clubs resolve to ${new Set(REAL_CLUBS.map(resolveTeamKey)).size} distinct keys`);

// 2. Every alias must actually reach its intended club. A table entry that
//    silently does nothing is the other way this defect returns.
const MUST_MATCH = [
    ['Betis',            'Real Betis'],
    ['Atlético',         'Atletico Madrid'],
    ['Atlético Madrid',  'Atletico Madrid'],
    ['Español',          'Espanyol'],
    ['Rayo',             'Rayo Vallecano'],
    ['Coventry',         'Coventry City'],
    ['the Sky Blues',    'Coventry City'],
    ['Sky Blues',        'Coventry City'],
    ['Ipswich',          'Ipswich Town'],
    ['the Tractor Boys', 'Ipswich Town'],
    ['Tractors',         'Ipswich Town'],
    ['Hull',             'Hull City'],
    ['the Tigers',       'Hull City'],
    ['Tigers',           'Hull City'],
    // Owner-stated convention: unqualified "Real" is Real Madrid; Betis and
    // Real Sociedad go by their own short forms.
    ['Real',             'Real Madrid'],
    ['Sociedad',         'Real Sociedad'],
    ['Betis',            'Real Betis'],
    // Pre-existing entries, included so this check also protects them.
    ['Wolves',           'Wolverhampton Wanderers'],
    ['Brighton',         'Brighton & Hove Albion'],
    ['Man Utd',          'Manchester United'],
];
for (const [variant, canonical] of MUST_MATCH) {
    if (resolveTeamKey(variant) !== resolveTeamKey(canonical)) {
        fail(`"${variant}" does not resolve to "${canonical}" — the alias is not taking effect.`);
    }
}
if (!failed) console.log(`ok: all ${MUST_MATCH.length} alias pairs resolve together`);

// 3. Pairs that must STAY apart. Similar strings that are genuinely different
//    clubs — the set a future normalisation is most likely to over-merge.
const MUST_DIFFER = [
    ['Real Betis',   'Real Sociedad'],
    ['Real Madrid',  'Real Sociedad'],
    ['Atletico Madrid', 'Real Madrid'],
    ['Manchester United', 'Manchester City'],
    ['Sunderland AFC', 'Sunderland'],   // same club — see note below
    // The short forms, which are where the convention bites: "Real" must reach
    // Real Madrid and NOT Betis or Sociedad, and the two short forms must not
    // reach each other.
    ['Real', 'Betis'],
    ['Real', 'Sociedad'],
    ['Betis', 'Sociedad'],
];
for (const [a, b] of MUST_DIFFER) {
    const same = resolveTeamKey(a) === resolveTeamKey(b);
    // Sunderland is the deliberate exception: both strings ARE one club and
    // SHOULD share a key. Asserting it here documents that it is intended
    // rather than leaving a reader to wonder why it is absent.
    if (a === 'Sunderland AFC') {
        if (!same) fail('"Sunderland AFC" and "Sunderland" are one club and must share a key.');
        continue;
    }
    if (same) fail(`"${a}" and "${b}" are different clubs but resolve to the same key.`);
}

// 4. General collision scan over everything the two La Liga sides of today's
//    fixture could be confused with, plus the EPL intake.
const DISTINCT = [
    'Real Betis', 'Real Sociedad', 'Real Madrid', 'Real Oviedo', 'Atletico Madrid',
    'Espanyol', 'Rayo Vallecano', 'Barcelona', 'Sevilla', 'Valencia', 'Villarreal',
    'Celta Vigo', 'Athletic Club', 'Getafe', 'Girona', 'Levante', 'Mallorca',
    'Osasuna', 'Alavés', 'Elche', 'Arsenal',
    // The three 2026-27 promoted clubs.
    'Coventry City', 'Ipswich Town', 'Hull City',
];
const seen = new Map();
for (const club of DISTINCT) {
    const k = resolveTeamKey(club);
    if (seen.has(k)) fail(`"${club}" collides with "${seen.get(k)}" (both key "${k}").`);
    else seen.set(k, club);
}
if (!failed) console.log(`ok: ${DISTINCT.length} distinct clubs → ${seen.size} distinct keys, no collisions`);

if (failed) process.exit(1);
console.log('PASS: team identity is per-club; no two clubs share a key.');
