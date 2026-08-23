#!/usr/bin/env node
// PRE-BUILD probe for CC-CMD-2026-08-21-fpl-event-grounding-epl (Rule 68).
//
// Wiring FPL events into EPL briefs needs three things this repo has never
// written against, and all three must be read from the REAL payload rather than
// from the endpoint's documentation:
//
//   1. which gameweek is current, and whether its live data is populated;
//   2. the per-player element shape — the exact stat keys, and whether a player
//      who did nothing still appears (which decides whether "name the scorers"
//      is a filter or a lookup);
//   3. the JOIN. FPL is keyed by its own element and fixture ids. A brief is
//      generated per ESPN event with team NAMES. Nothing bridges those two
//      unless bootstrap-static's teams/elements are carried alongside, so the
//      probe reports exactly what identifiers each side offers.
//
// Emits a compact summary only — the raw payloads are ~700KB and this runs to
// inform a build, not to archive data.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (p) => {
  const r = await fetch(`${RELAY}${p}`, { headers: { 'User-Agent': UA } });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${p}: ${t.slice(0, 160)}`);
  return JSON.parse(t);
};

const out = { probed_at: new Date().toISOString(), ok: false, error: null,
              gameweek: null, bootstrap: null, live: null, fixtures: null, join: null };

try {
  const boot = await get('/fpl/bootstrap-static/');
  const events = boot.events || [];
  const cur = events.find(e => e.is_current) || events.find(e => e.is_next);
  out.gameweek = { id: cur?.id ?? null, name: cur?.name ?? null,
                   finished: cur?.finished ?? null, is_current: !!cur?.is_current };
  out.bootstrap = {
    teams: (boot.teams || []).length,
    team_keys: Object.keys((boot.teams || [])[0] || {}),
    team_sample: (boot.teams || []).slice(0, 3).map(t => ({ id: t.id, name: t.name, short_name: t.short_name })),
    elements: (boot.elements || []).length,
    element_identity_keys: Object.keys((boot.elements || [])[0] || {})
      .filter(k => /name|id|team|code/i.test(k)),
    element_sample: (boot.elements || []).slice(0, 2)
      .map(e => ({ id: e.id, web_name: e.web_name, team: e.team, element_type: e.element_type })),
  };

  const gw = out.gameweek.id;
  if (gw) {
    const live = await get(`/fpl/event/${gw}/live/`);
    const els = live.elements || [];
    const statKeys = Object.keys(els[0]?.stats || {});
    const played = els.filter(e => (e.stats?.minutes || 0) > 0);
    const scorers = els.filter(e => (e.stats?.goals_scored || 0) > 0);
    const assisters = els.filter(e => (e.stats?.assists || 0) > 0);
    out.live = {
      elements_returned: els.length,
      element_top_level_keys: Object.keys(els[0] || {}),
      stat_keys: statKeys,
      // The question that decides filter-vs-lookup: does a player who never
      // played still appear in the payload?
      players_with_minutes: played.length,
      players_with_zero_minutes: els.length - played.length,
      scorers: scorers.length,
      assisters: assisters.length,
      // `explain` carries the fixture id per player — the only link from a stat
      // line back to a match.
      explain_shape: els.find(e => (e.explain || []).length)?.explain?.[0] ?? null,
    };
  }

  const fx = await get(`/fpl/fixtures/?event=${gw}`);
  out.fixtures = {
    count: fx.length,
    keys: Object.keys(fx[0] || {}),
    sample: fx.slice(0, 3).map(f => ({ id: f.id, team_h: f.team_h, team_a: f.team_a,
      finished: f.finished, kickoff_time: f.kickoff_time,
      stats_types: (f.stats || []).map(s => s.identifier) })),
  };

  out.join = {
    fpl_side: 'element.id -> bootstrap.elements[].web_name; explain[].fixture -> fixtures[].id -> team_h/team_a (ids) -> bootstrap.teams[].name',
    espn_side: 'brief prompts carry home/away TEAM NAMES and an ESPN event id',
    bridge_required: 'FPL team name <-> ESPN team name, by string. No shared numeric id exists.',
    fpl_team_names: (boot.teams || []).map(t => t.name),
  };
  // The ESPN half of the bridge, read rather than assumed. The golf incident
  // (CC-CMD-2026-06-18) was a session guessing field shapes instead of probing;
  // guessing TEAM NAMES has the same failure mode and no compiler to catch it.
  const today = new Date().toISOString().slice(0, 10);
  const ctxDay = await get(`/context/date/${today}`);
  const soccer = (ctxDay.games?.regular || [])
    .filter(g => /^(EPL|La Liga|Ligue 1|Serie A|MLS|Bundesliga)$/i.test(String(g.sport || '').trim()));
  out.join.espn_soccer_rows = soccer.length;
  out.join.espn_epl_names = [...new Set(soccer
    .filter(g => String(g.sport).trim().toUpperCase() === 'EPL')
    .flatMap(g => [g.home, g.away]).filter(Boolean))];
  // Which FPL names match an ESPN name verbatim, and which do not. The
  // non-matching list IS the alias map that has to be written by hand.
  const fplNames = new Set(out.join.fpl_team_names);
  out.join.exact_matches = out.join.espn_epl_names.filter(n => fplNames.has(n));
  out.join.needs_alias = out.join.espn_epl_names.filter(n => !fplNames.has(n));

  out.ok = true;
} catch (e) { out.error = e.message; }

writeFileSync(`outbox/fpl-event-shape-${out.probed_at.replace(/[:.]/g, '-')}.json`,
  JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
