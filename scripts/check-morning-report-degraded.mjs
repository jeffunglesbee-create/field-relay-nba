#!/usr/bin/env node
// Phase 5, end to end: what the row says, and what the paragraph is made of.
//
// runPhase5MorningReport writes one fixed template -- "Quiet night across the slate for
// ${date}. Tomorrow brings another set." -- when it has nothing better, and until 2026-10-30
// the row was identical whatever the cause and phase 5 counted as completed on every path
// (analytics_runs.errors stayed [] while 16 of the 22 mornings 2026-10-08..29 were the
// template). Since 2026-10-30 the row says why, and the paragraph is no longer the model's:
// src/morning-report.js has the model pick games by id and write only an open and a close line,
// and has the relay print every team name, every score and the sentence about each game.
// scripts/check-morning-report-cite.mjs pins that contract on the pure functions;
// THIS pins the phase around it, through the real recomputeMorningReport -- the exported
// entry that reads night_stars / truth_is from D1, fetches the context graph, calls the proxy
// and writes the row -- against a mocked proxy, a mocked relay and a mocked D1.
//
// The record, on the row itself:
//   degraded:false                      a morning that printed games
//                                       + cited [game ids], + dropped [{key,reason}] when the
//                                       model's answer had lines or ids the contract refused
//   degraded:false, no_games            the night has no completed game; the template is accurate
//   degraded:true, no-context           the context graph was unreadable (Phase 1 failed)
//   degraded:true, prose-empty          + proxy_failure  http-<status> | bad-json | no-text
//   degraded:true, bad-structure        + structure {recognized, dropped}: text came back and no
//                                       pick in it followed the contract
// and the one arithmetic the 2026-10-30 diagnosis rests on: an answer that came back counts its
// AI call (aiCalls 1) whether or not a line survived; an empty one does not (aiCalls 0); a night
// with nothing to cite makes no call at all.
// docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md
//
// Rule 90: mutation-tested by scripts/mutate-morning-report-degraded.mjs.
import { recomputeMorningReport, callProxyDetailed } from '../src/analytics-engine.js';
import { prepareMorningReport, MR_MAX_TOKENS } from '../src/morning-report.js';

// A crash inside the code under test is a failure of this check, said in the same words
// as any other, not a stack trace the mutation runner has to guess at.
process.on('uncaughtException', (e) => { console.log(`FAIL  the check crashed — ${e.message}`); process.exit(1); });

let fails = 0, n = 0;
const ok = (f, why) => {
  n++;
  let pass = false;
  try { pass = (typeof f === 'function' ? f() : f) === true; }
  catch (e) { console.log(`FAIL  ${why} — threw ${e.message}`); fails++; return; }
  if (!pass) { fails++; console.log(`FAIL  ${why}`); }
};

const PROXY = 'https://field-claude-proxy.jeffunglesbee.workers.dev';
const RELAY = 'https://relay.test';
const DATE = '2026-10-29';
const TEMPLATE = `Quiet night across the slate for ${DATE}. Tomorrow brings another set.`;

// Rows shaped like /context/date/2026-10-29: bare mascots, away first, each with an id.
const GAMES = [
  { id: 'NHL_2026-10-29_a',  sport: 'NHL',  away: 'Jets',      home: 'Lightning',     away_score: 4,   home_score: 6,   note: null },
  { id: 'NBA_2026-10-29_b',  sport: 'NBA',  away: 'Cavaliers', home: 'Hawks',         away_score: 111, home_score: 114, note: null },
  { id: 'WNBA_2026-10-29_c', sport: 'WNBA', away: 'Valkyries', home: 'Dream',         away_score: 69,  home_score: 80,  note: null },
  { id: 'NBA_2026-10-29_d',  sport: 'NBA',  away: 'Kings',     home: 'Pelicans',      away_score: 120, home_score: 132, note: null },
  { id: 'NBA_2026-10-29_e',  sport: 'NBA',  away: 'Grizzlies', home: 'Trail Blazers', away_score: 124, home_score: 103, note: null },
];
const CTX = { ok: true, date: DATE, games: { regular: GAMES, postseason: [] } };
const STARS = { stars: 3, totalGames: 33, dramaGames: 4, closeGames: 6, walkoffs: 0 };
const TRUTH = { type: 'none', headline: "Quiet night. The truth is, sometimes that's the story." };

// An answer in the form the prompt asks for: the games to feature, an opening sentence and a closing
// one. None of these lines has a digit or a name from the slate.
const OPEN = 'A calm evening with a few results worth a second look.';
const CLOSE = 'Tomorrow brings another chance for something unexpected.';
const GOOD = [`open: ${OPEN}`, 'pick: g1, g2, g3', `close: ${CLOSE}`].join('\n');
// What the relay prints from it: the headline, the open line, then each picked game's fact and the
// sentence the relay writes about that result from the row, then the close line. The sentences are
// worked out by hand from the rows above: 6-4 is a plain two-goal win; 114-111 is three points,
// narrow in basketball; 80-69 is a plain eleven-point win and the second plain win in the report, so
// it takes the second phrasing of its kind.
const S_LIGHTNING = 'A two-goal win.';
const S_HAWKS = 'A narrow three-point win.';
const S_DREAM = 'Won by eleven points.';
const BRIEF_GOOD = [TRUTH.headline, OPEN, `Lightning 6, Jets 4. ${S_LIGHTNING}`, `Hawks 114, Cavaliers 111. ${S_HAWKS}`,
  `Dream 80, Valkyries 69. ${S_DREAM}`, CLOSE].join(' ');

// Lines the contract refuses: a digit, a name from tonight's slate, an id that is not in the list, a word
// on the pick line that is not an id. Each is distinctive so "it is not stored" can be searched for.
const L_DIGIT = 'Won by 3 points in a tense game that nobody will forget soon.';
const L_NAME = 'The Dream pulled away late in a game that felt decided early.';
const STRAY = 'unforgettable';
const L_OLD_FORM = 'A tense game that stayed in doubt until the final minute.';
const WITH_DROPS = [`open: ${L_DIGIT}`, `pick: g1, g9, ${STRAY}, g2`, `close: ${L_NAME}`].join('\n');
const NO_USABLE = [`open: ${OPEN}`, 'pick: g9, g12', `close: ${CLOSE}`].join('\n');
// The retired form (a sentence for each game): nothing in it is a pick, so nothing is printed.
const OLD_FORM = [`open: ${OPEN}`, `g1: ${L_OLD_FORM}`, `g2: ${L_OLD_FORM}`, `close: ${CLOSE}`].join('\n');
// The model ignores the form and writes a paragraph, with a team and a score in it.
const FREE_PROSE = 'Quiet in Tampa until the Lightning beat the Jets 6-4, and the Hawks edged the Cavaliers 114-111.';

const reply = (status, body, headers = {}) => () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const textReply = (text) => reply(200, { content: [{ type: 'text', text }] }, { 'X-FIELD-Model': 'gemini-3.1-flash-lite' });

// One recompute against a mocked world. `proxy` is called once per proxy request.
// `ctxBody` is what /context/date answers (null is a body of "null": no context at all).
async function run(proxy, { ctxBody = CTX, truth = TRUTH } = {}) {
  const sent = [], writes = [], kv = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === PROXY) { sent.push({ body: JSON.parse(init.body), headers: init.headers }); return proxy(); }
    if (u === `${RELAY}/context/date/${DATE}`) return new Response(JSON.stringify(ctxBody), { status: 200 });
    throw new Error(`unmocked fetch ${u}`);
  };
  const env = {
    RELAY_SHARED_SECRET: 'test-secret',
    RELAY_BASE: RELAY,
    FIELD_JOURNALISM: { put: async (k, v) => { kv.push([k, v]); } },
    ARCHIVE_DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => sql.includes("'night_stars'") ? { value: JSON.stringify(STARS) }
            : sql.includes("'truth_is'") ? { value: JSON.stringify(truth) }
            : { brief_text: 'previous brief' },
          run: async () => { writes.push({ sql, args }); return {}; },
        }),
      }),
    },
  };
  // Phase 5 logs a refused line with console.error; capture it so it is asserted, not printed.
  const logged = [];
  const realError = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  let result;
  try { result = await recomputeMorningReport(env, DATE); }
  finally { console.error = realError; }
  // INSERT OR REPLACE bind order: id, date, feature, sport, value, brief_text.
  const w = writes.find(x => x.args[2] === 'morning_report');
  return { result, sent, kv, logged, row: w ? { value: JSON.parse(w.args[4]), raw: w.args[4], brief: w.args[5] } : null };
}

// ── callProxyDetailed: a null answer keeps its reason ───────────────────────
{
  const env = { RELAY_SHARED_SECRET: 'test-secret' };
  const call = async (r) => { globalThis.fetch = async () => r(); return callProxyDetailed(env, 'p', { maxTokens: 10 }); };
  const good = await call(textReply('  hello  '));
  ok(() => good.text === 'hello' && good.failure === null, 'an answer comes back trimmed with no failure');
  ok(() => good.model === 'gemini-3.1-flash-lite', 'the model that answered is reported from X-FIELD-Model');
  const h502 = await call(reply(502, 'bad gateway'));
  ok(() => h502.text === null && h502.failure === 'http-502', 'an HTTP status is kept in the failure (http-502)');
  const bad = await call(reply(200, 'not json'));
  ok(() => bad.text === null && bad.failure === 'bad-json', 'a body that is not JSON is bad-json');
  const none = await call(reply(200, { content: [] }));
  ok(() => none.text === null && none.failure === 'no-text', 'an empty content array is no-text');
  const blank = await call(textReply('   '));
  ok(() => blank.text === null && blank.failure === 'no-text', 'whitespace-only text is no-text');
}

// ── a good morning ──────────────────────────────────────────────────────────
{
  const r = await run(textReply(GOOD));
  const v = r.row.value;
  ok(() => v.degraded === false, 'a good morning writes degraded:false (a row without the key predates this)');
  ok(() => !('degraded_reason' in v) && !('structure' in v) && !('proxy_failure' in v) && !('dropped' in v) && !('no_games' in v),
    'a good morning carries no reason fields');
  ok(() => r.row.brief === BRIEF_GOOD,
    'a good morning prints the headline, the open line, each picked game\'s fact and the relay\'s sentence about it, then the close line');
  ok(() => r.kv.length === 1 && r.kv[0][0] === `field:morning_report:${DATE}` && r.kv[0][1] === BRIEF_GOOD,
    'a good morning stores the same text in D1 and in KV');
  ok(() => JSON.stringify(v.cited) === JSON.stringify(['NHL_2026-10-29_a', 'NBA_2026-10-29_b', 'WNBA_2026-10-29_c']),
    'a good morning names the games it cited, by their real ids');
  ok(() => v.stars === 3 && v.word_count === BRIEF_GOOD.split(/\s+/).length, 'word_count and stars are still written');
  ok(() => r.result.aiCalls === 1 && r.result.outcome.degraded === false && r.result.before === 'previous brief',
    'recompute returns before, aiCalls 1 and the outcome');
  ok(() => r.logged.length === 0, 'a good morning logs nothing');
  const req = r.sent[0];
  ok(() => r.sent.length === 1 && req.body.model === 'claude-haiku-4-5-20251001' && req.body.max_tokens === MR_MAX_TOKENS
      && req.headers['X-FIELD-Relay'] === 'test-secret',
    'phase 5 makes exactly one proxy call, with the production model, max_tokens and secret header');
  ok(() => req.body.messages[0].content === prepareMorningReport(DATE, { stars: STARS, truthIs: TRUTH, ctx: CTX }).prompt,
    'phase 5 sends the prepared prompt');
}

// ── lines and ids the contract refuses, in an answer that still has a usable pick ──
{
  const r = await run(textReply(WITH_DROPS));
  const v = r.row.value;
  ok(() => v.degraded === false && JSON.stringify(v.dropped) === JSON.stringify([
      { key: 'open', reason: 'digit' }, { key: 'g9', reason: 'unknown-id' }, { key: 'pick', reason: 'unrecognized-pick' },
      { key: 'close', reason: 'team-name' }]),
    'a dropped line, id or word is recorded by key and reason on a good morning');
  ok(() => r.row.brief === [TRUTH.headline, `Lightning 6, Jets 4. ${S_LIGHTNING}`, `Hawks 114, Cavaliers 111. ${S_HAWKS}`].join(' '),
    'a good morning with dropped lines still prints the games that were picked, and only what followed the contract');
  ok(() => ![L_DIGIT, L_NAME, STRAY, 'Won by', 'pulled away late'].some(t => r.row.raw.includes(t) || r.row.brief.includes(t)),
    'the dropped text is not stored, in the value or the brief (the value is served publicly)');
  ok(() => r.logged.length === 1 && r.logged[0].includes('dropped lines') && r.logged[0].includes('open:digit')
      && r.logged[0].includes('g9:unknown-id') && r.logged[0].includes('pick:unrecognized-pick') && r.logged[0].includes('close:team-name')
      && !r.logged[0].includes('Won by') && !r.logged[0].includes(STRAY),
    'dropped lines are logged once, by key and reason, without their text');
  ok(() => r.result.aiCalls === 1, 'an answer with dropped lines counts its AI call');
}

// ── no pick followed the contract ───────────────────────────────────────────
{
  const r = await run(textReply(NO_USABLE));
  const v = r.row.value;
  ok(() => v.degraded === true && v.degraded_reason === 'bad-structure' && !('proxy_failure' in v) && !('cited' in v),
    'a morning with no usable pick is recorded as degraded, reason bad-structure');
  ok(() => v.structure.recognized === 3 && JSON.stringify(v.structure.dropped) === JSON.stringify([
      { key: 'g9', reason: 'unknown-id' }, { key: 'g12', reason: 'unknown-id' }]),
    'bad-structure names the ids it dropped and why');
  ok(() => r.row.brief === TEMPLATE && r.kv[0][1] === TEMPLATE,
    'a morning with no usable pick writes the template, in D1 and in KV (text unchanged)');
  ok(() => r.result.aiCalls === 1, 'an answer with no usable pick still counts its AI call');
  ok(() => r.logged.length === 1 && r.logged[0].includes('no usable game line') && r.logged[0].includes('g9:unknown-id'),
    'a morning with no usable pick is logged once, by key and reason');
  // The words of THIS answer (its open and close lines), not of another one: a check for text the answer
  // never held would pass whether or not the value stored it.
  ok(() => ![OPEN, CLOSE].some(t => r.row.raw.includes(t)) && !r.row.brief.includes('g12'),
    'the answer text is not stored in the value (it is served publicly)');
}
{
  const r = await run(textReply(OLD_FORM));
  const v = r.row.value;
  ok(() => v.degraded === true && v.degraded_reason === 'bad-structure' && v.structure.recognized === 2
      && JSON.stringify(v.structure.dropped) === JSON.stringify([{ key: null, reason: 'unrecognized-line' }, { key: null, reason: 'unrecognized-line' }])
      && r.row.brief === TEMPLATE && !r.row.raw.includes(L_OLD_FORM),
    'an answer in the retired form (a sentence for each game) is bad-structure and prints no model sentence about a game');
}
{
  const r = await run(textReply(FREE_PROSE));
  const v = r.row.value;
  ok(() => v.degraded_reason === 'bad-structure' && v.structure.recognized === 0
      && JSON.stringify(v.structure.dropped) === JSON.stringify([{ key: null, reason: 'unrecognized-line' }])
      && r.row.brief === TEMPLATE && !r.row.raw.includes('Tampa') && !r.row.raw.includes('Lightning'),
    'an answer that ignores the form is bad-structure, recognised 0, and its text is not stored');
}

// ── the proxy gave nothing ──────────────────────────────────────────────────
{
  const r = await run(reply(500, 'internal error'));
  const v = r.row.value;
  ok(() => v.degraded === true && v.degraded_reason === 'prose-empty', 'an HTTP failure is recorded as degraded, reason prose-empty');
  ok(() => v.proxy_failure === 'http-500' && !('structure' in v), 'an HTTP failure keeps its status and carries no structure record');
  ok(() => r.row.brief === TEMPLATE && r.kv[0][1] === TEMPLATE, 'an HTTP failure writes the template (text unchanged)');
  ok(() => r.result.aiCalls === 0, 'an empty answer counts no AI call');
  ok(() => r.logged.length === 0, 'an empty answer is not logged as a refused one');
}
{
  const r = await run(reply(200, { content: [] }));
  ok(() => r.row.value.degraded_reason === 'prose-empty' && r.row.value.proxy_failure === 'no-text', 'an empty 200 is prose-empty / no-text');
}
{
  const r = await run(reply(200, '<html>error code: 1101</html>'));
  ok(() => r.row.value.degraded_reason === 'prose-empty' && r.row.value.proxy_failure === 'bad-json', 'a non-JSON 200 is prose-empty / bad-json');
}

// ── nothing to cite: no model call ──────────────────────────────────────────
{
  const r = await run(textReply(GOOD), { ctxBody: null });
  const v = r.row.value;
  ok(() => v.degraded === true && v.degraded_reason === 'no-context' && !('no_games' in v),
    'a missing context is recorded as degraded, reason no-context');
  ok(() => r.sent.length === 0, 'a missing context asks the model for nothing');
  ok(() => r.row.brief === TEMPLATE && r.kv[0][1] === TEMPLATE && r.result.aiCalls === 0,
    'a missing context writes the template and counts no AI call');
}
{
  const quiet = { ok: true, date: DATE, games: { regular: [{ id: 'x', sport: 'NBA', away: 'Kings', home: 'Hawks', away_score: null, home_score: null, note: null }], postseason: [] } };
  const r = await run(textReply(GOOD), { ctxBody: quiet });
  const v = r.row.value;
  ok(() => v.degraded === false && v.no_games === true && !('degraded_reason' in v),
    'a night with no game is not degraded (the template is accurate)');
  ok(() => r.sent.length === 0, 'a night with no game asks the model for nothing');
  ok(() => r.row.brief === TEMPLATE && r.kv[0][1] === TEMPLATE && r.result.aiCalls === 0,
    'a night with no game writes the template and counts no AI call');
}

// ── Phase 3's game is printed once ──────────────────────────────────────────
{
  const r = await run(textReply(GOOD), { truth: { ...TRUTH, game_id: GAMES[0].id } });
  const prompt = r.sent[0].body.messages[0].content;
  ok(() => prompt.includes('g1 | NBA | final 114-111') && !prompt.includes('g5 |')
      && r.row.brief.includes(`Hawks 114, Cavaliers 111. ${S_HAWKS}`) && !r.row.brief.includes('Lightning 6, Jets 4'),
    'the truth game is printed once: as Phase 3\'s headline, not again as a cited game');
}

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
