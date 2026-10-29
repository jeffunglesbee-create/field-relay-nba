#!/usr/bin/env node
/**
 * The Saturday identity-join probe, executed (docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md, B2).
 *
 * Two layers. (1) The classifier in scripts/lib/odds-join-probe.mjs on a table of report entries: the verdict CODE and
 * the NUMBERS in its text, because a verdict that names the wrong count is wrong. (2) The probe SCRIPT itself, run as a
 * child process against a local HTTP server that plays the relay: what it sends, what it refuses to run without, what
 * it writes, what its exit code says, and that the secret never reaches an artifact that is committed to main. The old
 * probe could not fail on the property it existed for: CFB read NO_ROWS in every scheduled artifact and every run
 * exited 0.
 *
 * SCRIPT_UNDER_TEST and LIB_UNDER_TEST let scripts/mutate-odds-join-probe.mjs aim this file at mutated copies.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT = resolve(process.env.SCRIPT_UNDER_TEST || 'scripts/probe-odds-join.mjs');
const LIB = await import(pathToFileURL(resolve(process.env.LIB_UNDER_TEST || 'scripts/lib/odds-join-probe.mjs')).href);

const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok, detail]); };
const SAT = '2026-10-31', SUN = '2026-11-01';

// ── (1) the classifier ──
const NOW = Date.parse('2026-10-31T20:00:00Z');
// A fully priced slate: 44 rows, 40 events. Every field the route sends is present and the arithmetic holds.
const entry = (o) => ({ sport_key: 'americanfootball_ncaaf', odds_events: 40, odds_events_in_window: 38, d1_rows: 44, d1_priced: 44,
  d1_priced_late: 0, d1_missing: 0, matched: 0, priceable: 0, slate_matched: 0, unmatched: [], ...o });
const FUT = { finalized: false, start_time: '2026-10-31T23:00Z' };        // not started, should be in the feed
const PAST = { finalized: false, start_time: '2026-10-31T16:00Z' };       // under way or finished, unfinalized
const DONE = { finalized: true, start_time: '2026-10-31T23:30Z' };        // finalized (and a start in the future, to make the flag decide)
const unpriced = (n, o = {}) => ({ d1_priced: 44 - n, d1_missing: n, ...o });

// [code, entry, [regexes the text must match], why]
const TABLE = [
  ['ALL_PRICED', entry({}), [/44 of 44 rows/, /vendor had 40 events/], 'a join that works leaves nothing unpriced'],
  ['ALL_PRICED', entry({ odds_events: 0, odds_events_in_window: 0 }), [/44 of 44/], 'an empty feed after every row is priced is still all priced'],
  ['PRICED_LATE', entry({ d1_priced_late: 9 }), [/44 of 44 rows/, /9 of them captured after kickoff/], 'priced, but not before the game'],
  ['NO_ROWS_AT_ALL', entry({ d1_rows: 0, d1_priced: 0, odds_events_in_window: 7 }), [/no americanfootball_ncaaf rows on 2026-10-31/, /lists 7 events/], 'the feed lists a slate the archive does not have'],
  ['NO_SLATE', entry({ d1_rows: 0, d1_priced: 0, odds_events_in_window: 0, odds_events: 31 }), [/no americanfootball_ncaaf rows on 2026-10-31/, /vendor had 31 events in all/], 'nothing on the date at all: off-season, not a failure'],
  ['NO_JOIN_EVIDENCE', entry({ ...unpriced(7), matched: 0, slate_matched: 7, unmatched: [DONE, DONE, DONE, PAST, PAST, DONE, DONE] }), [/7 unpriced rows, all finished or under way/, /37 of 44 rows already priced/, /slate matcher 7/], 'a finished game missing from the live feed says nothing about the join'],
  ['C2_JOIN', entry({ ...unpriced(7), matched: 0, slate_matched: 7, unmatched: [FUT, FUT, FUT, DONE, DONE, PAST, PAST] }), [/3 unpriced rows have not started and none of the 7 unpriced rows joined/, /37 of 44 rows already priced/, /slate matcher 7/], 'rows that should be in the feed, and nothing joined, even though the slate matcher solves them'],
  ['COVERED', entry({ ...unpriced(14), matched: 10, priceable: 8, slate_matched: 12, d1_priced_late: 4, unmatched: [FUT, FUT, PAST, DONE] }), [/10 of 14 unpriced rows join now \(8 the cron would write\)/, /4 do not, 2 of them not yet started/, /30 of 44 rows already priced \(4 after kickoff\)/, /slate matcher 12/], 'some joined, some not; two future, one past, one finalized'],
  ['C1_VENDOR', entry({ ...unpriced(3), matched: 0, odds_events: 0, odds_events_in_window: 0, unmatched: [FUT, FUT, FUT] }), [/0 events served for americanfootball_ncaaf/], 'unpriced rows and an empty feed'],
  ['C1_VENDOR', { error: 'Odds-API fetch failed', sport_key: 'x' }, [/Odds-API fetch failed/], 'the vendor failed'],
  ['C0_GUARDED', { error: 'odds credit guard declined this call', guarded: true, sport_key: 'x' }, [/guard declined/], 'our own guard is not the vendor'],
  ['ABSENT_FROM_REPORT', undefined, [], 'the sport is missing from the report'],
];
for (const f of ['matched', 'unmatched', 'odds_events', 'd1_missing']) {
  const e = entry({}); delete e[f];
  TABLE.push(['SHAPE_UNEXPECTED', e, [new RegExp(`^SHAPE_UNEXPECTED: \\[`)], `${f} missing: each of the four shape guards is its own row`]);
}
TABLE.push(['SHAPE_UNEXPECTED', entry({ matched: [4] }), [], 'matched is a count, not an array']);
for (const f of ['d1_rows', 'd1_priced', 'd1_priced_late', 'odds_events_in_window', 'priceable', 'slate_matched']) {
  const e = entry({}); delete e[f];
  TABLE.push(['DENOMINATOR_UNREADABLE', e, [new RegExp(`not a number: ${f}$`)], `a relay that does not send ${f}: named in the text`]);
  TABLE.push(['DENOMINATOR_UNREADABLE', entry({ [f]: null }), [new RegExp(`not a number: ${f}$`)], `${f} null is not 0`]);
}
TABLE.push(['DENOMINATOR_INCONSISTENT', entry({ d1_priced: 50 }), [/d1_rows 44, d1_priced 50/], 'more priced than rows']);
TABLE.push(['DENOMINATOR_INCONSISTENT', entry({ d1_priced_late: -1 }), [], 'a negative count']);
TABLE.push(['DENOMINATOR_INCONSISTENT', entry({ d1_rows: 44.5, d1_priced: 44.5 }), [], 'a fractional count']);
TABLE.push(['DENOMINATOR_INCONSISTENT', entry({ ...unpriced(7), d1_missing: 6, matched: 0, unmatched: [FUT, FUT, FUT, FUT, FUT, FUT] }), [], 'rows - priced is not d1_missing']);
TABLE.push(['DENOMINATOR_INCONSISTENT', entry({ ...unpriced(7), matched: 2, unmatched: [FUT, FUT] }), [], 'matched + unmatched is not d1_missing']);
TABLE.push(['DENOMINATOR_INCONSISTENT', entry({ d1_priced_late: 45 }), [], 'more late than priced']);
TABLE.push(['DENOMINATOR_INCONSISTENT', entry({ ...unpriced(7), matched: 3, priceable: 4, unmatched: [FUT, FUT, FUT, FUT] }), [], 'more priceable than matched']);
for (const [want, e, texts, why] of TABLE) {
  // A classifier that throws on a malformed entry is a failed assertion here, not a crashed check.
  let got; try { got = LIB.classify(e, SAT, NOW); } catch (err) { got = `THREW: ${err.message}`; }
  check(`classify: ${want}: ${why}`, LIB.codeOf(got) === want && texts.every(t => t.test(got)), got);
}
for (const [v, refusal, fails] of [['NO_ROWS_AT_ALL: x', true, true], ['DENOMINATOR_UNREADABLE: x', true, true], ['DENOMINATOR_INCONSISTENT: x', true, true],
  ['C0_GUARDED: x', true, true], ['C1_VENDOR: x', true, true], ['SHAPE_UNEXPECTED: x', true, true], ['ABSENT_FROM_REPORT', true, true],
  ['C2_JOIN: x', false, true], ['ALL_PRICED: x', false, false], ['PRICED_LATE: x', false, false], ['COVERED: x', false, false],
  ['NO_SLATE: x', false, false], ['NO_JOIN_EVIDENCE: x', false, false]]) {
  check(`${v.split(':')[0]}: isRefusal ${refusal}, failsRun ${fails}`, LIB.isRefusal(v) === refusal && LIB.failsRun(v) === fails);
}
check('weekdayOf: 2026-10-31 is Saturday (6), 2026-11-01 is Sunday (0)', LIB.weekdayOf(SAT) === 6 && LIB.weekdayOf(SUN) === 0);
check('weekdayOf: an unreadable date is null', LIB.weekdayOf('not-a-date') === null);
check('the probe asks for CFB, NFL, Bundesliga and MLS, and only CFB is required', JSON.stringify(LIB.SPORTS) === '["CFB","NFL","Bundesliga","MLS"]' && JSON.stringify(LIB.REQUIRED) === '["CFB"]');

// ── (2) the script, against a local relay ──
function relay(handler) {
  return new Promise((ok) => {
    const seen = [];
    const server = http.createServer((req, res) => { seen.push({ url: req.url, auth: req.headers.authorization ?? null }); handler(req, res); });
    server.listen(0, '127.0.0.1', () => ok({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
const report = (date, sports) => JSON.stringify({ ok: true, date, probed: Object.keys(sports).length, sports });
const reply = (status, text, type = 'application/json') => (req, res) => { res.writeHead(status, { 'content-type': type }); res.end(typeof text === 'function' ? text(req) : text); };
const MLS = (o) => entry({ sport_key: 'soccer_usa_mls', odds_events: 20, odds_events_in_window: 18, d1_rows: 10, d1_priced: 3, d1_missing: 7, matched: 7, priceable: 5, slate_matched: 7, unmatched: [], ...o });
const others = { NFL: entry({ sport_key: 'americanfootball_nfl', d1_rows: 0, d1_priced: 0, odds_events_in_window: 0 }), Bundesliga: entry({ sport_key: 'soccer_germany_bundesliga', d1_rows: 9, d1_priced: 9 }), MLS: MLS({}) };

async function runProbe({ date = SAT, handler, env = {}, relayUrl = null }) {
  const r = await relay(handler || reply(200, '{}'));
  const out = mkdtempSync(join(tmpdir(), 'join-probe-'));
  const child = spawn(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, RELAY_URL: relayUrl ?? r.base, OUT_DIR: out, ...(date === null ? {} : { PROBE_DATE: date }), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((ok) => child.on('close', ok));
  await new Promise((ok) => r.server.close(ok));
  const files = readdirSync(out);
  const raw = files.length ? readFileSync(join(out, files[0]), 'utf8') : null;
  rmSync(out, { recursive: true, force: true });
  return { code, stdout, stderr, seen: r.seen, raw, artifact: raw ? JSON.parse(raw) : null };
}
const SECRET = { FIELD_MCP_SECRET: 'probe-secret', EXPECT_WEEKDAY: '6' };
const serve = (sports) => reply(200, (req) => report(new URL(req.url, 'http://x').searchParams.get('date'), sports));
// A script that refuses to run writes no artifact; an assertion about its verdict must fail, not throw.
const verdictOf = (r, sport) => (r.artifact && r.artifact.verdict ? r.artifact.verdict[sport] : undefined);
const failedOf = (r) => (r.artifact ? JSON.stringify(r.artifact.failed) : undefined);
const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();

{
  const a = await runProbe({ env: SECRET, handler: serve({ CFB: entry({}), ...others }) });
  check('script: all CFB rows priced exits 0 and says ALL_PRICED', a.code === 0 && LIB.codeOf(verdictOf(a, 'CFB')) === 'ALL_PRICED', `exit ${a.code}, ${verdictOf(a, 'CFB')}`);
  check('script: it sends Authorization: Bearer <FIELD_MCP_SECRET>', a.seen.length === 1 && a.seen[0].auth === 'Bearer probe-secret', JSON.stringify(a.seen));
  check('script: it asks for the date it was given, and the four sports', a.seen.length === 1 && /date=2026-10-31/.test(a.seen[0].url) && /sports=CFB%2CNFL%2CBundesliga%2CMLS/.test(a.seen[0].url), JSON.stringify(a.seen));
  check('script: the artifact names the probe date and the four verdicts', !!a.artifact && a.artifact.probe_date === SAT && Object.keys(a.artifact.verdict || {}).length === 4, JSON.stringify(a.artifact && a.artifact.verdict));
  check('script: ...keeps the relay\'s raw report (the denominators done condition 4 reads)', !!a.artifact && !!a.artifact.report && a.artifact.report.sports.CFB.d1_rows === 44 && a.artifact.report.sports.CFB.d1_priced === 44, JSON.stringify(a.artifact && a.artifact.report && a.artifact.report.sports.CFB));
  check('script: ...and says no required sport failed', failedOf(a) === '[]');
  check('script: ...and prints what was answered and measured, as counts (Rule 91)', /relay answered for 4 of 4 requested sports on 2026-10-31; 4 of them measured/.test(a.stdout), a.stdout.slice(-200));
}
{
  const a = await runProbe({ env: SECRET, handler: serve({ CFB: entry({ d1_rows: 0, d1_priced: 0, odds_events_in_window: 7 }), ...others }) });
  check('script: CFB with no rows though the feed lists the slate EXITS 1', a.code === 1 && LIB.codeOf(verdictOf(a, 'CFB')) === 'NO_ROWS_AT_ALL' && failedOf(a) === '["CFB"]', `exit ${a.code}, ${failedOf(a)}`);
  check('script: ...and prints the failure', /PROBE FAILED for CFB: NO_ROWS_AT_ALL/.test(a.stderr), a.stderr.slice(0, 160));
  check('script: ...and the coverage line counts it as not measured (3 of 4)', /relay answered for 4 of 4 requested sports on 2026-10-31; 3 of them measured/.test(a.stdout), a.stdout.slice(-200));
  const off = await runProbe({ env: SECRET, handler: serve({ CFB: entry({ d1_rows: 0, d1_priced: 0, odds_events_in_window: 0 }), ...others }) });
  check('script: CFB with no rows AND no slate in the feed (off-season) exits 0 as NO_SLATE', off.code === 0 && LIB.codeOf(verdictOf(off, 'CFB')) === 'NO_SLATE', `exit ${off.code}`);
}
{
  const c2 = entry({ ...unpriced(2), matched: 0, slate_matched: 2, unmatched: [{ finalized: false, start_time: hoursFromNow(3) }, { finalized: false, start_time: hoursFromNow(4) }] });
  const a = await runProbe({ env: SECRET, handler: serve({ CFB: c2, ...others }) });
  check('script: upcoming unpriced rows and nothing joined (C2_JOIN) EXITS 1: the join property can fail the run', a.code === 1 && LIB.codeOf(verdictOf(a, 'CFB')) === 'C2_JOIN' && failedOf(a) === '["CFB"]', `exit ${a.code}, ${verdictOf(a, 'CFB')}`);
  const none = entry({ ...unpriced(2), matched: 0, slate_matched: 2, unmatched: [{ finalized: true, start_time: hoursFromNow(-5) }, { finalized: false, start_time: hoursFromNow(-2) }] });
  const b = await runProbe({ env: SECRET, handler: serve({ CFB: none, ...others }) });
  check('script: the same with every unpriced game finished or under way is NO_JOIN_EVIDENCE and exits 0', b.code === 0 && LIB.codeOf(verdictOf(b, 'CFB')) === 'NO_JOIN_EVIDENCE', `exit ${b.code}, ${verdictOf(b, 'CFB')}`);
  const cov = entry({ ...unpriced(3), matched: 1, priceable: 1, slate_matched: 3, unmatched: [{ finalized: false, start_time: hoursFromNow(2) }, { finalized: false, start_time: hoursFromNow(-2) }] });
  const c = await runProbe({ env: SECRET, handler: serve({ CFB: cov, ...others }) });
  check('script: the probe uses the REAL clock: one unmatched row ahead of now and one behind it is "1 not yet started"', c.code === 0 && /2 do not, 1 of them not yet started/.test(verdictOf(c, 'CFB') || ''), `exit ${c.code}, ${verdictOf(c, 'CFB')}`);
  const nfl = await runProbe({ env: SECRET, handler: serve({ CFB: entry({}), ...others, NFL: entry({ d1_rows: 0, d1_priced: 0, odds_events_in_window: 5 }) }) });
  check('script: a refusal-class verdict for a sport that is NOT required (NFL) does not fail the run', nfl.code === 0 && LIB.codeOf(verdictOf(nfl, 'NFL')) === 'NO_ROWS_AT_ALL' && failedOf(nfl) === '[]', `exit ${nfl.code}`);
}
for (const [what, e, code] of [
  ['our own credit guard declining CFB', { error: 'odds credit guard declined this call', guarded: true, sport_key: 'x' }, 'C0_GUARDED'],
  ['an unreadable CFB denominator', entry({ d1_rows: null }), 'DENOMINATOR_UNREADABLE'],
  ['a CFB report whose arithmetic does not add up', entry({ d1_priced: 50 }), 'DENOMINATOR_INCONSISTENT'],
]) {
  const a = await runProbe({ env: SECRET, handler: serve({ CFB: e, ...others }) });
  check(`script: ${what} exits 1 as ${code}`, a.code === 1 && LIB.codeOf(verdictOf(a, 'CFB')) === code, `exit ${a.code}, ${verdictOf(a, 'CFB')}`);
}
{
  const a = await runProbe({ env: SECRET, handler: reply(401, 'Unauthorized', 'text/plain') });
  check('script: a 401 exits 1 and says the secret did not match', a.code === 1 && !!a.artifact && /FIELD_MCP_SECRET did not match/.test(a.artifact.error || '') && a.artifact.http === 401, `exit ${a.code}, ${a.artifact && a.artifact.error}`);
  check('script: ...and the coverage line says the relay answered for 0 of 4', /relay answered for 0 of 4 requested sports on 2026-10-31; 0 of them measured/.test(a.stdout), a.stdout.slice(-200));
  const b = await runProbe({ env: SECRET, handler: reply(200, (req) => report('2026-10-24', { CFB: entry({}) })) });
  check('script: a body that does not echo the requested date is not a relay answer (exit 1)', b.code === 1 && /did not echo/.test((b.artifact && b.artifact.error) || ''), `exit ${b.code}`);
  for (const body of ['null', 'false', '0', '"text"']) {
    const c = await runProbe({ env: SECRET, handler: reply(200, body) });
    check(`script: a 200 whose JSON body is ${body} measured nothing and exits 1`, c.code === 1 && !!c.artifact && !!c.artifact.error && c.artifact.report === null, `exit ${c.code}, ${c.artifact && c.artifact.error}`);
  }
  const html = await runProbe({ env: SECRET, handler: reply(200, '<html>proxy page</html>', 'text/html') });
  check('script: a non-JSON 200 exits 1 and records why', html.code === 1 && /non-JSON/.test((html.artifact && html.artifact.error) || ''), `exit ${html.code}, ${html.artifact && html.artifact.error}`);
  const five = await runProbe({ env: SECRET, handler: reply(500, 'boom', 'text/plain') });
  check('script: a 500 exits 1, with the status recorded', five.code === 1 && !!five.artifact && five.artifact.http === 500 && /500/.test(five.artifact.error || ''), `exit ${five.code}, ${five.artifact && five.artifact.error}`);
  const fiveJson = await runProbe({ env: SECRET, handler: reply(500, (req) => report(new URL(req.url, 'http://x').searchParams.get('date'), { CFB: entry({}), ...others })) });
  check('script: a 500 that carries a valid report is still not an answer (exit 1, nothing classified)', fiveJson.code === 1 && !!fiveJson.artifact && fiveJson.artifact.report === null && /500/.test(fiveJson.artifact.error || ''), `exit ${fiveJson.code}, ${fiveJson.artifact && fiveJson.artifact.error}`);
  const down = await runProbe({ env: SECRET, relayUrl: 'http://127.0.0.1:1' });
  check('script: an unreachable relay exits 1 and the artifact says so', down.code === 1 && !!down.artifact && !!down.artifact.error && down.artifact.report === null, `exit ${down.code}, ${down.artifact && down.artifact.error}`);
}
{
  // A secret the HTTP layer rejects: Node's error message QUOTES the header value, and the artifact is committed to main.
  const leaky = await runProbe({ env: { FIELD_MCP_SECRET: 'SENTINEL-abc\ndef', EXPECT_WEEKDAY: '6' }, handler: serve({ CFB: entry({}), ...others }) });
  const everything = `${leaky.raw}\n${leaky.stdout}\n${leaky.stderr}`;
  check('script: a secret that breaks the request exits 1', leaky.code === 1 && !!leaky.artifact && !!leaky.artifact.error, `exit ${leaky.code}`);
  check('script: ...and appears in NEITHER the artifact, nor stdout, nor stderr', !/SENTINEL-abc/.test(everything), everything.slice(0, 200));
}
{
  const hit = { n: 0 };
  const h = (req, res) => { hit.n++; serve({ CFB: entry({}), ...others })(req, res); };
  const noDate = await runProbe({ date: null, env: { FIELD_MCP_SECRET: 'probe-secret' }, handler: h });
  check('script: with no PROBE_DATE it refuses to run, calls nothing and writes nothing', noDate.code === 1 && hit.n === 0 && noDate.artifact === null && /PROBE_DATE/.test(noDate.stderr), `exit ${noDate.code}, ${hit.n} calls`);
  const junk = await runProbe({ date: '2026-10-31junk', env: { FIELD_MCP_SECRET: 'probe-secret' }, handler: h });
  check('script: a date with anything after it is refused before any call', junk.code === 1 && hit.n === 0 && /PROBE_DATE/.test(junk.stderr), `exit ${junk.code}, ${hit.n} calls`);
  const sunday = await runProbe({ date: SUN, env: SECRET, handler: h });
  check('script: EXPECT_WEEKDAY=6 refuses a Sunday date before any call', sunday.code === 1 && hit.n === 0 && /weekday/.test(sunday.stderr), `exit ${sunday.code}, ${hit.n} calls`);
  const noSecret = await runProbe({ env: { EXPECT_WEEKDAY: '6' }, handler: h });
  check('script: with no FIELD_MCP_SECRET it refuses to run before any call', noSecret.code === 1 && hit.n === 0 && /FIELD_MCP_SECRET/.test(noSecret.stderr), `exit ${noSecret.code}, ${hit.n} calls`);
  const anyDay = await runProbe({ date: SUN, env: { FIELD_MCP_SECRET: 'probe-secret' }, handler: h });
  check('script: without EXPECT_WEEKDAY any date is allowed (probe-odds-api.yml takes a free date)', anyDay.code === 0 && hit.n === 1, `exit ${anyDay.code}, ${hit.n} calls`);
}

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
console.log(`classifier table ${TABLE.length} rows; script run against a local relay in ${results.filter(r => r[0].startsWith('script:')).length} cases.`);
console.log(`${results.length - failed} of ${results.length} passed.`);
process.exit(failed ? 1 : 0);
