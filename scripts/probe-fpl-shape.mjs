#!/usr/bin/env node
// Pre-build probe for CC-CMD-2026-08-21-fpl-event-grounding-epl. Read-only.
//
// The ask describes the per-player payload as carrying goals_scored, assists,
// yellow_cards, red_cards, minutes, saves, bonus and modified, sourced from the
// Drive "FPL Relay Session" doc of 2026-05-17. Under Rule 73 that is a CLAIM
// with a three-month-old verification date, not a measurement — and the sibling
// CC-CMD's equally confident ESPN `keyEvents` claim turned out wrong for four of
// five sports. So every field name is read from the live payload before any of
// them is written into code.
//
// Four questions, in the order the build needs them:
//
//   1. GAMEWEEK RESOLUTION. The ask says to take events[].is_current from
//      /bootstrap-static. Does exactly one event carry it? At a season's very
//      start, is_current can be absent entirely (nothing has finished), which
//      would make a naive .find() return undefined and the whole join silently
//      no-op. is_next is reported alongside so the fallback is chosen from data.
//
//   2. THE PER-PLAYER SHAPE, verbatim. Field union across every element rather
//      than the keys of element[0] — the element-[0] trap has now cost this
//      session three wrong readings (soccer keyEvents, MLB plays, the desk's
//      "one snapshot"). A sample with an actual goal is quoted raw.
//
//   3. THE JOIN. FPL fixtures key on team_h/team_a numeric ids, which
//      bootstrap-static maps to names. Those names must resolve through
//      resolveTeamKey to match a D1 game row. Every one of the 20 club names is
//      tested, both `name` and `short_name`, so any gap is a named club rather
//      than an unknown failure rate.
//
//   4. THE TEST CASE. The ask nominates Arsenal 3-0 Coventry. Is it in this
//      gameweek's fixtures, and does its FPL id resolve?
//
// Cost (Rule 78): three GETs through the relay proxy, which already caches
// bootstrap at 3600s and live at 30s (src/index.js:456-457). No new plumbing,
// no key, no quota.

import { writeFileSync } from 'node:fs';
import { resolveTeamKey } from '../src/identity-resolver.js';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const get = async (path) => {
    const r = await fetch(`${RELAY}${path}`, { headers: { 'User-Agent': UA } });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep the body for diagnosis */ }
    return { http: r.status, json, raw: json ? null : text.slice(0, 200) };
};

const m = {
    probed_at: new Date().toISOString(),
    ok: false,
    gameweek: null,
    live_shape: null,
    fixtures_shape: null,
    club_join: null,
    test_case: null,
    error: null,
};

try {
    // ── 1. gameweek ─────────────────────────────────────────────────────────
    const boot = await get('/fpl/bootstrap-static');
    if (boot.http !== 200 || !boot.json) throw new Error(`bootstrap-static: http ${boot.http} ${boot.raw || ''}`);
    const events = boot.json.events || [];
    const teams = boot.json.teams || [];
    const current = events.filter(e => e.is_current);
    const next = events.filter(e => e.is_next);
    m.gameweek = {
        events_total: events.length,
        is_current_count: current.length,
        is_current_id: current[0]?.id ?? null,
        is_next_id: next[0]?.id ?? null,
        // If is_current is absent, the build must fall back to is_next or to the
        // highest finished id. Reported so that choice is made on data.
        finished_max_id: events.filter(e => e.finished).map(e => e.id).sort((a, b) => b - a)[0] ?? null,
        teams_count: teams.length,
    };
    const gw = current[0]?.id ?? next[0]?.id;
    if (!gw) throw new Error('no is_current and no is_next event — cannot pick a gameweek');

    // ── 3. the join, over all clubs ─────────────────────────────────────────
    // Tested before the live read, because if the names do not resolve the
    // per-player shape does not matter.
    const unresolved = [];
    for (const t of teams) {
        const byName = resolveTeamKey(t.name);
        const byShort = resolveTeamKey(t.short_name);
        // CORRECTED 2026-08-22: the first version compared name-key against
        // short_name-key and reported 0/20 agreeing. That was the CHECK being
        // wrong, not the data -- short_name is a 3-letter code (ARS, AVL) and
        // was never meant to resolve. The real question is whether `name`
        // resolves, which it does for all 20. Kept as a report of both keys
        // rather than a pass/fail, because it surfaced something worth keeping:
        // "SUN" strips to "sun" and hits the WNBA Connecticut Sun alias.
        if (byName !== byShort) unresolved.push({ id: t.id, name: t.name, short_name: t.short_name, key_name: byName, key_short: byShort });
    }
    // The meaningful measure: do the `name` values resolve to distinct clubs?
    const nameKeys = teams.map(t => resolveTeamKey(t.name));
    m.club_join = {
        clubs: teams.length,
        name_keys_distinct: new Set(nameKeys).size,
        name_join_ok: new Set(nameKeys).size === teams.length,
        // Short codes are NOT joinable and must not be used -- reported so the
        // hazard stays visible rather than being rediscovered.
        short_code_hazard: teams
            .map(t => ({ short_name: t.short_name, key: resolveTeamKey(t.short_name), club: t.name }))
            .filter(x => x.key !== x.short_name.toLowerCase()),
        both_key_forms: unresolved,
    };

    // ── 2. per-player shape ─────────────────────────────────────────────────
    const live = await get(`/fpl/event/${gw}/live/`);
    if (live.http !== 200 || !live.json) throw new Error(`event/${gw}/live: http ${live.http} ${live.raw || ''}`);
    const elements = live.json.elements || [];
    const statKeys = [...new Set(elements.flatMap(e => Object.keys(e.stats || {})))].sort();
    const topKeys = [...new Set(elements.flatMap(e => Object.keys(e)))].sort();
    const scorers = elements.filter(e => (e.stats?.goals_scored || 0) > 0);
    const assisters = elements.filter(e => (e.stats?.assists || 0) > 0);
    // Name resolution: elements carry only an id, so the build needs
    // bootstrap's element list to get a name. Confirm that mapping exists.
    const byId = new Map((boot.json.elements || []).map(p => [p.id, p]));
    m.live_shape = {
        gw,
        elements: elements.length,
        element_top_level_keys: topKeys,
        stats_field_union: statKeys,
        // The ask's claimed fields, each reported present-or-absent by name.
        claimed_fields_present: Object.fromEntries(
            ['goals_scored', 'assists', 'yellow_cards', 'red_cards', 'minutes', 'saves', 'bonus']
                .map(k => [k, statKeys.includes(k)])),
        has_modified_flag: topKeys.includes('modified') || Object.keys(live.json).includes('modified'),
        scorers_count: scorers.length,
        assisters_count: assisters.length,
        scorer_samples: scorers.slice(0, 4).map(e => ({
            element: e.id,
            web_name: byId.get(e.id)?.web_name ?? null,
            team_id: byId.get(e.id)?.team ?? null,
            goals: e.stats.goals_scored,
            assists: e.stats.assists,
            minutes: e.stats.minutes,
            bonus: e.stats.bonus,
        })),
        name_lookup_available: !!(boot.json.elements || []).length,
    };

    // ── 4. fixtures + the nominated test case ───────────────────────────────
    const fx = await get(`/fpl/fixtures?event=${gw}`);
    if (fx.http !== 200 || !fx.json) throw new Error(`fixtures?event=${gw}: http ${fx.http} ${fx.raw || ''}`);
    const fixtures = Array.isArray(fx.json) ? fx.json : [];
    const nameOf = (id) => teams.find(t => t.id === id)?.name ?? null;
    m.fixtures_shape = {
        count: fixtures.length,
        sample_fields: fixtures.length ? Object.keys(fixtures[0]).sort() : null,
        sample: fixtures.slice(0, 3).map(f => ({
            id: f.id, team_h: f.team_h, team_a: f.team_a,
            home: nameOf(f.team_h), away: nameOf(f.team_a),
            finished: f.finished, score: `${f.team_h_score ?? '-'}-${f.team_a_score ?? '-'}`,
            has_stats: Array.isArray(f.stats) ? f.stats.length : null,
        })),
    };
    const arsCov = fixtures.find(f =>
        [nameOf(f.team_h), nameOf(f.team_a)].every(Boolean) &&
        [resolveTeamKey(nameOf(f.team_h)), resolveTeamKey(nameOf(f.team_a))]
            .every(k => ['arsenal', 'coventrycity'].includes(k)));
    m.test_case = arsCov ? {
        found: true, fixture_id: arsCov.id,
        home: nameOf(arsCov.team_h), away: nameOf(arsCov.team_a),
        home_key: resolveTeamKey(nameOf(arsCov.team_h)),
        away_key: resolveTeamKey(nameOf(arsCov.team_a)),
        finished: arsCov.finished,
        score: `${arsCov.team_h_score ?? '-'}-${arsCov.team_a_score ?? '-'}`,
    } : { found: false, note: 'Arsenal v Coventry not in this gameweek — check the gw picked above' };

    m.ok = true;
} catch (e) { m.error = String(e.message || e); }

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/fpl-shape-probe-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
if (!m.ok) { console.error('PROBE FAILED — says nothing about the payload.'); process.exit(1); }
