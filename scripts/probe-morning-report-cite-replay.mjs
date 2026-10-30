#!/usr/bin/env node
// Replays the Morning Report (Phase 5) under the pick / open / close contract against the real
// proxy. READ-ONLY: nothing is written to D1 or KV.
//
// WHY. src/morning-report.js has the model choose which games to feature (`pick:`) and write the
// opening and closing sentence (`open:`, `close:`). The relay writes everything about a game: the
// team names, the score and the one sentence about the result, all from the game's row
// (docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md, Task 3 option 4, then Task 4).
// Whether the production model (gemini-3.1-flash-lite behind field-claude-proxy) FOLLOWS that
// contract is a fact about a service the sandbox cannot call: reading the prompt does not
// tell you. This asks, once per date, with the prompt built by the production function from
// the production inputs and the answer judged by the production parser. Nothing here
// re-implements any of the three: prepareMorningReport / callProxyDetailed /
// finishMorningReport are the functions the cron runs.
//
// What it measures, beyond "did a paragraph come out":
//   - how many of the model's lines broke which rule (digit, team-name, unknown-id, ...),
//     counted from the RAW answer before any line is dropped;
//   - every slate name found in the raw answer, and every digit found in its open and close
//     lines (a pick line is a list of ids such as g12 and carries digits by design), so a model
//     that ignores "never write a name" shows up even where the parser would have dropped it;
//   - for each pick, the row's descriptor, the fact line and the sentence the relay wrote, kept
//     so each sentence can be checked against its row afterwards;
//   - how many open and close lines carry the markers the three earlier replays counted in the
//     model's per-game lines (words that say how a game went), and how many opens say a result
//     was unexpected;
//   - whether a paragraph was composed, how long it is, and how many games it cites.
// Raw answers and composed paragraphs are kept in the output so they can be READ.
//
// Rule 78: each date is one real inference at the production max_tokens. Defaults are 11
// dates x 1 sample = 11 calls, one at a time, PACE_MS apart, so the 30 requests a minute
// that the proxy's own header comment gives its Gemini key cannot be reached even if every
// call answered at once. (That comment is a copy of whatever the key's tier was when it was
// written; the pacing does not rely on it.) A 429 is recorded as `http-429` and not retried.
// DATES / SAMPLES override. Earlier replays returned byte-identical answers for repeated
// samples of one prompt, so more dates is more information than more samples.
//
// Inputs are rebuilt from public routes: /context/date/{D} for the games, and
// /analytics/newspaper/{D+1} for night_stars and truth_is (that bundle's recap date is the
// day before the date asked for). They are fetched now, not at 09:00Z the next day, so a
// game finalised since then can differ; `fetched_at` is recorded for that reason.
//
// Without RELAY_SHARED_SECRET it builds and reports the prompts and makes no proxy call,
// and says so. It never prints the secret.
import { mkdirSync, writeFileSync } from 'node:fs';
import { callProxyDetailed } from '../src/analytics-engine.js';
import { prepareMorningReport, finishMorningReport, MR_MAX_TOKENS } from '../src/morning-report.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DATES = (process.env.DATES || '2026-10-19,2026-10-20,2026-10-21,2026-10-22,2026-10-23,2026-10-24,2026-10-25,2026-10-26,2026-10-27,2026-10-28,2026-10-29')
  .split(',').map(s => s.trim()).filter(Boolean);
const SAMPLES = Number(process.env.SAMPLES) || 1;
const SECRET = process.env.RELAY_SHARED_SECRET;
const DEADLINE = Date.now() + 4 * 60 * 1000;
const PER_CALL_MS = 40000;
const PACE_MS = 2500;

const nextDay = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const words = (s) => s.split(/\s+/).filter(Boolean).length;

// A labelled line is `open:`, `close:` or `pick:`. A pick line is a list of ids (g1, g12), which
// carry digits by design, so digits, names and wording are measured on the prose: the open and
// close lines and any line the model wrote without a label.
const LABEL = /^\s*(open|close|picks?)\s*:\s*/i;
const linesOf = (raw) => raw.split(/\r?\n/).filter(l => l.trim()).map(l => {
  const m = LABEL.exec(l);
  return m ? { label: m[1].toLowerCase().replace(/s$/, ''), body: l.slice(m[0].length) } : { label: null, body: l };
});
const proseOf = (raw) => linesOf(raw).filter(l => l.label !== 'pick');
const bodyOf = (raw) => proseOf(raw).map(l => l.body);
// Words the prompt rules forbid or discourage. Counted for the reader of the result, never used to
// drop a line: the contract does not judge prose (src/morning-report.js).
const WATCH = ['home', 'visitor', 'host', 'closest', 'biggest', 'rhythm', 'tapestry', 'marvel', 'lessons', 'hard-fought', 'hard fought',
  'brand new day', 'quiet hours', 'spark', 'secured', 'comeback', 'exhibition', 'classic', 'throughout', 'until the', 'pull(?:ed|ing)? away',
  'traded', 'trading', 'remained', 'maintained', 'tense', 'tight'];
// The one fixed list of markers the three earlier replays applied to the model's per-game lines
// (words that describe how a game went), applied here to the open and close lines so the counts
// can be put side by side. Counted for the reader; never used to drop a line.
const FLOW = {
  timing: /\b(throughout|until the|from the (very )?(first|start|opening|outset)|early on|to the end|until the end|duration of|final (moments|buzzer|whistle|out))\b/i,
  course: /\b(traded|trading|pull(ed|ing)? away|maintained|controlled the pace|mounted|surged|rallied|comeback|battled|remained (tense|tight|competitive|undecided))\b/i,
  conduct: /\b(poise|composure|resolve|focus(ed)?|tension|tense|tight(ly)?|thrilling|exhilarating|intense|intensity|spirited|relentless|effort)\b/i,
  audience: /\b(spectators|fans|observers|crowd|engaged)\b/i,
  label: /\b(exhibition|classic|rivalry)\b/i,
};
// A claim about what was expected: the one fact the prompt tells the model it does not have.
const UNEXPECTED = /\bunexpected/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

// A call that never answers must not eat the whole run. The timer is cleared when the call
// wins: an uncleared one keeps the process alive for the full `ms` after the last answer,
// which is paid-for runner time.
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
  max_tokens: MR_MAX_TOKENS,
  samples_per_date: SAMPLES,
  proxy_calls_enabled: Boolean(SECRET),
  dates: [],
};

console.log(`=== morning-report cite replay  dates=${DATES.length} (${DATES[0]}..${DATES[DATES.length - 1]})  samples=${SAMPLES}  proxy=${SECRET ? 'on' : 'OFF (no RELAY_SHARED_SECRET: prompts only)'} ===`);

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
  const prepared = prepareMorningReport(date, { stars, truthIs, ctx });
  rec.inputs = {
    recap_games: prepared.recapGames.length,
    citable: prepared.citable.length,
    night_stars: Boolean(stars),
    truth_type: truthIs ? truthIs.type : null,
    truth_headline: truthIs ? truthIs.headline : null,
    stored_morning_report: bundle.morning_report,
    prompt_chars: prepared.prompt.length,
  };
  console.log(`${date}  citable ${prepared.citable.length}/${prepared.recapGames.length}  truth ${rec.inputs.truth_type}  stored: ${String(bundle.morning_report).slice(0, 50)}`);
  if (!SECRET) continue;
  const byId = new Map(prepared.citable.map(c => [c.id, c]));

  for (let i = 1; i <= SAMPLES; i++) {
    if (Date.now() > DEADLINE) { out.truncated = true; break; }
    const res = await withTimeout(callProxyDetailed({ RELAY_SHARED_SECRET: SECRET }, prepared.prompt, { maxTokens: MR_MAX_TOKENS }), PER_CALL_MS);
    const { parsed, composed } = finishMorningReport(res.text, prepared, truthIs);
    // Measured on the RAW answer: what the model did before any line was dropped.
    const raw = res.text || '';
    const slateHits = prepared.slateNames.filter(nm => new RegExp(`(?<![A-Za-z])${escapeRe(nm)}(?![A-Za-z])`).test(raw));
    const proseLines = proseOf(raw).filter(l => l.label === 'open' || l.label === 'close');
    const s = {
      sample: i,
      model: res.model,
      failure: res.failure,
      raw_words: words(raw),
      raw_lines: raw ? raw.split(/\r?\n/).filter(l => l.trim()).length : 0,
      recognized_lines: parsed.recognized,
      pick_ids: parsed.picks.map(p => p.entry.id),
      has_open: Boolean(parsed.open),
      has_close: Boolean(parsed.close),
      dropped: parsed.dropped,
      raw_slate_names: slateHits,
      raw_body_has_digit: bodyOf(raw).some(b => /\p{N}/u.test(b)),
      watch_hits: WATCH.filter(w => bodyOf(raw).some(b => new RegExp(`\\b${w}`, 'i').test(b))),
      prose_lines: proseLines.map(l => ({
        label: l.label,
        words: words(l.body),
        flow: Object.keys(FLOW).filter(k => FLOW[k].test(l.body)),
        unexpected: UNEXPECTED.test(l.body),
        starts_we_look_forward: /^we look forward/i.test(l.body.trim()),
      })),
      composed: Boolean(composed),
      composed_words: composed ? words(composed.text) : 0,
      cited: composed ? composed.cited : [],
      // What the relay printed for each pick, with the descriptor the model was shown for it, so the
      // sentence can be checked against the game's row afterwards.
      picks: composed ? composed.games.map(g => ({
        id: g.id, game_id: g.gameId, descriptor: byId.get(g.id)?.descriptor ?? null, fact: g.fact, sentence: g.sentence,
      })) : [],
      raw,
      text: composed ? composed.text : null,
    };
    rec.samples.push(s);
    const verdict = res.failure ? `NO TEXT (${res.failure})`
      : composed ? `composed ${s.composed_words}w, ${s.pick_ids.length} games${parsed.dropped.length ? `, dropped ${parsed.dropped.map(d => `${d.key ?? '-'}:${d.reason}`).join(' ')}` : ''}`
      : `NOT COMPOSED  dropped ${parsed.dropped.map(d => `${d.key ?? '-'}:${d.reason}`).join(' ') || 'none'}`;
    console.log(`  #${i}  ${String(res.model)}  ${verdict}${slateHits.length ? `  SLATE NAMES IN RAW: ${slateHits.join(', ')}` : ''}`);
    await new Promise(r => setTimeout(r, PACE_MS));
  }
}

// ── summary ─────────────────────────────────────────────────────────────────
const all = out.dates.flatMap(d => d.samples.map(s => ({ date: d.date, ...s })));
const tally = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
const prose = all.flatMap(s => s.prose_lines);
const picks = all.flatMap(s => s.picks);
out.summary = {
  samples: all.length,
  answered: all.filter(s => !s.failure).length,
  no_text: tally(all.filter(s => s.failure).map(s => s.failure)),
  composed: all.filter(s => s.composed).length,
  not_composed: all.filter(s => !s.failure && !s.composed).length,
  with_open: all.filter(s => s.has_open).length,
  with_close: all.filter(s => s.has_close).length,
  picks_total: all.reduce((a, s) => a + s.pick_ids.length, 0),
  picks_with_a_relay_sentence: picks.filter(p => p.sentence).length,
  picks_with_the_fact_line_only: picks.filter(p => !p.sentence).length,
  dropped_by_reason: tally(all.flatMap(s => s.dropped.map(d => d.reason))),
  raw_answers_naming_a_slate_team: all.filter(s => s.raw_slate_names.length).length,
  raw_answers_with_a_digit_in_a_prose_line: all.filter(s => s.raw_body_has_digit).length,
  prose_lines: prose.length,
  prose_lines_with_a_flow_marker: prose.filter(l => l.flow.length).length,
  flow_markers_by_kind: tally(prose.flatMap(l => l.flow)),
  opens_saying_unexpected: prose.filter(l => l.label === 'open' && l.unexpected).length,
  closes_starting_we_look_forward: prose.filter(l => l.label === 'close' && l.starts_we_look_forward).length,
  watch_words_in_prose: tally(all.flatMap(s => s.watch_hits)),
  composed_words: all.filter(s => s.composed).map(s => s.composed_words),
  models: tally(all.map(s => s.model).filter(Boolean)),
};
console.log('\n=== summary ===');
console.log(JSON.stringify(out.summary, null, 2));
for (const d of out.dates) {
  for (const s of d.samples) {
    if (s.text) console.log(`\n--- ${d.date} (${s.composed_words} words) ---\n${s.text}`);
    else if (s.raw) console.log(`\n--- ${d.date} NOT COMPOSED, raw answer ---\n${s.raw}`);
  }
}

mkdirSync('outbox', { recursive: true });
writeFileSync('outbox/morning-report-cite-replay-latest.json', JSON.stringify(out, null, 2));
console.log('\nwrote outbox/morning-report-cite-replay-latest.json');
