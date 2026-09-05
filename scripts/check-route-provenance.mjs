#!/usr/bin/env node
// scripts/check-route-provenance.mjs — the manifest matches the code, and the
// stamp cannot break a response. Blocking in deploy.yml.
//
// Two failure modes this exists for. A generated manifest that stops being
// regenerated is worse than no manifest: it keeps answering, confidently, about
// a version of the code that no longer exists. And a response wrapper that
// touches every single response in the worker is the highest-blast-radius edit
// in this repo -- a mistake in it does not break one route, it breaks all 185.

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { stampProvenance } from '../src/provenance-stamp.js';
import { ROUTE_PROVENANCE, provenanceFor } from '../src/route-provenance.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n         → ${detail}`}`);
  if (!ok) failed++;
};

// ── 1. The committed manifest is what the generator produces from HEAD ───────
const committed = readFileSync('src/route-provenance.js', 'utf8');
execSync('node scripts/build-route-provenance.mjs', { stdio: 'pipe' });
const regenerated = readFileSync('src/route-provenance.js', 'utf8');
const strip = t => t.replace(/^export const ROUTE_PROVENANCE_GENERATED_AT = .*$/m, '');
const current = strip(committed) === strip(regenerated);
// ALWAYS restore, not just on mismatch. The generator stamps a fresh
// GENERATED_AT every run, so even a passing check left the working tree dirty
// -- which turns "git status is clean" into a signal nobody can trust, and
// invites the next person to commit a timestamp-only diff.
writeFileSync('src/route-provenance.js', committed);
check('the manifest matches the code it describes', current,
  'src/route-provenance.js is stale. Run: node scripts/build-route-provenance.mjs && git add src/route-provenance.js');

// ── 2. Every data surface the census finds has an entry ──────────────────────
let census = null;
try { census = JSON.parse(readFileSync('outbox/provenance-census-latest.json', 'utf8')); } catch (_) {}
if (census) {
  const missing = census.routes.filter(r => r.state !== 'protocol' && !ROUTE_PROVENANCE[r.path]);
  check('every data surface is in the manifest', missing.length === 0,
    `${missing.length} unmapped: ${missing.slice(0, 5).map(r => r.path).join(', ')}`);
} else {
  check('census present to cross-check against', false, 'outbox/provenance-census-latest.json missing — run the census first');
}

// ── 3. A declared source must actually appear in the code ────────────────────
// The manifest is only worth stamping if it is true. A host named here that the
// handler never contacts is a confident wrong answer, which is the exact failure
// the Germany v Ecuador row was.
const src = readFileSync('src/index.js', 'utf8') + readFileSync('src/ambient-do.js', 'utf8');
const bogus = [];
for (const [path, v] of Object.entries(ROUTE_PROVENANCE)) {
  if (!v.s || v.s.startsWith('undeclared')) continue;
  for (const part of v.s.split(' + ')) {
    const bare = part.replace(/^(kv|d1|r2|do):/, '');
    if (!src.includes(bare)) bogus.push(`${path} -> ${part}`);
  }
}
check('every declared source appears in the source', bogus.length === 0,
  `${bogus.length} named but absent: ${bogus.slice(0, 4).join('; ')}`);

// ── 4. The wrapper is wired, and wired the right way round ───────────────────
const idx = readFileSync('src/index.js', 'utf8');
// _env, not env: the fetch export now wraps the environment for KV write
// provenance before calling the router. This check failed on correct code when
// that shipped, which is the right failure -- the shape it guards did change,
// and it should notice. It is updated deliberately, not loosened: the router
// must still receive a wrapped env and the result must still be stamped.
check('fetch delegates to _fetch with the wrapped env and stamps the result',
  /async fetch\(request, env, ctx\) \{[\s\S]{0,900}?this\._fetch\(request, _env, ctx\)[\s\S]{0,400}?stampProvenance\(request, resp, _env\)/.test(idx),
  'the export no longer wraps the router — routing would be unstamped, or the raw env would reach it');
check('the router itself still exists', /async _fetch\(request, env, ctx\) \{/.test(idx));

// ── 5. What the stamp must never do. The real function, not a re-implementation.
const R = p => new Request(`https://relay.test${p}`);

const plain = await stampProvenance(R('/budget/odds'),
  new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
check('it stamps a normal response', plain.headers.get('X-FIELD-Route') === '/budget/odds');
check('the body is byte-identical', await plain.clone().text() === '{"ok":true}');
check('existing headers survive', plain.headers.get('Content-Type') === 'application/json');
check('the status survives', plain.status === 200);
check('the headers are exposed cross-origin',
  (plain.headers.get('Access-Control-Expose-Headers') || '').includes('X-FIELD-Source'),
  'a header a browser cannot read is the same as a header not sent');

// A live socket. Rebuilding this response drops it; /ws/game/* is a real route
// that forwards to GAME_DO and gets one back.
//
// The first version of this check asserted identity against a mock whose
// headers were mutable -- so with the guard DELETED the stamp still returned
// the same object, and the test passed. Mutation caught it. What has to hold is
// stronger than identity: a socket response comes back UNSTAMPED, untouched in
// every way, which fails the moment the guard goes.
const sock = { status: 101, webSocket: {}, headers: new Headers() };
const passed = await stampProvenance(R('/ws/game/nba/123'), sock);
check('a 101 with a socket is returned untouched',
  passed === sock && passed.headers.get('X-FIELD-Route') === null,
  'the WebSocket response was stamped or rebuilt — /ws/game/* would stop working');

// A stream must stay a stream. The first version of this counted pulls on the
// ReadableStream and asserted zero -- and failed, with the wrapper innocent: a
// stream-bodied Response self-pulls one chunk a microtask after construction,
// measured with stampProvenance never called. The test was reading the runtime,
// not the code. The property that actually matters is the one asserted now:
// when the headers are already mutable the wrapper returns the SAME object and
// never goes near the body, so a long-lived SSE response is untouched.
const stream = new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode('x')); c.close(); } });
const original = new Response(stream, { status: 200 });
const streamed = await stampProvenance(R('/ambient/foo'), original);
check('a mutable response is stamped in place, not rebuilt', streamed === original,
  'the wrapper rebuilt a response it did not need to — that touches the body of every SSE stream');
check('the stream survives and still carries its data', (await streamed.text()) === 'x');

// The proxy case: headers came back frozen from fetch(), so a rebuild is the
// only option. It must still stamp, and must not lose the body.
const frozen = new Response('proxied', { status: 200 });
Object.defineProperty(frozen, 'headers', { value: new Proxy(new Headers(), {
  get: (t, k) => k === 'set' ? () => { throw new TypeError('immutable'); } : Reflect.get(t, k).bind(t),
}) });
const rebuilt = await stampProvenance(R('/nhl/scores'), frozen);
check('a frozen response is rebuilt and still stamped',
  rebuilt !== frozen && rebuilt.headers.get('X-FIELD-Route') === '/nhl/scores',
  'proxy responses come back immutable — without the rebuild path they go unstamped');
check('the rebuilt body is intact', (await rebuilt.text()) === 'proxied');

// Diagnostics must never cost a response.
const broken = { status: 200, get headers() { throw new Error('boom'); } };
check('a throw inside the stamp returns the original', await stampProvenance(R('/x'), broken) === broken,
  'a bug in provenance would take the route down with it');

// An unmapped path must say so rather than guess.
const unmapped = await stampProvenance(R('/nothing/here/at/all'), new Response('{}', { status: 404 }));
check('an unmapped route is labelled unmapped, not blank',
  unmapped.headers.get('X-FIELD-Kind') === 'unmapped');

// A route that reads nothing says that, distinctly from not knowing.
const trig = Object.entries(ROUTE_PROVENANCE).find(([, v]) => !v.s);
if (trig) {
  const t = await stampProvenance(R(trig[0]), new Response('{"ok":true}'));
  check(`a route that reads nothing says so (${trig[0]})`,
    t.headers.get('X-FIELD-Source') === 'none (reads nothing)');
}

// Every value the stamp can emit must survive Headers.set(), which takes a
// ByteString. One em-dash in a default string silently unstamped 23 routes.
const nonAscii = Object.entries(ROUTE_PROVENANCE)
  .filter(([p, v]) => /[^\x20-\x7E]/.test(p) || (v.s && /[^\x20-\x7E]/.test(v.s)) || /[^\x20-\x7E]/.test(v.k));
check('every manifest value is header-safe ASCII', nonAscii.length === 0,
  `${nonAscii.length} would throw in Headers.set(): ${nonAscii.slice(0, 3).map(e => e[0]).join(', ')}`);

// ── 6. Prefix resolution, since most routes are matched by prefix ────────────
check('an exact entry wins over a prefix', provenanceFor('/wc/odds-probs') === ROUTE_PROVENANCE['/wc/odds-probs']);
check('an unknown path under no prefix resolves to null', provenanceFor('/zzz/nope') === null);

// A prefix entry has to be reachable from a path a client would actually ask
// for. 13 of the 50 prefix routes have no trailing slash -- /fd, /fpl, /odds,
// /nba-stats and nine more -- and the first matcher required one, so every real
// request under them stamped "unmapped" in production while the census counted
// them mapped. A gap that reports as covered is the worst kind. Found by the
// runtime probe; this is the static check that would have found it first.
const unreachable = Object.entries(ROUTE_PROVENANCE)
  .filter(([, v]) => v.p)
  .filter(([p]) => provenanceFor(`${p.replace(/\/$/, '')}/probe/subpath`) === null);
check('every prefix route resolves from a real sub-path', unreachable.length === 0,
  `${unreachable.length} unreachable: ${unreachable.slice(0, 6).map(e => e[0]).join(', ')}`);

// "reads nothing" and "we could not tell" must not collapse into each other.
const nulls = Object.entries(ROUTE_PROVENANCE).filter(([, v]) => v.s === null);
check('only triggers and pure computations claim to read nothing',
  nulls.every(([, v]) => v.k === 'trigger' || v.k === 'computed'),
  `a route that reads something claims otherwise: ${nulls.filter(([, v]) => v.k !== 'trigger' && v.k !== 'computed').slice(0, 4).map(e => `${e[0]} (${e[1].k})`).join(', ')}`);

const undeclared = Object.entries(ROUTE_PROVENANCE).filter(([, v]) => v.s && v.s.startsWith('undeclared'));
console.log(`\n  ${undeclared.length} route(s) undeclared — the URL is built in a helper this parser does not follow:`);
for (const [p, v] of undeclared) console.log(`         ${p}  (${v.k})`);
// A ratchet, not a gate: undeclared is honest, but it should not grow quietly.
//
// It went 1 -> 13 -> 3. The 13 were routes claiming `s: null` while delegating;
// naming that honestly was the improvement. Then following the delegate one
// level -- an approach rejected earlier in the session for attributing
// statsapi.mlb.com to /nba-stats -- was re-tested after functionBody stopped
// over-capturing, produced no false attributions, and closed 16 of them. The old
// conclusion had been true of the old bug, not of the approach.
//
// The original note follows, because the reasoning still governs the 3 left.
// It went 1 -> 13 deliberately, and the direction is an improvement. Those 13
// were previously claiming `s: null` -- "reads nothing" -- while delegating
// their entire job to a helper. /health/sources, the Stale Data Sentinel itself,
// was among them. "We did not look that far" and "there is nothing there" are
// different answers, and the manifest is stamped onto live responses, so it has
// to be the honest one.
//
// Lowering this number means naming the source in the handler or teaching the
// generator to follow that specific shape -- never relabelling a delegating
// route as reading nothing.
const UNDECLARED_BUDGET = 3;
check(`undeclared routes stay within budget (${UNDECLARED_BUDGET})`, undeclared.length <= UNDECLARED_BUDGET,
  `${undeclared.length} now. Name the host in the handler, or raise the budget in this file deliberately.`);

console.log(`\n  ${Object.keys(ROUTE_PROVENANCE).length} routes mapped, ` +
            `${Object.values(ROUTE_PROVENANCE).filter(v => v.s).length} with a declared source`);
console.log(failed === 0 ? '  PASS' : `  FAIL — ${failed}`);
process.exit(failed === 0 ? 0 : 1);
