// scripts/lib/route-scan.mjs — one parser for src/index.js, shared by the
// provenance census and the route-provenance manifest generator.
//
// It exists because the alternative is two parsers. The census learned its
// current shape by being wrong four times -- delegation read as absence, a
// pattern that could not match ES6 shorthand, cross-module helpers, and a
// parameter list read as a response field. A second copy would have to learn
// all four again, or silently not.

import { readFileSync, readdirSync } from 'node:fs';

export const SRC = 'src/index.js';
export const lines = readFileSync(SRC, 'utf8').split('\n');
export const SIBLINGS = readdirSync('src').filter(f => f.endsWith('.js') && f !== 'index.js')
  .map(f => ({ file: `src/${f}`, lines: readFileSync(`src/${f}`, 'utf8').split('\n') }));
export const ALL_FILES = [{ file: SRC, lines }, ...SIBLINGS];

// ── What counts as provenance ────────────────────────────────────────────────
// Two independent questions, kept separate on purpose. "When" without "where"
// is a timestamp on an anonymous number; "where" without "when" cannot be
// judged stale. A route needs both to be readable without reading the source.
//
// AND IT HAS TO MATCH SHORTHAND. The second version of this script still read
// /budget/odds as bare, with the helper correctly followed: oddsProviderQuota
// returns `{ ok: false, state, checked_at, note }` -- ES6 shorthand -- and the
// pattern demanded `checked_at:` with a colon. It matched nothing and reported
// that as absence. Same shape as the `_mounted.add(el)` assertion earlier this
// session that matched its own commented-out line: a pattern that cannot match
// the code it is aimed at, reporting a clean result.
//
// AND THE FOURTH VERSION WAS WRONG THE OTHER WAY. Accepting shorthand in any
// object-literal position matched `, source,` inside relayFetch's PARAMETER
// LIST -- relayFetch(url, headers, ttl, source, ctx) -- which reclassified all
// 23 proxy routes as self-describing. The self-test that was supposed to catch
// this used a LAST parameter (`, source)`, followed by a paren) and passed.
//
// So the rule is now semantic rather than positional: provenance counts only
// where a RESPONSE IS BUILT -- inside JSON.stringify(...) or a returned object
// literal. A parameter named source is not provenance no matter where it sits,
// and a field in the response is provenance no matter how it is written. This
// is the rule that should have been written first; the three positional
// versions before it were each a cheaper approximation of it that broke in a
// different direction (undercount, undercount, overcount).
const AGE_NAMES   = 'ts|timestamp|updated_at|updatedAt|checked_at|checkedAt|fetched_at|fetchedAt|generated_at|generatedAt|captured_at|capturedAt|created_at|createdAt|as_of|asOf|cached_at|cachedAt|age_seconds|ageSeconds|last_updated|lastUpdated|freshness';
const SRC_NAMES   = 'source|sources|provider|origin|via|dataSource|data_source|upstream|lambdaSource|feed|derivedFrom|computed_by';
const field = names => new RegExp(`\\b(?:${names})\\s*:|[{,]\\s*(?:${names})\\s*[,}]`);
const AGE_RE   = field(AGE_NAMES);
const SRC_RE   = field(SRC_NAMES);

// The regions of a body where a response is actually constructed. Everything
// outside them -- parameter lists, local variables, SQL, log calls -- cannot
// supply a response field, so it is not read.
function responseRegions(text) {
  const out = [];
  const starts = [];
  const RE_START = /JSON\.stringify\s*\(|return\s*\{/g;
  let m;
  while ((m = RE_START.exec(text)) !== null) starts.push(m.index + m[0].length - 1);
  for (const i of starts) {
    const open = text[i];
    const close = open === '(' ? ')' : '}';
    let depth = 0;
    for (let k = i; k < Math.min(i + 4000, text.length); k++) {
      const ch = text[k];
      if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { out.push(text.slice(i, k + 1)); break; } }
    }
  }
  return out.join('\n');
}
const AGE   = { test: t => AGE_RE.test(responseRegions(t)),  exec: t => AGE_RE.exec(responseRegions(t)) };
const SRC_F = { test: t => SRC_RE.test(responseRegions(t)),  exec: t => SRC_RE.exec(responseRegions(t)) };

// Routes that answer with someone else's bytes. Their provenance is the
// upstream's and the relay adds none -- a distinct state from "none", because
// the fix is different (wrap and stamp, vs add fields to our own response).
const PASSTHROUGH = /relayFetch\s*\(|proxyFetch\s*\(/;
// Not data surfaces. OAuth/MCP transport and redirects answer protocol, not
// values, and asking them for a data source is a category error.
const PROTOCOL = /^\/(\.well-known|oauth)\//;

// ── Extract the route table ──────────────────────────────────────────────────
const routes = [];
const RE = /pathname\s*(===|\.startsWith\()\s*'([^']+)'/g;
lines.forEach((line, i) => {
  if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(line)) !== null) {
    const method = (line.match(/request\.method\s*===\s*'(\w+)'/) || [])[1] || 'ANY';
    routes.push({ path: m[2], match: m[1] === '===' ? 'exact' : 'prefix', line: i + 1, method, guardOnly: !/^\s*if\s*\(/.test(line) && !line.includes('return') });
  }
});

// ── For each route, find the code that answers it ────────────────────────────
// Either a named handler (`return handleFoo(...)`) whose body we then read, or
// the inline block that follows.
function bodyOf(startLine) {
  // Delegation: `return someHandler(` on the dispatch line or the next few.
  for (let j = startLine - 1; j < Math.min(startLine + 3, lines.length); j++) {
    const d = lines[j].match(/return\s+(\w+)\s*\(/);
    if (d && /^(handle|build|run|get|serve)/i.test(d[1])) {
      const fnLine = lines.findIndex(l => new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${d[1]}\\b`).test(l));
      if (fnLine >= 0) {
        let end = lines.length;
        for (let k = fnLine + 1; k < lines.length; k++) {
          if (/^(export\s+)?(async\s+)?function\s/.test(lines[k])) { end = k; break; }
        }
        return { text: lines.slice(fnLine, end).join('\n'), via: d[1], resolved: true };
      }
      return { text: '', via: d[1], resolved: false };
    }
  }
  // Inline: brace-balance from the dispatch line.
  let depth = 0, started = false, end = startLine;
  for (let k = startLine - 1; k < Math.min(startLine + 400, lines.length); k++) {
    for (const ch of lines[k]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth <= 0) { end = k + 1; break; }
  }
  return { text: lines.slice(startLine - 1, end).join('\n'), via: 'inline', resolved: true };
}

// Body of a named top-level function, or '' when it is not one (imported,
// arrow-assigned, or a method). Cached -- peek helpers are called from many
// routes and the file is 19k lines.
const fnCache = new Map();
function functionBody(name) {
  if (fnCache.has(name)) return fnCache.get(name);
  const decl = new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${name}\\b`);
  let text = '';
  for (const f of ALL_FILES) {
    const start = f.lines.findIndex(l => decl.test(l));
    if (start < 0) continue;
    let end = f.lines.length;
    for (let k = start + 1; k < f.lines.length; k++) {
      if (/^(export\s+)?(async\s+)?function\s/.test(f.lines[k])) { end = k; break; }
    }
    text = f.lines.slice(start, end).join('\n');
    break;
  }
  fnCache.set(name, text);
  return text;
}

// The route body plus the bodies of the helpers it actually calls, one level.
// Without this, delegation reads as absence.
const CALL = /\b([a-z_$][\w$]*)\s*\(/g;
// `const { checkAllSources } = await import('./stale-data-sentinel.js');`
// names its helper in a destructuring, not a call. Caught explicitly.
const DESTRUCTURED_IMPORT = /const\s*\{([^}]+)\}\s*=\s*await\s+import\(/g;
const NOT_A_HELPER = /^(if|for|while|switch|catch|return|typeof|await|new|function|parseInt|parseFloat|String|Number|Boolean|Array|Object|JSON|Math|Date|Promise|fetch|console|require|import|map|filter|find|reduce|forEach|push|slice|split|join|replace|match|test|includes|startsWith|endsWith|trim|toFixed|toString|keys|values|entries|stringify|parse|all|allSettled|resolve|reject|then|bind|prepare|get|put|set|has|add)$/;
function withHelpers(text) {
  const seen = new Set();
  let m; CALL.lastIndex = 0;
  while ((m = CALL.exec(text)) !== null) {
    const n = m[1];
    if (NOT_A_HELPER.test(n) || seen.has(n)) continue;
    seen.add(n);
  }
  DESTRUCTURED_IMPORT.lastIndex = 0;
  while ((m = DESTRUCTURED_IMPORT.exec(text)) !== null) {
    for (const n of m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop().trim())) {
      if (n && !NOT_A_HELPER.test(n)) seen.add(n);
    }
  }
  let out = text;
  const followed = [];
  for (const n of seen) {
    const b = functionBody(n);
    if (b) {
      out += '\n' + b.split('\n').filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n');
      followed.push(n);
    }
  }
  return { text: out, followed };
}

// A comment describing a field the response does not carry must never count as
// the field -- the census equivalent of a regex matching its own commented-out
// line. Both tools strip the same way, from here, so they cannot disagree.
export function decomment(text) {
  return text.split('\n')
    .filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n');
}

export { AGE, SRC_F, AGE_RE, SRC_RE, responseRegions, PASSTHROUGH, PROTOCOL, routes, bodyOf, functionBody, withHelpers };
