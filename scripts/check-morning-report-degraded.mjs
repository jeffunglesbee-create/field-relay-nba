#!/usr/bin/env node
// Why did the Morning Report say "Quiet night"?
//
// runPhase5MorningReport writes one fixed template -- "Quiet night across the
// slate for ${date}. Tomorrow brings another set." -- on two different paths: the
// proxy returned no text, or it returned text and the team-name guard threw the
// text away. Until 2026-10-30 the row was identical on both paths and phase 5
// counted as completed on both, so analytics_runs.errors stayed [] while 16 of
// the 22 mornings 2026-10-08..29 were the template, with nothing to say which
// cause it was.
//
// This pins the record that now says so, on the row itself:
//   degraded:false                      a morning that produced prose
//   degraded:true, prose-empty          + proxy_failure  http-<status> | bad-json | no-text
//   degraded:true, team-name-guard      + guard {offenders, first{...}}
// and the one fact the 2026-10-30 diagnosis rests on: a REJECTED answer still
// counts its AI call (aiCalls 1), an EMPTY one does not (aiCalls 0). The
// arithmetic is in docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md.
//
// It runs the real recomputeMorningReport -- the exported entry point that
// reads night_stars / truth_is from D1, fetches the context graph, calls the
// proxy and writes the row -- against a mocked proxy and a mocked D1.
//
// Rule 90: mutation-tested by scripts/mutate-morning-report-degraded.mjs.
import {
  recomputeMorningReport, teamNameSubstitutions, buildMorningReportPrompt,
  selectRecapGames, callProxyDetailed,
} from '../src/analytics-engine.js';

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

// Real rows from /context/date/2026-10-29: bare mascots, away first.
const GAMES = [
  { sport: 'NHL',  away: 'Jets',      home: 'Lightning',     away_score: 4,   home_score: 6,   note: null },
  { sport: 'NBA',  away: 'Cavaliers', home: 'Hawks',         away_score: 111, home_score: 114, note: null },
  { sport: 'WNBA', away: 'Valkyries', home: 'Dream',         away_score: 69,  home_score: 80,  note: null },
  { sport: 'NBA',  away: 'Kings',     home: 'Pelicans',      away_score: 120, home_score: 132, note: null },
  { sport: 'NBA',  away: 'Grizzlies', home: 'Trail Blazers', away_score: 124, home_score: 103, note: null },
];
const CTX = { ok: true, date: DATE, games: { regular: GAMES, postseason: [] } };
const STARS = { stars: 3, totalGames: 33, dramaGames: 4, closeGames: 6, walkoffs: 0 };
const TRUTH = { headline: "Quiet night. The truth is, sometimes that's the story." };

const PROSE_OK = 'The Lightning beat the Jets 6-4 and the Hawks edged the Cavaliers 114-111, while the Dream topped the Valkyries 80-69. The schedule thinned out from there.';
const PROSE_QUALIFIER = 'The Tampa Bay Lightning beat the Jets 6-4 and the Hawks edged the Cavaliers 114-111.';
const PROSE_MISSING = 'Tampa won 6-4 over the Jets, and the Hawks edged the Cavaliers 114-111.';
const PROSE_NO_SCORE = 'The Tampa Bay Lightning had a big night against the Jets.';

const reply = (status, body, headers = {}) => () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const textReply = (text) => reply(200, { content: [{ type: 'text', text }] }, { 'X-FIELD-Model': 'gemini-3.1-flash-lite' });

// One recompute against a mocked world. `proxy` is called once per proxy request.
async function run(proxy) {
  const sent = [], writes = [], kv = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === PROXY) { sent.push({ body: JSON.parse(init.body), headers: init.headers }); return proxy(); }
    if (u === `${RELAY}/context/date/${DATE}`) return new Response(JSON.stringify(CTX), { status: 200 });
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
            : sql.includes("'truth_is'") ? { value: JSON.stringify(TRUTH) }
            : { brief_text: 'previous brief' },
          run: async () => { writes.push({ sql, args }); return {}; },
        }),
      }),
    },
  };
  // The guard logs its rejection with console.error; capture it so it is asserted, not printed.
  const logged = [];
  const realError = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  let result;
  try { result = await recomputeMorningReport(env, DATE); }
  finally { console.error = realError; }
  // INSERT OR REPLACE bind order: id, date, feature, sport, value, brief_text.
  const w = writes.find(x => x.args[2] === 'morning_report');
  return { result, sent, kv, logged, row: w ? { value: JSON.parse(w.args[4]), brief: w.args[5] } : null };
}

// ── the guard, as a pure function ───────────────────────────────────────────
const recap = selectRecapGames(CTX);
ok(() => recap.length === 5, 'selectRecapGames keeps games that have scores');
ok(() => teamNameSubstitutions('', recap).length === 0 && teamNameSubstitutions(null, recap).length === 0,
  'no prose is not a guard finding (that is the proxy failing, recorded as prose-empty)');
ok(() => teamNameSubstitutions(PROSE_OK, recap).length === 0, 'bare mascots with "the" pass the guard');
ok(() => teamNameSubstitutions('The Lightning beat the Jets 6-4.', recap).length === 0,
  'a leading "The" is not a fabricated qualifier');
{
  const s = teamNameSubstitutions(PROSE_QUALIFIER, recap);
  ok(() => s.length === 1 && s[0].home === 'Lightning' && s[0].away === 'Jets' && s[0].score === '4-6',
    'a city-qualified name is caught, and the finding names the game and its score in recap order');
  ok(() => s[0].fabricated_qualifier === 'Bay Lightning' && s[0].missing_team.length === 0,
    'a city-qualified name is caught as a qualifier, with the text that tripped the rule');
}
{
  const s = teamNameSubstitutions(PROSE_MISSING, recap);
  ok(() => s.length === 1 && s[0].missing_team.length === 1 && s[0].missing_team[0] === 'Lightning' && s[0].fabricated_qualifier === null,
    'a missing team is caught as missing, by name, with no qualifier');
}
ok(() => teamNameSubstitutions('Jets 4-6 Tampa Bay Lightning', recap).length === 1,
  'a score written away-first is checked (4-6)');
ok(() => teamNameSubstitutions(PROSE_NO_SCORE, recap).length === 0,
  'prose that cites no score is not inspected (current behaviour of the guard)');
{
  const s = teamNameSubstitutions('The Tampa Bay Lightning beat the Jets 6-4 and the Atlanta Hawks edged the Cavaliers 114-111.', recap);
  ok(() => s.length === 2 && s[0].home === 'Lightning' && s[1].home === 'Hawks',
    'every offending game is reported, in recap order');
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

// ── the phase, end to end ───────────────────────────────────────────────────
{
  const r = await run(textReply(PROSE_OK));
  ok(() => r.row.value.degraded === false, 'a good morning writes degraded:false (a row without the key predates this)');
  ok(() => !('degraded_reason' in r.row.value) && !('guard' in r.row.value) && !('proxy_failure' in r.row.value),
    'a good morning carries no reason fields');
  ok(() => r.row.brief === PROSE_OK && r.kv[0][0] === `field:morning_report:${DATE}` && r.kv[0][1] === PROSE_OK,
    'a good morning stores the prose, in D1 and in KV');
  ok(() => r.row.value.stars === 3 && r.row.value.word_count > 10, 'word_count and stars are still written');
  ok(() => r.result.aiCalls === 1 && r.result.outcome.degraded === false && r.result.before === 'previous brief',
    'recompute returns before, aiCalls 1 and the outcome');
  ok(() => r.logged.length === 0, 'a good morning logs no rejection');
  const req = r.sent[0];
  ok(() => r.sent.length === 1 && req.body.model === 'claude-haiku-4-5-20251001' && req.body.max_tokens === 250
      && req.headers['X-FIELD-Relay'] === 'test-secret',
    'phase 5 makes exactly one proxy call, with the production model, max_tokens and secret header');
  ok(() => req.body.messages[0].content === buildMorningReportPrompt(DATE, { stars: STARS, truthIs: TRUTH, recapGames: selectRecapGames(CTX) }),
    'phase 5 sends the built prompt');
}
{
  const r = await run(textReply(PROSE_QUALIFIER));
  const v = r.row.value;
  ok(() => v.degraded === true && v.degraded_reason === 'team-name-guard',
    'a guard rejection is recorded as degraded, reason team-name-guard');
  ok(() => v.guard.offenders === 1 && v.guard.first.fabricated_qualifier === 'Bay Lightning'
      && v.guard.first.home === 'Lightning' && v.guard.first.away === 'Jets' && v.guard.first.score === '4-6',
    'a guard rejection names the game, the score and the qualifier that tripped it');
  ok(() => !('proxy_failure' in v), 'a guard rejection carries no proxy_failure');
  ok(() => r.row.brief === TEMPLATE && r.kv[0][1] === TEMPLATE,
    'a rejected answer is replaced by the template, in D1 and in KV (text unchanged)');
  ok(() => r.result.aiCalls === 1, 'a rejected answer still counts its AI call');
  ok(() => r.logged.length === 1 && r.logged[0].includes('morning_report rejected'), 'a guard rejection is logged once');
  ok(() => !JSON.stringify(v).includes(PROSE_QUALIFIER) && !JSON.stringify(v).includes('Tampa'),
    'the rejected prose is not stored (the value is served publicly)');
}
{
  const r = await run(textReply(PROSE_MISSING));
  const v = r.row.value;
  ok(() => v.degraded === true && v.degraded_reason === 'team-name-guard'
      && v.guard.first.missing_team.length === 1 && v.guard.first.missing_team[0] === 'Lightning'
      && v.guard.first.fabricated_qualifier === null,
    'a missing team is recorded as such, by name');
}
{
  const r = await run(reply(500, 'internal error'));
  const v = r.row.value;
  ok(() => v.degraded === true && v.degraded_reason === 'prose-empty', 'an HTTP failure is recorded as degraded, reason prose-empty');
  ok(() => v.proxy_failure === 'http-500' && !('guard' in v), 'an HTTP failure keeps its status and carries no guard record');
  ok(() => r.row.brief === TEMPLATE && r.kv[0][1] === TEMPLATE, 'an HTTP failure writes the template (text unchanged)');
  ok(() => r.result.aiCalls === 0, 'an empty answer counts no AI call');
  ok(() => r.logged.length === 0, 'an empty answer is not logged as a guard rejection');
}
{
  const r = await run(reply(200, { content: [] }));
  ok(() => r.row.value.degraded_reason === 'prose-empty' && r.row.value.proxy_failure === 'no-text', 'an empty 200 is prose-empty / no-text');
}
{
  const r = await run(reply(200, '<html>error code: 1101</html>'));
  ok(() => r.row.value.degraded_reason === 'prose-empty' && r.row.value.proxy_failure === 'bad-json', 'a non-JSON 200 is prose-empty / bad-json');
}
{
  const r = await run(textReply(PROSE_NO_SCORE));
  ok(() => r.row.value.degraded === false && r.row.brief === PROSE_NO_SCORE,
    'prose that cites no score is accepted as it always was');
}

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
