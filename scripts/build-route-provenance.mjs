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

import { writeFileSync } from 'node:fs';
import { routes, bodyOf, decomment, lines, ALL_FILES, functionBody } from './lib/route-scan.mjs';

// `${ODDS_BASE}/v4/...` has to resolve to a host, or the manifest names a
// variable instead of a source. Collected from every module, not assumed.
const BASES = {};
for (const f of ALL_FILES) {
  for (const l of f.lines) {
    const m = l.match(/^const\s+(\w*BASE\w*)\s*=\s*['"`](https?:\/\/[^'"`]+)['"`]/);
    if (m) BASES[m[1]] = m[2];
  }
}

const host = u => { try { return new URL(u).host; } catch (_) { return null; } };

function sourcesOf(text) {
  const found = new Set();
  // Literal upstreams.
  for (const m of text.matchAll(/['"`](https?:\/\/[^'"`\s$]+)/g)) {
    const h = host(m[1]); if (h) found.add(h);
  }
  // ${SOME_BASE}/path — resolved through the constant map above.
  for (const m of text.matchAll(/\$\{(\w*BASE\w*)\}/g)) {
    const h = BASES[m[1]] && host(BASES[m[1]]); if (h) found.add(h);
  }
  // Storage bindings, named individually: "a KV read" is not a source, but
  // "FIELD_JOURNALISM" tells a reader which key space to go look in.
  for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})\b/g)) {
    const b = m[1];
    if (/DB$/.test(b))                       found.add(`d1:${b}`);
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
  const srcs = sourcesOf(own + '\n' + builderText);
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
  const delegates = [...new Set([...own.matchAll(/\b([a-z_$][\w$]{3,})\s*\(/g)].map(m => m[1]))]
    .filter(n => !/^(if|for|while|switch|catch|return|typeof|await|parseInt|parseFloat|String|Number|Boolean|JSON|Math|Date|Promise|fetch|console|decodeURI|encodeURI)$/.test(n))
    .filter(n => functionBody(n));
  const declared = srcs.length ? srcs.join(' + ')
    : delegates.length ? `undeclared (${kind}; delegated to ${delegates.slice(0, 2).join(', ')})`
    : (kind === 'trigger' || kind === 'computed') ? null
    : `undeclared (${kind}; URL built in a helper)`;
  const prev = seen.get(r.path);
  // Several dispatch lines can name the same path (method variants, a guard
  // list). Keep the reading that found the most, not the first one seen.
  if (!prev || srcs.length > prev.sources.length) {
    seen.set(r.path, { sources: srcs, declared, kind, line: r.line, match: r.match });
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
