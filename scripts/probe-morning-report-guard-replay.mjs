#!/usr/bin/env node
// Replays the Morning Report (Phase 5) against the real proxy and runs the production
// guard over each answer. READ-ONLY: nothing is written to D1 or KV.
//
// WHY. 16 of the 22 mornings 2026-10-08..29 were the template, and the arithmetic in
// docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md shows that on the two days
// that can be checked the proxy answered and the team-name guard rejected the answer.
// The prose was not kept and Workers console output is not persisted, so what the
// model writes, and which rule rejects it, can only be seen by asking again. This asks:
// SAMPLES times per date, with the prompt built by the production function from the
// production inputs, sent by the production call, judged by the production guard.
// Nothing here re-implements any of the three.
//
// Rule 78: each sample is one real inference at the production max_tokens (250).
// Defaults are 4 dates x 3 samples = 12 calls, one at a time, plus one corrective retry for
// each answer the guard rejects (RETRY=0 turns that off). DATES / SAMPLES override.
// Pacing: PACE_MS between calls, so the 30 requests/minute that the proxy's own header comment
// gives for its Gemini key cannot be reached even if every call answered at once. A 429 is
// forwarded by the proxy and recorded here as the failure `http-429`; nothing retries it.
//
// Inputs are rebuilt from public routes: /context/date/{D} for the games, and
// /analytics/newspaper/{D+1} for night_stars and truth_is (that bundle's recap date is
// the day before the date asked for). The context is fetched now, not at 09:00Z on D+1,
// so a game finalised since then can differ; `fetched_at` is recorded for that reason.
//
// Without RELAY_SHARED_SECRET it builds and reports the prompts and makes no proxy call,
// and says so. It never prints the secret.
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  selectRecapGames, buildMorningReportPrompt, teamNameSubstitutions, callProxyDetailed,
} from '../src/analytics-engine.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DATES = (process.env.DATES || '2026-10-26,2026-10-27,2026-10-28,2026-10-29')
  .split(',').map(s => s.trim()).filter(Boolean);
const SAMPLES = Number(process.env.SAMPLES) || 3;
const RETRY = process.env.RETRY !== '0';
const SECRET = process.env.RELAY_SHARED_SECRET;
const DEADLINE = Date.now() + 4 * 60 * 1000;
const PER_CALL_MS = 40000;
const PACE_MS = 2500;

const nextDay = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const words = (s) => s.split(/\s+/).filter(Boolean).length;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

// A call that never answers must not eat the whole run.
// The timer is cleared when the call wins: an uncleared one keeps the process alive for the
// full `ms` after the last answer, which is paid-for runner time.
const withTimeout = (p, ms) => {
  let timer;
  return Promise.race([
    p,
    new Promise(res => { timer = setTimeout(() => res({ text: null, failure: 'timeout', model: null }), ms); }),
  ]).finally(() => clearTimeout(timer));
};

const out = {
  ts: new Date().toISOString(),
  relay: RELAY,
  samples_per_date: SAMPLES,
  proxy_calls_enabled: Boolean(SECRET),
  dates: [],
};

console.log(`=== morning-report guard replay  dates=${DATES.join(',')}  samples=${SAMPLES}  proxy=${SECRET ? 'on' : 'OFF (no RELAY_SHARED_SECRET: prompts only)'} ===`);

for (const date of DATES) {
  const rec = { date, fetched_at: new Date().toISOString(), samples: [] };
  out.dates.push(rec);
  let ctx, bundle;
  try {
    [ctx, bundle] = await Promise.all([
      getJson(`${RELAY}/context/date/${date}`),
      getJson(`${RELAY}/analytics/newspaper/${nextDay(date)}`),
    ]);
  } catch (e) {
    rec.error = String(e.message || e);
    console.log(`${date}  INPUTS FAILED  ${rec.error}`);
    continue;
  }
  const stars = bundle.night_stars;
  const truthIs = bundle.truth_is;
  const recapGames = selectRecapGames(ctx);
  const prompt = buildMorningReportPrompt(date, { stars, truthIs, recapGames });
  rec.inputs = {
    recap_games: recapGames.length,
    night_stars: Boolean(stars),
    truth_headline: truthIs ? truthIs.headline : null,
    stored_morning_report: bundle.morning_report,
    prompt_chars: prompt.length,
  };
  console.log(`${date}  recap games ${recapGames.length}  night_stars ${Boolean(stars)}  stored: ${String(bundle.morning_report).slice(0, 60)}`);
  if (!SECRET) continue;

  for (let i = 1; i <= SAMPLES; i++) {
    if (Date.now() > DEADLINE) { out.truncated = true; break; }
    const res = await withTimeout(callProxyDetailed({ RELAY_SHARED_SECRET: SECRET }, prompt, { maxTokens: 250 }), PER_CALL_MS);
    const subs = teamNameSubstitutions(res.text, recapGames);
    const s = {
      sample: i,
      model: res.model,
      failure: res.failure,
      words: res.text ? words(res.text) : 0,
      rejected: subs.length > 0,
      offenders: subs,
      prose: res.text,
    };
    rec.samples.push(s);
    const verdict = res.failure ? `NO TEXT (${res.failure})`
      : subs.length ? `REJECT x${subs.length}: ${subs.map(f => f.fabricated_qualifier ? `qualifier "${f.fabricated_qualifier}"` : `missing ${f.missing_team.join('+')}`).join('; ')}`
      : 'accept';
    console.log(`  #${i}  ${String(res.model)}  ${s.words}w  ${verdict}`);
    await new Promise(r => setTimeout(r, PACE_MS));

    // EXPERIMENT, not production behaviour: would ONE corrective retry that names what the
    // guard objected to produce an answer the guard accepts? Nothing in the relay does this;
    // this measures whether it would be worth building. Only rejected answers are retried.
    if (RETRY && subs.length > 0 && Date.now() <= DEADLINE) {
      const lines = subs.flatMap(f => [
        ...(f.fabricated_qualifier ? [`- you wrote "${f.fabricated_qualifier}"; write only "the ${[f.home, f.away].find(n => n && f.fabricated_qualifier.endsWith(n)) || f.fabricated_qualifier}"`] : []),
        ...f.missing_team.map(n => `- "${n}" is not named in your answer; the game's score appears, so name both teams as written in ALL RESULTS`),
      ]);
      const corrected = `${prompt}\n\nCORRECTION: your previous draft was rejected.\n${lines.join('\n')}\n` +
        `Rewrite the paragraph. Use each team's name exactly as written in ALL RESULTS, with no city added.`;
      const again = await withTimeout(callProxyDetailed({ RELAY_SHARED_SECRET: SECRET }, corrected, { maxTokens: 250 }), PER_CALL_MS);
      const subs2 = teamNameSubstitutions(again.text, recapGames);
      s.retry = { model: again.model, failure: again.failure, words: again.text ? words(again.text) : 0, rejected: subs2.length > 0, offenders: subs2, prose: again.text };
      console.log(`      retry  ${String(again.model)}  ${again.failure ? `NO TEXT (${again.failure})` : subs2.length ? `still REJECT x${subs2.length}` : 'accept'}`);
      await new Promise(r => setTimeout(r, PACE_MS));
    }
  }
}

// ── summary ─────────────────────────────────────────────────────────────────
const all = out.dates.flatMap(d => d.samples.map(s => ({ date: d.date, ...s })));
const tally = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
out.summary = {
  samples: all.length,
  answered: all.filter(s => !s.failure).length,
  no_text: tally(all.filter(s => s.failure).map(s => s.failure)),
  accepted: all.filter(s => !s.failure && !s.rejected).length,
  rejected: all.filter(s => s.rejected).length,
  rejected_by_date: tally(all.filter(s => s.rejected).map(s => s.date)),
  qualifiers: tally(all.flatMap(s => s.offenders.map(f => f.fabricated_qualifier)).filter(Boolean)),
  missing_teams: tally(all.flatMap(s => s.offenders.flatMap(f => f.missing_team))),
  models: tally(all.map(s => s.model).filter(Boolean)),
  // The retry experiment: of the answers the guard rejected, how many did one corrective retry fix?
  retried: all.filter(s => s.retry).length,
  retry_accepted: all.filter(s => s.retry && !s.retry.failure && !s.retry.rejected).length,
  retry_still_rejected: all.filter(s => s.retry && s.retry.rejected).length,
  retry_no_text: all.filter(s => s.retry && s.retry.failure).length,
};
console.log('\n=== summary ===');
console.log(JSON.stringify(out.summary, null, 2));
for (const d of out.dates) {
  const rej = d.samples.find(s => s.rejected);
  if (rej) console.log(`\n--- first REJECTED answer for ${d.date} (model ${rej.model}) ---\n${rej.prose}`);
}

mkdirSync('outbox', { recursive: true });
writeFileSync('outbox/morning-report-guard-replay-latest.json', JSON.stringify(out, null, 2));
console.log('\nwrote outbox/morning-report-guard-replay-latest.json');
