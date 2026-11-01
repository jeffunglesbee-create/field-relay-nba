#!/usr/bin/env node
// Rule 90 for scripts/relay-read.mjs: each mutation breaks one clause of the policy, and the self-test must go red. This guards a tool that a dispatch input can aim at a live
// system that spends money and writes, so the clauses are the ones that keep it from doing so. Each asserts its anchor is unique and applied before reporting a result.
// Each asserts its anchor is unique and applied before reporting a result. Mutates in place and restores; needs the file's changes staged or committed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FILE = 'scripts/relay-read.mjs';
if (spawnSync('git', ['diff', '--quiet', '--', FILE]).status !== 0) { console.log(`FAIL — ${FILE} has unstaged changes; restoring would lose them.`); process.exit(1); }
if (spawnSync('node', [FILE, '--self-test'], { stdio: 'ignore' }).status !== 0) { console.log(`FAIL — ${FILE} --self-test is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${FILE} --self-test passes on clean source\n`);

const M = [
  ['C1 /v2/games is added to ALLOWED', "export const ALLOWED = ['/health',", "export const ALLOWED = ['/v2/games', '/health',", 'soccer: Odds API lambdas and D1/R2/DO writes; NHL/NBA: a queue message and an LLM call per final'],
  ['C2 /cfl/odds-probs is added to ALLOWED', "export const ALLOWED = ['/health',", "export const ALLOWED = ['/cfl/odds-probs', '/health',", 'a cache miss charges 6 Odds API credits'],
  ['C3 /analytics/run is added to ALLOWED', "export const ALLOWED = ['/health',", "export const ALLOWED = ['/analytics/run', '/health',", 'an unauthenticated GET that runs the analytics engine: D1 DDL and writes, LLM calls'],
  ['C4 a path matches by prefix', "if (ALLOWED.includes(raw)) return { ok: true };", "if (ALLOWED.some((p) => raw.startsWith(p))) return { ok: true };", '/health/%2e%2e/cfl/odds-probs, /budget/oddsx, /archive/query/x'],
  ['C5 a trailing slash is trimmed before matching', "if (ALLOWED.includes(raw)) return { ok: true };", "if (ALLOWED.includes(raw.replace(/\\/+$/, ''))) return { ok: true };", 'the relay routes the literal path; /health/ lands on a catch-all'],
  ['C6 matching ignores case', "if (ALLOWED.includes(raw)) return { ok: true };", "if (ALLOWED.includes(raw.toLowerCase())) return { ok: true };", 'a path the relay would route differently from the one that was approved'],
  ['C7 the query is part of the path that is compared', "const raw = route.split('?')[0];", "const raw = route;", 'no route with a query could be read'],
  ['C8 the length cap is gone', "if (route.length > 300) return", "if (false) return", 'a 10 KB query string'],
  ['C9 the allow check always passes', "if (ALLOWED.includes(raw)) return { ok: true };", "if (true) return { ok: true };", 'the whole policy'],
  ['C10 redirects are followed', "redirect: 'manual'", "redirect: 'follow'", 'a redirect from the relay takes the request to another host'],
  ['C11 the shared secret is sent', "'User-Agent': 'field-relay-read/1' },", "'User-Agent': 'field-relay-read/1', 'X-FIELD-Relay': process.env.RELAY_SHARED_SECRET },", 'the secret opens /web-fetch, /admin and _forcePrimaryFail'],
  ['C12 a big body is not truncated', "const truncated = bytes > MAX_BODY;", "const truncated = false;", 'a 100 MB body is committed to the repo'],
  ['C13 the route count is not capped', "const routes = all.slice(0, MAX_ROUTES);", "const routes = all;", 'one dispatch fires hundreds of requests'],
  ['C18 a comma splits a route', "(typeof text === 'string' ? text : '').split(/\\s+/)", "(typeof text === 'string' ? text : '').split(/[\\s,]+/)", 'a legal comma inside a query value reads a different URL and records it as OK'],
  ['C19 routes over the cap are dropped silently', "for (const r of all.slice(MAX_ROUTES)) { refused++;", "for (const r of []) { refused++;", 'a look that did not look everywhere reads as complete'],
  ['C14 a refused dispatch exits 0', "process.exit(refused || failed ? 1 : 0);", "process.exit(failed ? 1 : 0);", 'a look that refused everything reads as green'],
  ['C15 a failed read exits 0', "process.exit(refused || failed ? 1 : 0);", "process.exit(refused ? 1 : 0);", 'an unreachable relay reads as green'],
  ['C16 a refused route is still fetched', "  if (!p.ok) { refused++;", "  if (!p.ok) { refused++; await readRoute(r, fetch);", 'the refusal is cosmetic'],
  ['C17 the artifact reports refused routes as read', "read_ok: all.length - refused - failed,", "read_ok: all.length - failed,", 'the summary says it read what it refused'],
  ['C20 the secret is sent under another header name', "'User-Agent': 'field-relay-read/1' },", "'User-Agent': 'field-relay-read/1', Authorization: process.env.RELAY_SHARED_SECRET },", 'a header-NAME check passes; the secret still travels'],
  ['C21 the per-route timeout is removed', "signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),", "", 'one hung route holds the job until its 10-minute limit and loses every artifact'],
  ['C22 the body cap counts characters', "const bytes = buf.length;", "const bytes = text.length;", 'three-byte characters pass the cap at three times its size'],
  ['C23 a 3xx counts as ok', "ok: status >= 200 && status < 300,", "ok: status >= 200 && status < 400,", 'a redirect that was not followed reads as a successful read'],
  ['C24 the Location header is not kept', ", 'last-modified', 'location'];", ", 'last-modified'];", 'a 302 reads as \"HTTP 302, 0 bytes\" with no target'],
  ['C25 a JSON body is kept as JSON whatever its size', "if (JSON.stringify(parsed).length <= MAX_BODY) {", "if (true) {", 'a body that serialises larger than it arrived blows the cap'],
  ['C26 duplicates are not counted', "duplicates_dropped: submitted - all.length,", "duplicates_dropped: 0,", 'a look at 4 routes reads as a look at 2 with nothing dropped'],
  ['C27 an empty body is not flagged', "empty: bytes === 0,", "empty: false,", 'a 200 with nothing in it reads as a reading'],
  ['C28 entries are pretty-printed in the artifact', "entries.map((e) => `  ${JSON.stringify(e)}`)", "entries.map((e) => `  ${JSON.stringify(e, null, 1)}`)", 'a deeply nested body is indented into megabytes'],
  ['C29 a trailing slash on RELAY_BASE is kept', ".replace(/\\/+$/, '');", ";", 'every path would gain a leading double slash'],
];
let caught = 0;
for (const [name, anchor, replace, why] of M) {
  const src = fs.readFileSync(FILE, 'utf8');
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  if (anchor === replace) { console.log(`FAIL       ${name}\n            replacement equals the anchor — NOTHING MUTATED.`); continue; }
  fs.writeFileSync(FILE, src.replace(anchor, () => replace));
  const run = spawnSync('node', [FILE, '--self-test'], { encoding: 'utf8', timeout: 60000 });
  const fails = String(run.stdout ?? '').split('\n').filter((l) => l.includes('FAIL'));
  const red = run.status !== 0 && fails.length > 0;   // a crash, a syntax error or a timeout is BROKE, not CAUGHT: an assertion must have fired
  fs.writeFileSync(FILE, src);
  console.log(`${red ? 'CAUGHT    ' : run.status !== 0 ? 'BROKE     ' : 'NOT CAUGHT'} ${name}\n            (${why})${red ? `\n            <- ${fails[0].trim().slice(0, 120)}` : ''}`);
  if (red) caught++;
}
console.log(`\n${caught} of ${M.length} mutations caught.`);
process.exit(caught === M.length ? 0 : 1);
