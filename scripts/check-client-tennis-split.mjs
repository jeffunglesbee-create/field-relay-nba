#!/usr/bin/env node
// Self-tests and mutations for scripts/lib/client-tennis-split.cjs.
//
// Rule 90: every assertion below has been made to fail on purpose. The parser
// this exercises decides whether tennis-tier-ladders.yml can be green, and its
// dangerous failure is not a crash — it is returning a SHORT or EMPTY exclusion
// list, which makes the drift comparison vacuously true. So the mutations aim
// at exactly that: an anchor that no longer matches, a map that parses to
// nothing, an alternation arm that is really two names.
//
// Rule 91: coverage is printed with the result. This checks the PARSER against
// fixtures. It does NOT reach jubilant-bassoon — the live and source reads are
// exercised by tennis-tier-ladders.mjs in CI, where a failure to read refuses
// rather than passes.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extractClientSplit, readClient, CLIENT_DEPLOYED_URL, CLIENT_SOURCE_URL } =
  require('./lib/client-tennis-split.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const throws = (name, text, needle) => {
  let msg = null;
  try { extractClientSplit(text, 'fixture'); } catch (e) { msg = e.message; }
  if (msg === null) { fail++; console.log(`  FAIL ${name} — did not throw`); return; }
  if (needle && !msg.includes(needle)) { fail++; console.log(`  FAIL ${name} — threw, but not about ${needle}: ${msg}`); return; }
  pass++; console.log(`  ok   ${name}`);
};

// The client's real shape as of 2026-10-07, abbreviated to the two anchors.
const CURRENT = `
const _TENNIS_DRAW_NAMED_RANK = {
  'ATP Finals': 1, 'WTA Finals': 1, 'Next Gen Finals': 2, 'United Cup': 2,
  // a comment between entries, because the client has one
  'Billie Jean King Cup': 2,
};
const _TENNIS_DRAW_NO_BRACKET = /^(Davis Cup|Billie Jean King Cup Group I)$/;
    if (_TENNIS_DRAW_NO_BRACKET.test(t.name || '')) continue;
`;

console.log('POSITIVE CONTROL — the real client shape, unmutated:');
const cur = extractClientSplit(CURRENT, 'current');
ok('five admitted names', cur.admits.length === 5, JSON.stringify(cur.admits));
ok('the BJK Cup is admitted', cur.admits.includes('Billie Jean King Cup'));
ok('two excluded names', cur.excludes.length === 2, JSON.stringify(cur.excludes));
ok('Davis Cup excluded', cur.excludes.includes('Davis Cup'));
ok('Group I excluded', cur.excludes.includes('Billie Jean King Cup Group I'));
ok('the senior Cup is NOT excluded', !cur.excludes.includes('Billie Jean King Cup'));
ok('nothing contradictory', cur.contradictory.length === 0, JSON.stringify(cur.contradictory));
ok('a comment between map entries does not end the parse', cur.admits.includes('United Cup'));

console.log('\nMUTATIONS — each must throw, and about the right thing:');
throws('M1 the regex constant renamed',
  CURRENT.replace('_TENNIS_DRAW_NO_BRACKET = /^(', '_TENNIS_DRAW_SKIP = /^('),
  '_TENNIS_DRAW_NO_BRACKET');
throws('M2 the regex shape changed to a non-anchored test',
  CURRENT.replace('/^(Davis Cup|Billie Jean King Cup Group I)$/', '/Davis Cup|Billie Jean King Cup Group I/'),
  '_TENNIS_DRAW_NO_BRACKET');
throws('M3 the alternation emptied',
  CURRENT.replace('Davis Cup|Billie Jean King Cup Group I', ''),
  'zero names');
throws('M4 the rank map renamed',
  CURRENT.replace('_TENNIS_DRAW_NAMED_RANK = {', '_TENNIS_NAMED_TIER = {'),
  '_TENNIS_DRAW_NAMED_RANK');
throws('M5 the rank map emptied',
  CURRENT.replace(/const _TENNIS_DRAW_NAMED_RANK = \{[\s\S]*?\};/, 'const _TENNIS_DRAW_NAMED_RANK = {\n};'),
  'zero names');
throws('M6 nothing to read at all', '', 'nothing to read');
throws('M7 the text is not a string', null, 'nothing to read');

console.log('\nTHE HISTORICAL SHAPE — the client regex before 2026-10-07:');
// `Billie Jean King Cup( Group I)?` is one arm standing for two names. The
// `[^)]*` capture stops at the group's close paren, so a tolerant parser would
// have read the arm as `Billie Jean King Cup( Group I` and silently lost a
// name. It must refuse instead, and say where the fix is.
throws('M8 an arm with an optional group refuses rather than mis-parses',
  CURRENT.replace('/^(Davis Cup|Billie Jean King Cup Group I)$/',
                  '/^(Davis Cup|Billie Jean King Cup( Group I)?)$/'),
  'not a literal name');

console.log('\nA CONTRADICTION IS REPORTED, NOT THROWN:');
const contra = extractClientSplit(
  CURRENT.replace('/^(Davis Cup|Billie Jean King Cup Group I)$/',
                  '/^(Davis Cup|Billie Jean King Cup Group I|United Cup)$/'), 'contra');
ok('United Cup in both lists is reported', contra.contradictory.includes('United Cup'),
   JSON.stringify(contra.contradictory));
ok('and the lists still parse', contra.excludes.length === 3 && contra.admits.length === 5);

// ── readClient's refusal paths, driven with a fake fetch ──────────────────────
// These are the paths that decide whether a run can be green while knowing
// nothing, so each one is exercised rather than reasoned about. The fake fetch
// also asserts WHICH urls were asked for, because a read of the wrong text is
// the defect this whole change exists to remove.
const fake = (handler) => {
  const asked = [];
  const f = async (url) => { asked.push(url); return handler(url); };
  f.asked = asked;
  return f;
};
const body = (text) => ({ ok: true, text: async () => text });
const httpErr = (status) => ({ ok: false, status, text: async () => '' });

console.log('\nreadClient — which texts it reads:');
{
  const f = fake(() => body(CURRENT));
  const r = await readClient(f);
  ok('reads exactly two urls', f.asked.length === 2, JSON.stringify(f.asked));
  ok('one is the deployed page', f.asked.includes(CLIENT_DEPLOYED_URL));
  ok('one is field.js on main, not index.html',
     f.asked.includes(CLIENT_SOURCE_URL) && !f.asked.some((u) => u.includes('index.html')));
  ok('both parse, no refusals', !!r.deployed && !!r.source && r.refusals.length === 0,
     JSON.stringify(r.refusals));
  ok('agreement is true when both read the same text', r.sourceAgreesWithDeployed === true);
}

console.log('\nreadClient — every refusal path:');
{
  const r = await readClient(fake((u) => (u === CLIENT_DEPLOYED_URL ? httpErr(503) : body(CURRENT))));
  ok('R1 deployed HTTP error refuses and leaves deployed null',
     r.deployed === null && r.refusals.some((x) => x.includes('HTTP 503')), JSON.stringify(r.refusals));
  ok('R1 does not fall back to source for the verdict', r.source !== null && r.deployed === null);
  ok('R1 agreement is UNKNOWN, not true', r.sourceAgreesWithDeployed === null);
}
{
  const r = await readClient(fake(() => { throw new Error('getaddrinfo ENOTFOUND'); }));
  ok('R2 a network throw refuses both', r.deployed === null && r.source === null
     && r.refusals.length === 2, JSON.stringify(r.refusals));
}
{
  const r = await readClient(fake(() => body('<html>404 Not Found</html>')));
  ok('R3 an error PAGE with HTTP 200 still refuses — neither anchor is in it',
     r.deployed === null && r.source === null && r.refusals.length === 2,
     JSON.stringify(r.refusals));
}
{
  const other = CURRENT.replace('/^(Davis Cup|Billie Jean King Cup Group I)$/',
                                '/^(Davis Cup|Billie Jean King Cup Group I|United Cup)$/');
  const r = await readClient(fake((u) => (u === CLIENT_DEPLOYED_URL ? body(CURRENT) : body(other))));
  ok('R4 source disagreeing with deployed is reported as false, not refused',
     r.sourceAgreesWithDeployed === false && r.refusals.length === 0);
}

console.log(`\nCOVERAGE: the parser over fixtures, and readClient over a fake fetch —`);
console.log(`  8 positive-control assertions, 8 parser mutations, 2 contradiction`);
console.log(`  assertions, 5 url assertions and 6 refusal-path assertions. It does`);
console.log(`  NOT reach jubilant-bassoon over the network; the real reads run`);
console.log(`  inside tennis-tier-ladders.mjs, where a refusal exits 1.`);
console.log(fail ? `\n${fail} FAILED of ${pass + fail}` : `\nself-test: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
