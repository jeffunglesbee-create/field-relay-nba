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
import { routes, bodyOf, withHelpers, decomment, lines, ALL_FILES } from './lib/route-scan.mjs';

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
  const text = withHelpers(decomment(b.text)).text;
  const srcs = sourcesOf(text);
  const kind = kindOf(r.path, decomment(b.text), srcs);
  const prev = seen.get(r.path);
  // Several dispatch lines can name the same path (method variants, a guard
  // list). Keep the reading that found the most, not the first one seen.
  if (!prev || srcs.length > prev.sources.length) {
    seen.set(r.path, { sources: srcs, kind, line: r.line, match: r.match });
  }
}

const entries = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const withSource = entries.filter(([, v]) => v.sources.length).length;

const body = entries.map(([path, v]) =>
  `  ${JSON.stringify(path)}: { k: ${JSON.stringify(v.kind)}, s: ${JSON.stringify(v.sources.join(' + ') || null)} },`
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
export function provenanceFor(pathname) {
  const exact = ROUTE_PROVENANCE[pathname];
  if (exact) return exact;
  let best = null, bestLen = -1;
  for (const p in ROUTE_PROVENANCE) {
    if (p.endsWith('/') && pathname.startsWith(p) && p.length > bestLen) {
      best = ROUTE_PROVENANCE[p]; bestLen = p.length;
    }
  }
  return best;
}
`;

writeFileSync('src/route-provenance.js', out);
console.log(`  src/route-provenance.js: ${entries.length} routes, ${withSource} with a declared source`);
const byKind = {};
for (const [, v] of entries) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${k}`);
