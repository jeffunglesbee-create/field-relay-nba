#!/usr/bin/env node
// Rule 61 (end-to-end before done) for CC-CMD-2026-09-12-catch-collapse-routes.
//
// Eight D1 reads changed from `.all().catch(() => ({ results: [] }))` to
// d1AllOrError + a 503 on failure. The FAILURE path was proven by mutation
// (scripts/check-d1-failure-distinguishable.mjs) — forcing a real D1 failure in
// production is not a thing to do. What this probe proves is the other half:
// that the SUCCESS path of every changed route still answers as it did, so the
// fix did not break the thing it was protecting.
//
// The client consumer of /archive/drama-missing (jubilant-bassoon
// src/legacy/field.js:35370) is why this matters beyond the relay: it reads
// `data.games` and fires a backfill per entry.
//
// Rule 91: coverage is printed with its denominator.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TODAY = new Date().toISOString().slice(0, 10);

// Every route touched by the change that is reachable with a plain GET.
// /backfill/brief-scores is POST-only and mutates; it is listed as NOT PROBED
// rather than silently omitted.
const ROUTES = [
    { path: `/archive/drama/leaderboard?sport=MLB&limit=5`, expect: 'games' },
    { path: `/archive/drama-missing?limit=5`,               expect: 'games' },
    { path: `/archive/score-missing`,                       expect: 'games' },
    { path: `/integrity/briefs?date=${TODAY}`,              expect: null   },
    { path: `/integrity/games?date=${TODAY}`,               expect: null   },
];
const NOT_PROBED = ['/backfill/brief-scores (POST, mutating)',
                    'executeSeriesPreviewBackfill (cron helper, no route)'];

const m = { probed_at: new Date().toISOString(), date: TODAY,
            routes_probed: ROUTES.length, routes_changed_total: 8,
            not_probed: NOT_PROBED, results: [], error: null };

for (const r of ROUTES) {
    const rec = { path: r.path, http: null, ok_field: null, has_expected_key: null, note: null };
    try {
        const res = await fetch(`${RELAY}${r.path}`, { headers: { 'User-Agent': UA } });
        rec.http = res.status;
        const t = await res.text();
        let j = null;
        try { j = JSON.parse(t); } catch (_) { rec.note = `non-JSON (${t.length}b): ${t.slice(0, 120)}`; }
        if (j) {
            rec.ok_field = j.ok ?? null;
            if (r.expect) rec.has_expected_key = Array.isArray(j[r.expect]);
            // The point of the change: a 503 must carry the failure shape, and a
            // 200 must NOT carry it. Either way the two are now tellable apart.
            if (res.status === 503) rec.note = `degraded: ${j.error} — ${String(j.detail).slice(0, 120)}`;
        }
    } catch (e) { rec.note = `fetch failed: ${String(e.message || e)}`; }
    m.results.push(rec);
}

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/d1-failure-shape-live-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
console.log(`\nprobed ${ROUTES.length} of ${m.routes_changed_total} changed sites (Rule 91).`);
console.log(`not probed: ${NOT_PROBED.join('; ')}`);

// A 5xx or a missing expected key is a real failure of this change.
const bad = m.results.filter(r => (r.http !== 200) || (r.has_expected_key === false));
if (bad.length) {
    console.error(`\nFAIL — ${bad.length} route(s) did not answer 200 with the expected shape:`);
    for (const b of bad) console.error(`  ${b.path}  http=${b.http}  ${b.note || ''}`);
    process.exit(1);
}
console.log('\nPASS — every probed route answers 200 with its expected shape.');
