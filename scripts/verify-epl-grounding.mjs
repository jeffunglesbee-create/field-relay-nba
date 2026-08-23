#!/usr/bin/env node
// Verifies the REAL EPL grounding path — buildFPLMatchEventsContext in
// src/context-assembler.js, shipped 2026-08-22 by 5c3f4d5 / eb02ac7 — plus the
// league-table line added 2026-08-23 for defect 2 of
// CC-CMD-2026-08-22-brief-sport-contamination.
//
// An earlier version of this file verified a SECOND, duplicate implementation
// written in this session before its author read outbox/Drive and found the
// first one. That module is deleted; this checks the builder that actually
// runs.
//
// Three stages, each failing for a different reason:
//
//   1. The team dictionary against the CURRENT season. _FPL_SHORT_TO_ESPN_ABBR
//      is a closed list of clubs, which is correct only until the league is
//      promoted into. Comparing it to a copy of itself proves nothing, so this
//      compares it to bootstrap-static's live team list.
//   2. The builder, called directly on a real fixture. Asserts the table line
//      is present and that it never emits a won-drawn-lost triple.
//   3. The archive, for briefs generated through the cron path.
//
// Read-only apart from the artifact it writes.

import { writeFileSync } from 'node:fs';
import { buildFPLMatchEventsContext, _FPL_SHORT_TO_ESPN_ABBR } from '../src/context-assembler.js';
import { hasCliche } from '../src/journalism-quality.js';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (p) => {
  const r = await fetch(`${RELAY}${p}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${p}`);
  return r.json();
};

const WDL = /\b\d+-\d+-\d+\b/;
const MINUTE = /\b\d{1,2}(?:st|nd|rd|th) minute\b|\bin the \d{1,2}(?:st|nd|rd|th)\b/;

const out = { probed_at: new Date().toISOString(), ok: false, error: null,
              stage1_dictionary: null, stage2_builder: null, stage3_archive: null, verdict: null };
const fails = [];

try {
  // ── 1. the dictionary against this season ─────────────────────────────────
  const boot = await get('/fpl/bootstrap-static/');
  const teams = boot.teams || [];
  const mapped = Object.keys(_FPL_SHORT_TO_ESPN_ABBR);
  const unmapped = teams.filter(t => !mapped.includes(t.short_name));
  const stale = mapped.filter(k => !teams.some(t => t.short_name === k));
  out.stage1_dictionary = {
    season_clubs: teams.length,
    dictionary_entries: mapped.length,
    unmapped_this_season: unmapped.map(t => `${t.short_name} (${t.name})`),
    entries_for_clubs_not_in_this_season: stale,
  };
  // An unmapped club makes teamIdFor return null, and the builder returns ''
  // for BOTH sides of that fixture — no events, no table, silently.
  if (unmapped.length) fails.push(`dictionary misses ${unmapped.length} club(s) in this season: ${unmapped.map(t => t.short_name).join(', ')}`);

  // The dictionary maps FPL short_name -> ESPN abbreviation, so completing it
  // needs ESPN's abbreviation, not a guess at one. Report what ESPN actually
  // calls every club on the EPL scoreboard, so the missing rows are copied from
  // evidence. Guessing club identifiers is the failure this whole file exists
  // to stop repeating.
  // Through the relay's own /espn-standings passthrough, not ESPN directly:
  // a direct fetch from the runner returns an HTML block page. The standings
  // response lists every club in the division at once, which a scoreboard for
  // one day does not.
  try {
    const st = await get('/espn-standings/soccer/eng.1/standings');
    const entries = (st.children?.[0]?.standings?.entries || st.standings?.entries || []);
    out.stage1_dictionary.espn_abbreviations_observed = entries
      .map(e => `${e.team?.abbreviation} (${e.team?.displayName})`)
      .filter(s => !s.startsWith('undefined')).sort();
  } catch (e) { out.stage1_dictionary.espn_abbreviations_observed = `unavailable: ${e.message}`; }

  // ── 2. the builder, on a real fixture ─────────────────────────────────────
  const gw = (boot.events || []).find(e => e.is_current)?.id ?? (boot.events || []).find(e => e.is_next)?.id;
  const fixtures = await get(`/fpl/fixtures?event=${gw}`);
  const abbrOf = (id) => _FPL_SHORT_TO_ESPN_ABBR[teams.find(t => t.id === id)?.short_name];
  const usable = (Array.isArray(fixtures) ? fixtures : [])
    .filter(f => f.started && abbrOf(f.team_h) && abbrOf(f.team_a));

  if (!usable.length) {
    out.stage2_builder = { skipped: 'no started fixture whose clubs are both in the dictionary' };
    fails.push('stage 2 could not run — see stage 1');
  } else {
    const blocks = [];
    for (const f of usable.slice(0, 4)) {
      const block = await buildFPLMatchEventsContext(
        { RELAY_BASE: RELAY },
        { home: { abbr: abbrOf(f.team_h) }, away: { abbr: abbrOf(f.team_a) } });
      blocks.push({ fixture: `${abbrOf(f.team_h)} v ${abbrOf(f.team_a)}`, block });
    }
    const withTable = blocks.filter(b => /League table:/.test(b.block || ''));
    const withWdl = blocks.filter(b => WDL.test((b.block || '').replace(/\d+-\d+-\d+ /g, m => m)) &&
                                       WDL.test(b.block || ''));
    out.stage2_builder = {
      gameweek: gw, fixtures_built: blocks.length,
      non_empty: blocks.filter(b => b.block).length,
      with_table_line: withTable.length,
      with_wdl_triple: withWdl.map(b => b.fixture),
      sample: blocks.find(b => b.block)?.block || null,
    };
    if (blocks.some(b => !b.block)) fails.push('a started fixture produced an empty block');
    if (blocks.filter(b => b.block).length !== withTable.length) fails.push('a non-empty block carries no league-table line');
    if (withWdl.length) fails.push(`a block emitted a won-drawn-lost triple: ${withWdl.map(b => b.fixture).join(', ')}`);
  }

  // ── 3. the archive ────────────────────────────────────────────────────────
  const q = await get('/archive/query?sport=EPL&brief_type=game_recap&limit=20');
  const all = (q.results || []).filter(r => r.brief_text);

  // BASELINE. A brief written before the fix deployed cannot be evidence about
  // behaviour after it. Judging history would leave this check permanently red,
  // which is how a check stops being read — the same reason live-tabs-check was
  // rewritten in field-laboratory after asserting a stale tab count "red on
  // every commit for hours", and the same move aca5c93 made in this repo when
  // it moved closing_after_opening's baseline to the deploy that fixed the
  // writer.
  //
  // 8c195da (layer 2h, banned phrases) is the last of the three fixes; the
  // table line and the club dictionary landed alongside it. Everything at or
  // after this instant is governed.
  const BASELINE = '2026-08-23T05:33:53Z';
  const since = new Date(BASELINE);
  const governed = all.filter(r => r.created_at && new Date(r.created_at.replace(' ', 'T') + 'Z') >= since);
  const historical = all.filter(r => !governed.includes(r));
  const rows = governed;

  out.stage3_archive = {
    baseline: BASELINE,
    briefs_total: all.length,
    briefs_governed: governed.length,
    briefs_predating_the_fix: historical.length,
    // Reported, never failed on. These are what the fixes were written for.
    historical_findings: {
      cite_wdl: historical.filter(r => WDL.test(r.brief_text)).length,
      banned_phrases: historical.flatMap(r => hasCliche(r.brief_text).map(p => `${r.id}: ${p}`)),
    },
    cite_wdl: rows.filter(r => WDL.test(r.brief_text)).map(r => r.id),
    claim_minute: rows.filter(r => MINUTE.test(r.brief_text)).map(r => r.id),
    say_stalemate: rows.filter(r => /stalemate/i.test(r.brief_text)).map(r => r.id),
    banned_phrases: rows.flatMap(r => hasCliche(r.brief_text).map(p => `${r.id}: ${p}`)),
    // PENDING, not passing: zero governed briefs proves nothing either way.
    note: governed.length ? null
      : `no EPL recap generated since ${BASELINE} — stage 3 is PENDING, not passing. `
        + `${historical.length} older brief(s) examined and reported, not judged.`,
  };
  for (const [k, label] of [['cite_wdl', 'cite a W-D-L record'], ['claim_minute', 'claim a minute'],
                            ['say_stalemate', 'say stalemate'], ['banned_phrases', 'use a banned phrase']]) {
    if (out.stage3_archive[k].length) fails.push(`archived briefs ${label}: ${out.stage3_archive[k].slice(0, 3).join(', ')}`);
  }

  out.verdict = fails.length ? `FAIL — ${fails.join(' | ')}`
    : rows.length === 0
      ? `PARTIAL — dictionary covers all ${teams.length} clubs and ${out.stage2_builder.with_table_line} live blocks carry a table line with no W-D-L triple. `
        + `Stage 3 PENDING: no EPL recap generated since the fix. ${historical.length} older brief(s) reported, not judged.`
      : `VERIFIED — dictionary covers all ${teams.length} clubs, ${out.stage2_builder.with_table_line} live blocks carry a table line and no W-D-L triple, `
        + `and all ${rows.length} EPL recaps generated since the fix are clean.`;
  out.ok = fails.length === 0;
} catch (e) { out.error = e.message; out.verdict = `ERROR — ${e.message}`; }

writeFileSync(`outbox/epl-grounding-verify-${out.probed_at.replace(/[:.]/g, '-')}.json`,
  JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 3500));
if (!out.ok) process.exit(1);
