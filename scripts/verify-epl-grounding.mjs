#!/usr/bin/env node
// DONE CONDITION for CC-CMD-2026-08-21-fpl-event-grounding-epl and defect 2 of
// CC-CMD-2026-08-22-brief-sport-contamination.
//
// The first version of this file waited for the next EPL matchday, because the
// wiring landed between gameweeks and there was no live fixture to observe.
// That was the wrong shape of blocker. The brief generator does not need a
// FIXTURE — it needs a PROMPT. GW1's feed is live now, carrying 14 scorers and
// a real table, and /journalism/generate accepts a prompt and runs the same
// quality chain the cron does. So the whole path is exercisable today.
//
// Two stages, and they fail for different reasons on purpose:
//
//   STAGE 1 — the join, deterministic and free. Real ESPN names from
//   /context/date, real FPL data, real blocks. This is what unit tests with
//   hand-written fixtures cannot prove: that the alias map matches PRODUCTION
//   spellings and that per-fixture attribution picks the right match.
//
//   STAGE 2 — the brief, one real model call. Proves the block survives into
//   prose and that the two things the feed cannot support never appear.
//
// Passing `game` is deliberately omitted so cacheKey is null and no cached
// brief can stand in for a real generation.

import { writeFileSync } from 'node:fs';
import { fetchFplData, fplContextFor } from '../src/fpl-events.js';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (p) => {
  const r = await fetch(`${RELAY}${p}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${p}`);
  return r.json();
};

// A won-drawn-lost record used as season context — the "0-0-0 stalemate" stat.
const WDL = /\b\d+-\d+-\d+\b/;
// A minute claim. The feed carries no timestamps, so any minute is invented.
const MINUTE = /\b\d{1,2}(?:st|nd|rd|th) minute\b|\bin the \d{1,2}(?:st|nd|rd|th)\b|\b\d{1,2}'(?:\s|$)/;

const out = { probed_at: new Date().toISOString(), ok: false, error: null,
              stage1: null, stage2: null, verdict: null };
const fails = [];

try {
  // ── STAGE 1 ───────────────────────────────────────────────────────────────
  const data = await fetchFplData();
  if (!data) throw new Error('fetchFplData returned null — no current or next gameweek');

  // Find a day that actually has EPL rows; one day is not a slate.
  let day = null, dayDate = null, epl = [];
  for (let back = 0; back < 10; back++) {
    const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const got = await get(`/context/date/${d}`);
    const rows = (got.games?.regular || []).filter(g => String(g.sport || '').trim().toUpperCase() === 'EPL');
    if (rows.length) { day = got; dayDate = d; epl = rows; break; }
  }

  const fixtures = epl.map(g => {
    const ctx = fplContextFor(g.home, g.away, data);
    const named = [];
    if (ctx.block) {
      for (const line of ctx.block.split('\n')) {
        const m = /^\[EPL (?:GOALSCORERS|ASSISTS|OWN GOALS|RED CARDS|GOALKEEPER SAVES)\] (.+)$/.exec(line);
        if (m) named.push(...m[1].split(', ').map(s => s.replace(/\s*\(\d+\)$/, '')));
      }
    }
    // Every named player must belong to one of these two clubs. A wrong-fixture
    // join produces real names attached to the wrong match, which reads as
    // correct and is the failure a name-keyed bridge is most likely to make.
    const homeT = data.teamsByName.get(g.home) || data.teamsByName.get(({
      'Hull': 'Hull City', 'Man United': 'Man Utd', 'C Palace': 'Crystal Palace',
      'Ipswich': 'Ipswich Town', 'Nottm Forest': "Nott'm Forest" })[g.home] || '');
    const awayT = data.teamsByName.get(g.away) || data.teamsByName.get(({
      'Hull': 'Hull City', 'Man United': 'Man Utd', 'C Palace': 'Crystal Palace',
      'Ipswich': 'Ipswich Town', 'Nottm Forest': "Nott'm Forest" })[g.away] || '');
    const allowed = new Set([homeT?.id, awayT?.id]);
    const strays = named.filter(n => {
      const el = [...data.elementsById.values()].find(e => e.web_name === n);
      return el && !allowed.has(el.team);
    });
    const scoreLine = (g.home_score != null && g.away_score != null)
      ? `${g.home} ${g.home_score}, ${g.away} ${g.away_score}` : null;
    return { home: g.home, away: g.away, scoreLine, resolved: ctx.reason === 'ok' || !!ctx.block,
             reason: ctx.reason, unresolved: ctx.unresolved || [],
             hasTable: !!ctx.block && ctx.block.includes('[EPL TABLE]'),
             hasEvents: !!ctx.block && /\[EPL (GOALSCORERS|ASSISTS)\]/.test(ctx.block),
             namedPlayers: named, strays, block: ctx.block };
  });

  out.stage1 = {
    gameweek: data.gameweek, date_used: dayDate, fixtures: fixtures.length,
    resolved: fixtures.filter(f => f.resolved).length,
    unresolved_clubs: [...new Set(fixtures.flatMap(f => f.unresolved))],
    with_table: fixtures.filter(f => f.hasTable).length,
    with_events: fixtures.filter(f => f.hasEvents).length,
    players_named: fixtures.reduce((n, f) => n + f.namedPlayers.length, 0),
    strays: fixtures.flatMap(f => f.strays),
    sample_block: fixtures.find(f => f.hasEvents)?.block || fixtures[0]?.block || null,
  };
  if (!fixtures.length) fails.push('no EPL fixtures found in 10 days');
  if (out.stage1.unresolved_clubs.length) fails.push(`alias map misses: ${out.stage1.unresolved_clubs.join(', ')}`);
  if (fixtures.length && out.stage1.with_table !== fixtures.length) fails.push('a resolved fixture produced no table line');
  if (out.stage1.strays.length) fails.push(`players attributed to the wrong fixture: ${out.stage1.strays.join(', ')}`);

  // ── STAGE 2 ───────────────────────────────────────────────────────────────
  const target = fixtures.find(f => f.hasEvents) || fixtures.find(f => f.block);
  if (!target) {
    out.stage2 = { skipped: 'no fixture produced a block' };
    fails.push('stage 2 could not run — no block to generate from');
  } else {
    // The cron prompt carries ESPN's `Game data:` line directly above the block.
    // Run 1 of this verification omitted it, and the brief invented "a 2-1
    // result" from two goalscorers. That was a harness gap, not a production
    // one — but a verification prompt that differs from the real prompt is
    // testing something other than production, so it now mirrors it, and the
    // invented-scoreline check below stays as a standing guard.
    const prompt = [
      `Write a FIELD Game Brief for this EPL game.`,
      `${target.away} @ ${target.home}.`,
      `Game data: ${target.scoreLine || 'score not yet available'}`,
      target.block,
      '',
      'Rules: 40-60 words. Lead with the most interesting fact about who scored, then where it leaves them in the table. One complete thought.',
      'Write only from data above. No invented stats.',
    ].join('\n');
    const r = await fetch(`${RELAY}/journalism/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ prompt, briefType: 'verify-epl-grounding', max_tokens: 300 }),
    });
    const body = await r.text();
    let prose = null;
    try { prose = (JSON.parse(body).text || JSON.parse(body).prose || '').trim(); } catch { /* below */ }
    const grounded = target.namedPlayers.filter(n => prose && prose.includes(n));
    const citesTable = !!prose && /\b\d{1,2}(?:st|nd|rd|th)\b/.test(prose);
    out.stage2 = {
      http: r.status, fixture: `${target.away} @ ${target.home}`,
      players_available: target.namedPlayers, players_named_in_prose: grounded,
      cites_table_position: citesTable,
      claims_a_minute: !!prose && MINUTE.test(prose),
      cites_wdl_record: !!prose && WDL.test(prose),
      prose,
    };
    if (!prose) fails.push(`generate returned no prose (HTTP ${r.status}): ${body.slice(0, 200)}`);
    // Hard failures: things the feed cannot support.
    if (out.stage2.claims_a_minute) fails.push('the brief claims a minute the feed does not carry');
    if (out.stage2.cites_wdl_record) fails.push('the brief cites a won-drawn-lost record');
    // A scoreline the prompt never supplied. Run 1 produced "a 2-1 result" from
    // two goalscorers and then contradicted it in the same sentence.
    const proseScores = (prose || '').match(/\b\d+\s*-\s*\d+\b/g) || [];
    const supplied = target.scoreLine || '';
    const invented = proseScores.filter(sc => {
      const [a, b] = sc.split(/\s*-\s*/);
      return !(supplied.includes(a) && supplied.includes(b));
    });
    out.stage2.scorelines_in_prose = proseScores;
    out.stage2.invented_scorelines = invented;
    if (invented.length) fails.push(`the brief states a scoreline the prompt never supplied: ${invented.join(', ')}`);
    // Grounding: at least ONE signal must survive. Which one the model picks is
    // an editorial choice and not asserted — requiring a specific scorer would
    // fail on a legitimate table-led brief.
    if (prose && !grounded.length && !citesTable) fails.push('no grounding signal survived into the prose');
  }

  out.verdict = fails.length ? `FAIL — ${fails.join(' | ')}`
    : `VERIFIED — GW${out.stage1.gameweek}, ${out.stage1.fixtures} real fixtures resolved from production names, `
      + `${out.stage1.players_named} players named with zero misattributions, and a live brief carried the grounding through.`;
  out.ok = fails.length === 0;
} catch (e) { out.error = e.message; out.verdict = `ERROR — ${e.message}`; }

writeFileSync(`outbox/epl-grounding-verify-${out.probed_at.replace(/[:.]/g, '-')}.json`,
  JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
if (!out.ok) process.exit(1);
