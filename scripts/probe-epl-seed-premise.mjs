#!/usr/bin/env node
// Tests CC-CMD-2026-08-21-archive-seed-coverage ask 3's premise before acting on
// it. Read-only.
//
// The ask says EPL is "not seeded at all" and cites /context/date/2026-08-22
// being 15 games, all MLS, on the eve of the Premier League opener.
//
// But EPL is ALREADY in the LEAGUES seed table at src/index.js:7587 --
// {sport:'soccer', league:'eng.1', label:'EPL'} -- and has been. So "not seeded
// at all" cannot be read off a missing row; that row exists.
//
// The competing explanation is in the ask's OWN table: MLS is pre-seeded far
// ahead, MLB is seeded "~10:00 local on the day". If seeding is game-day for
// everything except the pre-seeded MLS schedule, then a tomorrow-dated query
// showing only MLS is the SYSTEM WORKING, not a gap -- and EPL would appear at
// tomorrow's 10:01 tick like everything else.
//
// The discriminator: does MLB -- indisputably seeded, indisputably playing --
// also vanish from tomorrow while being present today? If MLB behaves exactly
// like EPL, absence-on-the-eve says nothing about EPL specifically, and adding
// LEAGUES rows would be fixing a non-problem.

import { writeFileSync } from 'node:fs';
const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const m = { probed_at: new Date().toISOString(), days: [], verdict: null };

for (const d of ['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']) {
    try {
        const r = await fetch(`${RELAY}/context/date/${d}`, { headers: { 'User-Agent': UA } });
        const j = await r.json();
        const g = j?.games?.regular || [];
        const by = {};
        for (const x of g) by[x.sport] = (by[x.sport] || 0) + 1;
        m.days.push({ date: d, http: r.status, total: g.length, by_sport: by,
            has_mlb: !!by['MLB'], has_epl: Object.keys(by).some(s => /epl|premier/i.test(s)) });
    } catch (e) { m.days.push({ date: d, error: String(e.message || e) }); }
}

// State the conclusion in the manifest rather than leaving it to be inferred:
// if MLB is present on past days and absent tomorrow, seeding is game-day and
// EPL's absence tomorrow is not evidence of a seed gap.
const past = m.days.filter(x => x.date < '2026-08-22');
const future = m.days.filter(x => x.date >= '2026-08-22');
m.verdict = {
    mlb_present_on_past_days: past.filter(x => x.has_mlb).length + '/' + past.length,
    mlb_present_on_future_days: future.filter(x => x.has_mlb).length + '/' + future.length,
    reading: (past.some(x => x.has_mlb) && !future.some(x => x.has_mlb))
        ? 'GAME-DAY SEEDING: MLB behaves exactly like EPL, so absence on the eve is not an EPL-specific gap'
        : 'INCONCLUSIVE or genuine gap -- MLB does not follow the game-day pattern; read the days array',
};

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/epl-seed-premise-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
