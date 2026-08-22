#!/usr/bin/env node
// One shape the build needs and the first probe did not capture. Read-only.
//
// /fpl/event/{gw}/live/ returns 600 elements for the WHOLE gameweek, not one
// fixture. Scoping to a single match matters: in a double gameweek a team plays
// twice, so filtering by team id alone would merge two matches into one recap.
//
// The element's `explain` array is what carries the per-fixture breakdown, but
// its inner shape has not been read. Writing `explain[].fixture` from memory is
// exactly what produced the wrong ESPN container in the sibling CC-CMD, so it
// gets read first.
import { writeFileSync } from 'node:fs';
const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (p) => { const r = await fetch(`${RELAY}${p}`, { headers: { 'User-Agent': UA } }); return { http: r.status, json: await r.json().catch(() => null) }; };
const m = { probed_at: new Date().toISOString(), ok: false };
try {
    const boot = await get('/fpl/bootstrap-static');
    const gw = (boot.json.events || []).find(e => e.is_current)?.id;
    const live = await get(`/fpl/event/${gw}/live/`);
    const els = live.json.elements || [];
    const scorer = els.find(e => (e.stats?.goals_scored || 0) > 0);
    m.gw = gw;
    m.explain_shape = {
        is_array: Array.isArray(scorer?.explain),
        entries: scorer?.explain?.length ?? null,
        entry_keys: scorer?.explain?.[0] ? Object.keys(scorer.explain[0]) : null,
        // The whole question: is there a fixture id on the entry?
        fixture_value: scorer?.explain?.[0]?.fixture ?? null,
        raw_first_entry: scorer?.explain?.[0] ?? null,
    };
    m.scorer_context = scorer ? { element: scorer.id, goals: scorer.stats.goals_scored } : null;
    // How many elements carry an explain entry for fixture 1 (Arsenal v Coventry)?
    m.scoped_to_fixture_1 = els.filter(e =>
        Array.isArray(e.explain) && e.explain.some(x => x.fixture === 1)).length;
    m.ok = true;
} catch (e) { m.error = String(e.message || e); }
const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
writeFileSync(`outbox/fpl-explain-${stamp}.json`, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
if (!m.ok) process.exit(1);
