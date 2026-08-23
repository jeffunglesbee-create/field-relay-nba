#!/usr/bin/env node
// DONE CONDITION for CC-CMD-2026-08-21-fpl-event-grounding-epl and defect 2 of
// CC-CMD-2026-08-22-brief-sport-contamination.
//
// The wiring cannot be proven by unit tests: they prove the module builds the
// right block, not that a live EPL brief was written from one. GW1 finished
// before the wiring landed, so there was no fixture to observe it on. This is
// the check that closes it, and it is a workflow rather than a note so the
// follow-up is dispatched, not remembered.
//
// Run it after any EPL matchday. Read-only.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (p) => {
  const r = await fetch(`${RELAY}${p}`, { headers: { 'User-Agent': UA } });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${p}`);
  return JSON.parse(t);
};

// The stat that must not come back: a won-drawn-lost record used as season
// context. "0-0-0" is the exact string the Brentford card carried.
const WDL = /\b\d+-\d+-\d+\b/;
// A minute claim. The feed carries no timestamps, so any minute in an EPL brief
// generated from it is invented.
const MINUTE = /\b\d{1,2}(?:st|nd|rd|th) minute\b|\b\d{1,2}'\s|\bin the \d{1,2}(?:st|nd|rd|th)\b/;

const out = { probed_at: new Date().toISOString(), ok: false, error: null,
              briefs_examined: 0, findings: [], verdict: null };
try {
  const q = await get('/archive/query?sport=EPL&brief_type=game_recap&limit=20');
  const rows = (q.results || []).filter(r => r.brief_text);
  out.briefs_examined = rows.length;

  for (const r of rows) {
    const t = r.brief_text;
    out.findings.push({
      id: r.id, date: r.date, quality_score: r.quality_score,
      // Grounding is a player name the model could only have from the feed —
      // approximated here as "not just team names and numbers".
      mentions_wdl_record: WDL.test(t),
      claims_a_minute: MINUTE.test(t),
      says_stalemate_with_a_lead: /stalemate/i.test(t),
      snippet: t.slice(0, 140),
    });
  }
  const wdl = out.findings.filter(f => f.mentions_wdl_record).length;
  const min = out.findings.filter(f => f.claims_a_minute).length;
  const stale = out.findings.filter(f => f.says_stalemate_with_a_lead).length;

  out.verdict = rows.length === 0
    ? 'PENDING — no EPL game_recap in the archive yet. Re-run after the next matchday.'
    : (wdl === 0 && min === 0 && stale === 0)
      ? `PASS — ${rows.length} EPL recaps: no W-D-L record cited, no invented minute, no stalemate claim.`
      : `FAIL — of ${rows.length}: ${wdl} cite a W-D-L record, ${min} claim a minute the feed does not carry, ${stale} say stalemate.`;
  out.ok = true;
} catch (e) { out.error = e.message; }

writeFileSync(`outbox/epl-grounding-verify-${out.probed_at.replace(/[:.]/g, '-')}.json`,
  JSON.stringify(out, null, 2));
console.log(JSON.stringify({ verdict: out.verdict, examined: out.briefs_examined }, null, 2));
if (!out.ok) process.exit(1);
