#!/usr/bin/env node
// scripts/build-route-provenance.mjs — generate src/route-provenance.js
//
// The manifest the response wrapper stamps from. Every route's declared source,
// read out of the code that answers it rather than typed by hand, so it cannot
// drift from what the handler actually touches.
//
// WHY GENERATED AND NOT WRITTEN. 132 routes served a value with no visible
// origin. Fixing that by editing 132 handlers is a diff nobody can review and a
// table that goes stale the first time a route changes upstream. This reads the
// same source the census reads, through the same parser, and the gate
// (scripts/check-route-provenance.mjs) fails the deploy when the committed
// manifest no longer matches the code.

import { writeFileSync, readFileSync } from 'node:fs';
import { routes, bodyOf, decomment, lines, ALL_FILES, functionBody } from './lib/route-scan.mjs';

// `${ODDS_BASE}/v4/...` has to resolve to a host, or the manifest names a
// variable instead of a source. Collected from every module, not assumed.
const DOC_LINE = /\b(description|example|examples|placeholder|hint|usage|docs?)\s*:|\be\.g\.|@example/i;

const BASES = {};
for (const f of ALL_FILES) {
  for (const l of f.lines) {
    // Not anchored at column 0: BSD_BASE is declared INSIDE a function, so a
    // ^const collector never saw it and four /bsd/* routes read as sourceless
    // while plainly fetching `${BSD_BASE}/api/v2/events/live/`.
    // ANY constant holding a URL, not just ones named *BASE*. The name was
    // deciding whether a URL counted, so JOURNALISM_CLAUDE_PROXY -- which
    // /test/combined-generate-judge fetches by name -- was invisible and the
    // route read as sourceless. What matters is that the constant holds a URL,
    // not what someone called it.
    if (DOC_LINE.test(l)) continue;
    const m = l.match(/\bconst\s+([A-Za-z_][\w]*)\s*=\s*['"`](https?:\/\/[^'"`${]+)['"`]/);
    if (m) BASES[m[1]] = m[2];
  }
}

// A host, or nothing. The URL literals here are template strings, and the
// extractor stops at the first `${` -- so `https://field-relay-nba.${env}` was
// yielding the host "field-relay-nba.", which went into the manifest as a source
// and would have been stamped onto live responses. A truncated hostname is a
// WRONG source, and the whole rule for this file is that a wrong source is worse
// than none. Anything that is not a plausible hostname is dropped rather than
// guessed at: it needs a dot, a real last label, and no trailing dot.
// BINDINGS COME FROM wrangler.toml, not from a regex guessing at capitalisation.
// The previous rule required [A-Z][A-Z0-9_]{2,} -- three characters or more --
// and so silently excluded `env.AI` (Workers AI) and `env.DB` (the shared D1
// binding, which is listed in this repo's own CLAUDE.md bindings table). Two
// routes read those and were reported as reading nothing.
//
// wrangler.toml declares every binding this worker has. Reading it makes the
// detection exact instead of heuristic, and a binding added there without being
// used shows up as absent rather than as a guess.
const WRANGLER = (() => {
  try {
    const t = readFileSync('wrangler.toml', 'utf8');
    const names = new Set();
    // Two shapes, and missing the second cost every Durable Object. KV, D1, R2,
    // Queues and AI declare `binding = "NAME"`; durable_objects.bindings declares
    // `name = "NAME"`. Reading only the first dropped GAME_DO, USER_DO,
    // BRACKET_DO and AMBIENT_DO, and /user/ went from do:USER_DO back to null --
    // a regression introduced by the fix for a different miss.
    for (const m of t.matchAll(/^\s*binding\s*=\s*['"]([A-Za-z_][\w]*)['"]/gm)) names.add(m[1]);
    for (const m of t.matchAll(/^\s*name\s*=\s*['"]([A-Z][A-Z0-9_]*)['"]/gm)) names.add(m[1]);
    return names;
  } catch (_) {
    return new Set();
  }
})();

// The worker's own hostname is not a source. Several routes reference a RELAY
// constant holding this worker's URL -- correctly, they do call back through it
// -- but "reads itself" is true of 38 routes and tells a reader nothing they did
// not already know. Excluded as noise, not as an error: the attribution was
// right, it was just vacuous.
const SELF_HOSTS = (() => {
  try {
    const t = readFileSync('wrangler.toml', 'utf8');
    const n = (t.match(/^\s*name\s*=\s*['"]([\w-]+)['"]/m) || [])[1];
    return n ? [new RegExp(`^${n}\\.[\\w-]+\\.workers\\.dev$`), /\.internal$/] : [/\.internal$/];
  } catch (_) {
    return [/\.internal$/];
  }
})();

const host = u => {
    try {
        const h = new URL(u).host;
        if (!h || h.endsWith('.') || !h.includes('.')) return null;
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)) return null;
        if (SELF_HOSTS.some(re => re.test(h))) return null;
        return h;
    } catch (_) {
        return null;
    }
};

// A URL in a doc string is not a source. /mcp's handler carries a tool schema
// whose `description` reads `Full URL to fetch, e.g.
// "https://aah.wd5.myworkdayjobs.com/..."` -- an example for the caller, not
// something this route reads. It was being attributed as an upstream, twice,
// which is how a sports relay came to claim a jobs board.
//
// Lines that are documenting rather than fetching are dropped before extraction.
// Narrow: a description/example/placeholder key, or an inline "e.g.".

function sourcesOf(text) {
  text = text.split('\n').filter(l => !DOC_LINE.test(l)).join('\n');
  const found = new Set();
  // Literal upstreams.
  for (const m of text.matchAll(/['"`](https?:\/\/[^'"`\s$]+)/g)) {
    const h = host(m[1]); if (h) found.add(h);
  }
  // ${SOME_BASE}/path — resolved through the constant map above.
  for (const m of text.matchAll(/\$\{([A-Za-z_][\w]*)\}/g)) {
    const h = BASES[m[1]] && host(BASES[m[1]]); if (h) found.add(h);
  }
  // A constant referenced bare, as in fetch(JOURNALISM_CLAUDE_PROXY, {...}).
  for (const name in BASES) {
    if (new RegExp(`\\b${name}\\b`).test(text)) { const h = host(BASES[name]); if (h) found.add(h); }
  }
  // Storage bindings, named individually: "a KV read" is not a source, but
  // "FIELD_JOURNALISM" tells a reader which key space to go look in.
  for (const m of text.matchAll(/\benv\??\.([A-Za-z_][\w]*)\b/g)) {
    const b = m[1];
    // Declared in wrangler.toml, or it is not a binding. When the file cannot be
    // read the old heuristic stands in, so this degrades rather than blanks.
    if (WRANGLER.size ? !WRANGLER.has(b) : !/^[A-Z][A-Z0-9_]{2,}$/.test(b)) continue;
    if (/SECRET|TOKEN|KEY|PASSWORD/i.test(b)) continue;  // a credential is not a data source
    if (b === 'AI')                          found.add('ai:AI');
    else if (/DB$/.test(b) || b === 'DB')    found.add(`d1:${b}`);
    else if (b === 'FIELD_DATA')             found.add(`r2:${b}`);
    else if (/_DO$/.test(b))                 found.add(`do:${b}`);
    else if (/KV|PUSH_SUBS|JOURNALISM|OAUTH/.test(b)) found.add(`kv:${b}`);
  }
  return [...found].sort();
}

function kindOf(path, text, srcs) {
  if (/^\/(admin|debug)\//.test(path) || /recompute|backfill|refresh|purge|reset|scrape/.test(path)) return 'trigger';
  if (/relayFetch\s*\(/.test(text)) return 'proxy';
  if (srcs.some(s => !s.includes(':'))) return 'upstream';
  if (srcs.some(s => /^(kv|d1|r2):/.test(s))) return 'store';
  if (srcs.some(s => /^do:/.test(s))) return 'durable-object';
  return 'computed';
}

const seen = new Map();
for (const r of routes) {
  if (/^\/(\.well-known|oauth)\//.test(r.path)) continue;
  const b = bodyOf(r.line);
  if (!b.resolved) continue;
  // THE ROUTE'S OWN BODY, NOT ITS HELPERS. The first version followed helpers
  // the way the census does, and the manifest came out confidently wrong:
  // /nba-stats claimed statsapi.mlb.com, /fpl claimed kaliaflstats.com, /odds
  // claimed two ESPN hosts. Following a shared helper drags in every host every
  // OTHER caller of that helper contacts.
  //
  // The census can afford breadth because it asks a yes/no question -- does this
  // route say anything about provenance. The manifest is a claim about WHERE
  // data comes from, stamped onto live responses, and a wrong source is worse
  // than none: it is the Germany v Ecuador failure with a different payload.
  // Narrow and true beats broad and plausible.
  const own = decomment(b.text);
  // ONE EXCEPTION TO "the route's own body", and it is narrow on purpose.
  // Following helpers generally is what made the first manifest claim
  // statsapi.mlb.com for /nba-stats -- a shared helper drags in every host every
  // OTHER caller of it contacts. But a function whose entire job is assembling a
  // URL is not shared context, it IS the route's source, moved one level out.
  //
  // /odds was the one route that read "undeclared": its body calls
  // oddsUrl(cleanPath, ...) and holds no host literal, while oddsUrl holds
  // exactly one. Restricted to callees whose NAME says they build a URL, and
  // used only to extract host literals, so it cannot reintroduce the failure it
  // is carved out of.
  const urlBuilders = [...new Set([...own.matchAll(/\b([a-z_$][\w$]*[Uu]rl)\s*\(/g)].map(m => m[1]))]
    .filter(n => !/^(new|fetch|encodeURI)/.test(n));
  const builderText = urlBuilders.map(n => decomment(functionBody(n) || '')).join('\n');
  // EXPERIMENT, kept because it measured clean: also follow the functions the
  // route delegates to, one level. This was rejected earlier in the session
  // because it attributed statsapi.mlb.com to /nba-stats -- but that was
  // functionBody over-capturing, reading a 9-line function as 31 by walking to
  // the next declaration. With that fixed, re-running the same experiment
  // produced no false attributions on any of the routes it previously broke.
  // The old conclusion was true of the old bug, not of the approach.
  const delegatesOf = [...new Set([...own.matchAll(/\b([a-z_$][\w$]{3,})\s*\(/g)].map(m => m[1]))]
    .filter(n => !/^(if|for|while|switch|catch|return|typeof|await|parseInt|parseFloat|String|Number|Boolean|JSON|Math|Date|Promise|fetch|console|decodeURI|encodeURI)$/.test(n))
    .filter(n => functionBody(n));
  // A SECOND LEVEL, tested the same way the first was rather than assumed safe.
  // checkAllSources and analyticsEngine read nothing directly -- they call
  // sourceVerdict and processDate, which do. Self-references are dropped, or a
  // recursive function pulls its own body in twice for nothing.
  const seen2 = new Set(delegatesOf);
  const level2 = [];
  for (const n of delegatesOf) {
    const b = decomment(functionBody(n));
    for (const m of b.matchAll(/\b([a-z_$][\w$]{3,})\s*\(/g)) {
      const c = m[1];
      if (seen2.has(c) || c === n) continue;
      if (/^(if|for|while|switch|catch|return|typeof|await|parseInt|parseFloat|String|Number|Boolean|JSON|Math|Date|Promise|fetch|console|decodeURI|encodeURI|json|text|html)$/.test(c)) continue;
      if (!functionBody(c)) continue;
      seen2.add(c); level2.push(c);
    }
  }
  // TWO LEVELS FOR BINDINGS ONLY, and the asymmetry is measured rather than
  // aesthetic. Following two levels for HOSTS became transitive closure over
  // most of the codebase: /journalism/run came back claiming 50+ sources
  // including aah.wd5.myworkdayjobs.com, a Workday allow-list regex in
  // browser-quick.js. A route that proxies sports data does not read a jobs
  // board, and a manifest that says so is worse than one that says nothing.
  //
  // Bindings do not blow up the same way. A helper that touches ARCHIVE_DB means
  // the route touches ARCHIVE_DB -- there are 13 of them, they are named in
  // wrangler.toml, and a false one is visible on sight rather than buried in a
  // list of fifty hostnames.
  const delegateText = delegatesOf.map(n => decomment(functionBody(n))).join('\n');
  const level2Text = level2.map(n => decomment(functionBody(n))).join('\n');
  const level2Bindings = sourcesOf(level2Text).filter(x => /^(kv|d1|r2|do):/.test(x));
  const srcs = [...new Set([...sourcesOf(own + '\n' + builderText + '\n' + delegateText), ...level2Bindings])].sort();
  const kind = kindOf(r.path, own, srcs);
  // THREE STATES, NOT TWO. `s: null` has to mean "reads nothing" -- a trigger
  // returning an acknowledgement, a pure computation. It must NOT also mean "we
  // could not tell", which is what /odds was about to say: its own body calls
  // oddsUrl(), so no host literal appears there, and it would have stamped
  // "none (reads nothing)" onto a route that proxies the Odds API.
  //
  // Same discipline as the odds provider quota and the cost-model verdict
  // earlier today. Unresolved and empty are different answers and a reader has
  // to be able to tell them apart, or the instrument reports absence of evidence
  // as evidence of absence.
  // A ROUTE THAT DELEGATES IS NOT A ROUTE THAT READS NOTHING, and conflating
  // them is how /health/sources -- the Stale Data Sentinel, whose entire job is
  // reporting where data came from -- came to claim it reads nothing at all.
  // Its body is four lines that call checkAllSources() in another module.
  //
  // The census, which follows helpers, called that route `both`. The manifest,
  // restricted to the route's own body, called it `null`. Two instruments
  // disagreeing about one route, and the manifest is the one stamped onto live
  // responses. Restricting to the own body is still right -- following helpers
  // is what produced statsapi.mlb.com for /nba-stats -- but the answer for a
  // delegating route is "we did not look that far", not "there is nothing there".
  // `json` is a response formatter, not a data source; naming it as a delegate
  // buries the one that matters behind noise.
  const delegates = [...new Set([...own.matchAll(/\b([a-z_$][\w$]{3,})\s*\(/g)].map(m => m[1]))]
    .filter(n => !/^(if|for|while|switch|catch|return|typeof|await|parseInt|parseFloat|String|Number|Boolean|JSON|Math|Date|Promise|fetch|console|decodeURI|encodeURI|json|text|html)$/.test(n))
    .filter(n => functionBody(n));
  // ONE function decides the label, because two were deciding it and disagreeing.
  // A union block added later recomputed `declared` from scratch and silently
  // dropped the dispatch-table case -- the downstream write winning over the
  // upstream decision, invisibly, which is the same shape as every other defect
  // this file has had. Computed once, used in both places.
  //
  // WHY it is undeclared, when the reason is knowable: /health/sources delegates
  // to checkAllSources, which reads through `source.check(env)` -- a dispatch
  // table whose callee is a property on a data structure. No parser following
  // identifiers will reach it. "Delegated to checkAllSources" invites someone to
  // go looking; "reads via a dispatch table" tells them not to bother.
  const dynamicDispatch = delegatesOf.some(n => /\.\w+\(\s*env\s*[,)]/.test(decomment(functionBody(n) || '')));
  // A route that fetches whatever the CALLER names has no fixed upstream, and
  // that is an answer rather than an absence. /rss-proxy fetches feedUrl, taken
  // from the query string; saying it "reads nothing" is false, and naming a host
  // would be a fiction. It reads whatever it is pointed at.
  const callerSupplied = /fetch\(\s*(feedUrl|targetUrl|remoteUrl|userUrl|proxyUrl|upstreamUrl)\b/.test(own)
    && /searchParams\.get|request\.url|url\.search/.test(own);
  const label = (list) => list.length ? list.join(' + ')
    : callerSupplied ? `caller-supplied (${kind}; fetches the URL given in the request)`
    : dynamicDispatch ? `undeclared (${kind}; reads via a dispatch table, not statically followable)`
    : delegates.length ? `undeclared (${kind}; delegated to ${delegates.slice(0, 2).join(', ')})`
    : (kind === 'trigger' || kind === 'computed') ? null
    : `undeclared (${kind}; URL built in a helper)`;
  const declared = label(srcs);
  // 26 paths have more than one dispatch line -- GET and POST variants, a guard
  // list plus the real handler. The first rule here kept whichever reading found
  // the MOST sources, which under-reports: if GET /journalism/run reads D1 and
  // POST reads KV, the path reads both and the manifest named one. Union.
  //
  // Safe because a guard-list mention has no sources to contribute, so merging
  // cannot pull in something the path does not do.
  const prev = seen.get(r.path);
  const merged = [...new Set([...(prev ? prev.sources : []), ...srcs])].sort();
  const mergedDeclared = label(merged);
  seen.set(r.path, {
    sources: merged,
    declared: mergedDeclared,
    // Kind stays the most specific one seen: a path answered by both a guard and
    // a real handler is what the handler does.
    kind: prev && prev.kind !== 'computed' && prev.kind !== 'trigger' ? prev.kind : kind,
    line: prev ? prev.line : r.line,
    match: prev && prev.match === 'prefix' ? 'prefix' : r.match,
  });
}

// INHERIT FROM THE ENCLOSING BLOCK. /user/event sits inside the /user/ prefix
// block, whose body creates the USER_DO stub it forwards to -- so /user/ knew
// `do:USER_DO` while /user/event, the entry that WINS at runtime because exact
// beats prefix, said it reads nothing. The more specific answer was the less
// informed one, which is the worst possible arrangement: the manifest had the
// truth and served the blank.
//
// A child inside a parent's block does what that block does, at minimum. Only
// sourceless children inherit, and only from the longest matching prefix, so a
// child that found its own sources always keeps them.
for (const [path, v] of seen) {
  if (v.sources.length) continue;
  let best = null, bestLen = -1;
  for (const [p2, v2] of seen) {
    if (p2 === path || !v2.sources.length) continue;
    if (v2.match !== 'prefix' && !p2.endsWith('/')) continue;
    if (path.startsWith(p2) && p2.length > bestLen) { best = v2; bestLen = p2.length; }
  }
  if (best) {
    v.sources = [...best.sources];
    v.declared = `${best.sources.join(' + ')} (inherited from the enclosing ${bestLen === -1 ? '' : ''}block)`;
    v.inherited = true;
  }
}

const entries = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const withSource   = entries.filter(([, v]) => v.sources.length).length;
const readsNothing = entries.filter(([, v]) => v.declared === null).length;
const undeclared   = entries.filter(([, v]) => v.declared && v.declared.startsWith('undeclared')).length;
const delegated    = entries.filter(([, v]) => v.declared && v.declared.includes('delegated to')).length;

const body = entries.map(([path, v]) =>
  `  ${JSON.stringify(path)}: { k: ${JSON.stringify(v.kind)}, s: ${JSON.stringify(v.declared)}${v.match === 'prefix' ? ', p: 1' : ''} },`
).join('\n');

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate: node scripts/build-route-provenance.mjs
// Gate:       node scripts/check-route-provenance.mjs  (blocking in deploy.yml)
//
// Where each route's data comes from, read out of the handler that answers it.
// The response wrapper in src/index.js stamps X-FIELD-Source from this, so all
// ${entries.length} routes describe themselves without ${entries.length} hand edits.
//
// \`k\` is the kind of surface, \`s\` the declared upstreams and storage bindings.
// s: null means the route answers without reading anything -- a trigger that
// returns an acknowledgement, or a pure computation. That is a real answer, not
// a gap, and the gate checks it stays true.

export const ROUTE_PROVENANCE_GENERATED_AT = ${JSON.stringify(new Date().toISOString())};
export const ROUTE_PROVENANCE = {
${body}
};

// Exact match first, then the longest matching prefix, so /wc/odds-probs beats
// /wc/ and a route added under an existing prefix inherits rather than falls
// through to nothing.
//
// \`p: 1\` marks an entry the router matches with startsWith. The first version
// inferred that from a trailing slash instead, and 13 of the 50 prefix routes
// do not have one -- /fd, /fpl, /nba-stats, /odds and nine more. Every real
// request under them stamped "unmapped" in production while the census counted
// them as mapped, which is the worst of both: a gap that reports as covered.
// Caught by the runtime probe, not by any static check, because /odds is in the
// manifest and /odds/v4/sports is what a client actually asks for.
export function provenanceFor(pathname) {
  const exact = ROUTE_PROVENANCE[pathname];
  if (exact) return exact;
  let best = null, bestLen = -1;
  for (const p in ROUTE_PROVENANCE) {
    const e = ROUTE_PROVENANCE[p];
    if (!e.p && !p.endsWith('/')) continue;
    if (pathname.startsWith(p) && p.length > bestLen) { best = e; bestLen = p.length; }
  }
  return best;
}
`;

writeFileSync('src/route-provenance.js', out);
console.log(`  src/route-provenance.js: ${entries.length} routes — ${withSource} named, ${readsNothing} read nothing, ${undeclared} undeclared (${delegated} of them delegating)`);
const byKind = {};
for (const [, v] of entries) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${k}`);
