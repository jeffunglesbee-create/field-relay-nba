#!/usr/bin/env node
// Guards the three-table soccer contract in src/index.js.
//
// WHY THIS EXISTS (CC-CMD-2026-08-20-uefa-club-competitions):
// The UEFA club competitions were fully present in V2_LEAGUES (correct ESPN
// slugs, correct BSD lids) AND in SOCCER_LEAGUE_LABELS (correct display
// labels) since the June 26 2026 migration -- and still never appeared in
// /context/date, because they had no row in the cron's LEAGUES table.
//
// That is the whole bug class: three tables that must agree, with CI checking
// only two of them. deploy.yml's "Soccer league label contract check" verifies
// V2_LEAGUES <-> SOCCER_LEAGUE_LABELS via live /v2/games, so an on-demand
// fetch looked healthy while nothing was ever persisted. /context/date reads
// ONLY ARCHIVE_DB, and the archive is written from LEAGUES, so a competition
// missing from LEAGUES is invisible no matter how correct its config is.
//
// Two assertions, both static (no network, safe to run before deploy):
//
//   A. LABEL CONTRACT -- every soccer row in LEAGUES carries a label that is a
//      declared SOCCER_LEAGUE_LABELS value. The archive-write sites persist
//      `sport: gm.league` (the label), and that value also forms the archive id
//      prefix, so a label present in one table but not the other splits a
//      single competition across two id namespaces. This is the same reasoning
//      already written on the EFL Cup row; this makes it enforced rather than
//      remembered.
//
//   B. ARCHIVE COVERAGE -- every espnLeague-routed soccer key in V2_LEAGUES has
//      a LEAGUES row, except an explicit allowlist. The allowlist is not a
//      fallback: those three are genuinely not archived today, and encoding
//      them here means a NEW config-without-coverage entry fails loudly instead
//      of silently repeating the UEFA outcome. Removing a key from the
//      allowlist is how you declare it covered.

import { readFileSync } from 'node:fs';

const SRC = 'src/index.js';
const src = readFileSync(SRC, 'utf8');

// Soccer keys that exist in V2_LEAGUES but are deliberately NOT archived.
// Shrink this set when coverage is added; never grow it to silence a failure
// without saying why in the same commit.
const UNCOVERED_BY_DESIGN = new Set([
    'eflchamp', // EFL Championship  -- no LEAGUES row; BSD lid 12 exists but archive coverage never added
    'eflone',   // EFL League One    -- ESPN only (bsdLeagueId null), excluded from Phase 12 via LOWER_SOCCER
    'efltwo',   // EFL League Two    -- ESPN only (bsdLeagueId null), excluded from Phase 12 via LOWER_SOCCER
]);

function fail(msg) { console.error(`FAIL: ${msg}`); process.exitCode = 1; }

// ── parse SOCCER_LEAGUE_LABELS ──────────────────────────────────────────────
// Body class excludes braces deliberately -- same constraint deploy.yml's
// check documents, and the reason that object's comments must not contain
// curly braces.
const lblMatch = src.match(/const SOCCER_LEAGUE_LABELS = \{([^{}]*)\};/);
if (!lblMatch) { fail('SOCCER_LEAGUE_LABELS constant not found'); process.exit(1); }
const labels = Object.fromEntries([...lblMatch[1].matchAll(/(\w+):\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
const labelValues = new Set(Object.values(labels));

// ── parse the cron LEAGUES table ────────────────────────────────────────────
const lgMatch = src.match(/const LEAGUES = \[(.*?)\n {2}\];/s);
if (!lgMatch) { fail('cron LEAGUES table not found'); process.exit(1); }
const rows = [...lgMatch[1].matchAll(/\{sport:'([^']+)',\s*league:'([^']+)',\s*label:'([^']+)'\}/g)]
    .map(m => ({ sport: m[1], league: m[2], label: m[3] }));
const leagueSlugs = new Set(rows.map(r => r.league));

// ── parse V2_LEAGUES ────────────────────────────────────────────────────────
const v2Match = src.match(/const V2_LEAGUES = \{(.*?)\n\};/s);
if (!v2Match) { fail('V2_LEAGUES constant not found'); process.exit(1); }
const v2 = [...v2Match[1].matchAll(/'(\w+)':\s*\{([^{}]*)\}/g)].map(m => ({ key: m[1], body: m[2] }));

// Soccer = espnLeague present AND sport:'soccer'. espnSport-carrying entries
// (baseball/football/basketball/australian-football) are other sports; wc26
// declares sport:'football' and is excluded here for that reason, matching the
// existing check's EXCLUDED_ESPN_SPORTS logic rather than inventing a new rule.
const soccerKeys = v2
    .filter(e => /espnLeague:\s*'/.test(e.body) && /sport:\s*'soccer'/.test(e.body))
    .map(e => ({ key: e.key, slug: e.body.match(/espnLeague:\s*'([^']+)'/)[1] }));

console.log(`SOCCER_LEAGUE_LABELS: ${Object.keys(labels).length} entries`);
console.log(`LEAGUES: ${rows.length} rows (${rows.filter(r => r.sport === 'soccer').length} soccer)`);
console.log(`V2_LEAGUES soccer keys: ${soccerKeys.length}`);

// ── A. label contract ───────────────────────────────────────────────────────
const badLabels = rows.filter(r => r.sport === 'soccer' && !labelValues.has(r.label));
for (const r of badLabels) {
    fail(`LEAGUES row '${r.league}' has label '${r.label}', which is not a declared SOCCER_LEAGUE_LABELS value. `
       + `The archive persists this string as the sport column AND the id prefix -- it must match exactly.`);
}
if (!badLabels.length) console.log('A. label contract: PASS -- every soccer LEAGUES label is declared');

// ── B. archive coverage ─────────────────────────────────────────────────────
const uncovered = soccerKeys.filter(k => !leagueSlugs.has(k.slug) && !UNCOVERED_BY_DESIGN.has(k.key));
for (const k of uncovered) {
    fail(`V2_LEAGUES key '${k.key}' (${k.slug}) has no LEAGUES row, so its games are never archived and will `
       + `never appear in /context/date -- the exact UEFA failure. Add a LEAGUES row, or add the key to `
       + `UNCOVERED_BY_DESIGN in this script with a reason.`);
}
if (!uncovered.length) {
    console.log(`B. archive coverage: PASS -- all soccer keys covered `
              + `(${[...UNCOVERED_BY_DESIGN].join(', ')} excluded by design)`);
}

// Report allowlist entries that have since gained coverage, so the set cannot
// quietly outlive its reason.
const stale = [...UNCOVERED_BY_DESIGN].filter(key => {
    const k = soccerKeys.find(s => s.key === key);
    return k && leagueSlugs.has(k.slug);
});
if (stale.length) console.log(`NOTE: now covered, remove from UNCOVERED_BY_DESIGN: ${stale.join(', ')}`);

if (process.exitCode) process.exit(1);
console.log('Soccer three-table contract intact.');
