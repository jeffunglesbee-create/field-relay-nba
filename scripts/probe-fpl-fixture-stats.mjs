#!/usr/bin/env node
// The second route to per-fixture events, and a head-to-head against the one
// already shipped. Read-only.
//
// buildFPLMatchEventsContext (5c3f4d5) reads events out of
// element.explain[].fixture, because that shape was probed and confirmed. But
// the fixtures payload carries its own `stats` array -- 11 blocks on the
// Arsenal v Coventry fixture -- which was noticed and deliberately NOT used,
// since using an unread shape is what this session has spent all day
// correcting.
//
// If fixtures[].stats is equivalent, it is the better source: one fetch instead
// of two, no 600-element scan, and no dependency on explain[] being populated.
// If it differs, the difference decides which is authoritative. Either way the
// answer comes from a diff of real values, not from preference.
//
// The comparison is the point. Both routes are computed for the SAME fixture
// and asserted against each other player by player, so "equivalent" is a
// measured claim rather than an impression.

import { writeFileSync } from 'node:fs';
const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (p) => {
    const r = await fetch(`${RELAY}${p}`, { headers: { 'User-Agent': UA } });
    return { http: r.status, json: await r.json().catch(() => null) };
};

const m = { probed_at: new Date().toISOString(), ok: false };
try {
    const boot = await get('/fpl/bootstrap-static');
    const gw = (boot.json.events || []).find(e => e.is_current)?.id;
    const roster = new Map((boot.json.elements || []).map(p => [p.id, p]));
    const teamName = new Map((boot.json.teams || []).map(t => [t.id, t.name]));

    const fxAll = await get(`/fpl/fixtures?event=${gw}`);
    const fixtures = Array.isArray(fxAll.json) ? fxAll.json : [];
    // The fixture that actually has events: most started, highest stat count.
    const fx = fixtures.filter(f => f.started)
        .sort((a, b) => (b.stats?.length || 0) - (a.stats?.length || 0))[0];
    if (!fx) throw new Error('no started fixture in the current gameweek');

    m.fixture = {
        id: fx.id, gw,
        home: teamName.get(fx.team_h), away: teamName.get(fx.team_a),
        score: `${fx.team_h_score ?? '-'}-${fx.team_a_score ?? '-'}`,
        started: fx.started, finished: fx.finished,
        finished_provisional: fx.finished_provisional,
        minutes: fx.minutes,
    };

    // ── ROUTE A: fixtures[].stats ───────────────────────────────────────────
    // Dump the shape raw first — identifier list and one full block — then
    // flatten to {identifier -> [{name, value, side}]}.
    const stats = fx.stats || [];
    m.route_a_shape = {
        blocks: stats.length,
        identifiers: stats.map(s => s.identifier),
        block_keys: stats[0] ? Object.keys(stats[0]) : null,
        raw_first_block: stats[0] ?? null,
    };
    const routeA = {};
    for (const block of stats) {
        for (const side of ['h', 'a']) {
            for (const item of (block[side] || [])) {
                (routeA[block.identifier] ||= []).push({
                    name: roster.get(item.element)?.web_name ?? `#${item.element}`,
                    element: item.element, value: item.value, side,
                });
            }
        }
    }
    m.route_a = routeA;

    // ── ROUTE B: element.explain[].fixture (what shipped) ───────────────────
    const live = await get(`/fpl/event/${gw}/live/`);
    const routeB = {};
    let scanned = 0;
    for (const el of (live.json.elements || [])) {
        const entry = (el.explain || []).find(x => x.fixture === fx.id);
        if (!entry) continue;
        scanned++;
        for (const s of (entry.stats || [])) {
            if (!s.value) continue;
            (routeB[s.identifier] ||= []).push({
                name: roster.get(el.id)?.web_name ?? `#${el.id}`,
                element: el.id, value: s.value,
            });
        }
    }
    m.route_b_elements_scanned = scanned;
    m.route_b = routeB;

    // ── The diff that decides it ────────────────────────────────────────────
    // Compare only the identifiers both routes could carry as EVENTS; route B
    // also returns minutes/bps for everyone, which route A does not claim to.
    const EVENT_IDS = ['goals_scored', 'assists', 'own_goals', 'yellow_cards',
                       'red_cards', 'saves', 'penalties_saved', 'penalties_missed', 'bonus'];
    const key = (arr) => (arr || []).map(x => `${x.element}:${x.value}`).sort().join(',');
    m.comparison = EVENT_IDS.map(id => {
        const a = key(routeA[id]), b = key(routeB[id]);
        return {
            identifier: id,
            route_a_count: (routeA[id] || []).length,
            route_b_count: (routeB[id] || []).length,
            identical: a === b,
            only_in_a: a && !b ? routeA[id] : undefined,
            only_in_b: b && !a ? routeB[id] : undefined,
        };
    });
    m.all_event_identifiers_agree = m.comparison.every(c => c.identical);
    // What each route has that the other does not, at identifier level.
    m.identifiers_only_in_a = Object.keys(routeA).filter(k => !(k in routeB)).sort();
    m.identifiers_only_in_b = Object.keys(routeB).filter(k => !(k in routeA)).sort();
    m.ok = true;
} catch (e) { m.error = String(e.message || e); }

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/fpl-fixture-stats-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
if (!m.ok) process.exit(1);
