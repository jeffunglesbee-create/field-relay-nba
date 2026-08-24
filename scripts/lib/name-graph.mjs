// The graph of names that must resolve to other names.
//
// WHY THIS EXISTS. In one session this repo shipped six separate guards, each
// hand-written after an incident, each checking exactly one edge:
//
//   check-scale-matches-implementation   declared weight  -> implementation ceiling
//   check-slate-caps-are-derived         dim list name    -> SCALE key
//   check-opts-keys-are-read             call-site key    -> callee's opts read
//   check-aggregate-launders-unknowns    response field   -> aggregate
//   DIM_TO_SCALE completeness            breakdown key    -> SCALE key
//   candidate delta assertions           delta key        -> SCALE key
//
// Every one was written after the same shape had already caused damage, and
// every one covers a single edge. There was no graph, so a rename surfaced as
// several separate incidents weeks apart instead of one red check:
//
//   SCALE.matchup -> SCALE.margin broke UNREACHABLE_DIMS (ceilings moved 245->277
//   and 270->294 silently), DIM_TO_SCALE (candidates evaluated a 244-point rubric
//   and reported 294), and three candidate weightings -- found on three separate
//   days, by three separate investigations.
//
// So this is the registry. A NODE is a set of names read FROM SOURCE. An EDGE
// says "every name on this side must exist on that side". Adding a dependency is
// adding an edge, not writing a seventh script.
//
// WHAT IT DOES NOT DO, stated so nobody trusts it further than it goes. It
// checks that names RESOLVE. It cannot check that a value is right, that an
// abstain scores the midpoint, that a regex means what its author intended, or
// that a total reconciles with its rows. The existing guards keep those
// assertions; this removes only the name-resolution half, which is the half that
// kept recurring.
//
// EVERY RESOLVER READS FROM SOURCE OR CALLS THE REAL FUNCTION. A resolver that
// restated a list would be one more declaration to drift, which is the defect.

import { readFileSync } from 'node:fs'
import { SCALE, SLATE_CAPS, UNREACHABLE_DIMS, UNREACHABLE_DIMS_GAME, CAPPED_DIMS, scoreProse }
  from '../../src/journalism-quality.js'

const src = (p) => readFileSync(p, 'utf8')

// Length-preserving blank of comments and string bodies, so a name quoted in
// prose is never mistaken for a declaration. Shared with
// check-opts-keys-are-read.mjs's approach; kept here so this module stands alone.
export const blankNonCode = (s) => {
  const out = s.split('')
  let i = 0
  const n = s.length
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < n) {
    const c = s[i], d = s[i + 1]
    if (c === '/' && d === '/') { let j = s.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue }
    if (c === '/' && d === '*') { let j = s.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) { if (s[j] === '\\') { j += 2; continue } if (s[j] === c) { j++; break } j++ }
      blank(i + 1, Math.max(i + 1, j - 1)); i = j; continue
    }
    i++
  }
  return out.join('')
}

/// Top-level `key:` names of the object literal that follows `anchor`.
export const objectKeysAfter = (code, anchor) => {
  const at = code.indexOf(anchor)
  if (at < 0) return null                    // null, never [] — see resolveEdges
  const open = code.indexOf('{', at)
  if (open < 0) return null
  let depth = 1, i = open + 1
  const keys = []
  while (i < code.length && depth > 0) {
    const ch = code[i]
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
    else if (depth === 1 && /[A-Za-z_$]/.test(ch)) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(code.slice(i))
      if (m) { keys.push(m[1]); i += m[0].length; continue }
    }
    i++
  }
  return keys
}

/// Top-level string VALUES of that same literal (`a: 'b'` -> 'b').
export const objectValuesAfter = (raw, anchor) => {
  const at = raw.indexOf(anchor)
  if (at < 0) return null
  const open = raw.indexOf('{', at)
  if (open < 0) return null
  const blanked = blankNonCode(raw)
  let depth = 1, i = open + 1
  const end = (() => { let d = 1, j = open + 1
    while (j < blanked.length && d > 0) { if (blanked[j] === '{') d++; else if (blanked[j] === '}') d--; j++ }
    return j })()
  const body = raw.slice(open + 1, end - 1)
  const vals = []
  for (const m of body.matchAll(/[A-Za-z_$][\w$]*\s*:\s*'([^']*)'/g)) vals.push(m[1])
  void depth; void i
  return vals
}

// ── NODES ───────────────────────────────────────────────────────────────────
// Each returns a list of names, or null when the reader could not find its
// anchor. Null is a FAILURE, never an empty set: a resolver that silently
// returns nothing turns every edge green, which is this session's other defect.
export const NODES = {
  'scale.keys': {
    what: 'the dimensions SCALE declares a weight for',
    resolve: () => Object.keys(SCALE),
  },
  'breakdown.dims': {
    what: 'the dimension keys scoreProse actually returns',
    // Calls the real function. A list restated here would be a second
    // declaration, which is the thing being guarded against.
    resolve: async () => Object.keys(
      (await scoreProse('Arsenal held on to win 2-1.', { sport: 'soccer', game: null, breakdown: true })).dims),
  },
  'slate-caps.keys': {
    what: 'dims SLATE_CAPS assigns a slate-shape ceiling',
    resolve: () => Object.keys(SLATE_CAPS),
  },
  'unreachable-dims.names': {
    what: 'names in UNREACHABLE_DIMS / UNREACHABLE_DIMS_GAME / CAPPED_DIMS',
    resolve: () => [...UNREACHABLE_DIMS, ...UNREACHABLE_DIMS_GAME, ...CAPPED_DIMS],
  },
  'dim-to-scale.keys': {
    what: 'breakdown keys the rescore script maps',
    resolve: () => objectKeysAfter(blankNonCode(src('scripts/rescore-quality-6b.mjs')), 'const DIM_TO_SCALE'),
  },
  'dim-to-scale.values': {
    what: 'SCALE keys the rescore script maps onto',
    resolve: () => objectValuesAfter(src('scripts/rescore-quality-6b.mjs'), 'const DIM_TO_SCALE'),
  },
  'event.container-sports': {
    what: 'sports with an ESPN event container',
    resolve: () => objectKeysAfter(blankNonCode(src('src/context-assembler.js')), 'const _EVENT_CONTAINER'),
  },
  'event.slug-sports': {
    what: 'sports with an ESPN summary slug',
    resolve: () => objectKeysAfter(blankNonCode(src('src/context-assembler.js')), 'const _EVENT_SLUG'),
  },
}

// ── EDGES ───────────────────────────────────────────────────────────────────
// `why` is the incident. Not decoration: an edge whose reason nobody can state
// is an edge nobody will maintain.
export const EDGES = [
  { from: 'slate-caps.keys', to: 'scale.keys',
    why: 'era 6 renamed SCALE.matchup -> margin. UNREACHABLE_DIMS kept naming "matchup", both filters matched nothing, and the reachable ceilings moved 245->277 and 270->294 with no error and no diff on those lines.' },
  { from: 'unreachable-dims.names', to: 'scale.keys',
    why: 'same rename, same day. A list of names is worth exactly the guarantee that the names resolve.' },
  { from: 'dim-to-scale.values', to: 'scale.keys',
    why: 'DIM_TO_SCALE mapped matchupDepth -> "matchup" after the rename, so scoreUnder coerced the miss to zero and reconstructed a 244-point rubric while reporting nominal_total 294. Era 5s published headline was drawn from that block.' },
  { from: 'dim-to-scale.keys', to: 'breakdown.dims',
    why: 'the other half of the same map: era 6 renamed the breakdown key matchupDepth -> marginAgreement, and era 5 added finality which was never added here at all.' },
  { from: 'scale.keys', to: 'dim-to-scale.values',
    why: 'REVERSE DIRECTION, and it is the one that catches an ADDITION rather than a rename. finality existed in SCALE for a day with no DIM_TO_SCALE entry; every forward edge stayed green because nothing named it.' },
  { from: 'event.container-sports', to: 'event.slug-sports',
    why: 'buildMatchEventsContext needs BOTH; a sport in one and not the other returns an empty block silently, which is indistinguishable from a game with no scoring plays.' },
  { from: 'event.slug-sports', to: 'event.container-sports',
    why: 'reverse of the same pair.' },
]

/// Returns one result per edge. A null on either side is reported as a reader
/// failure rather than an empty set, because "found nothing" and "could not
/// look" are different findings and only one of them is safe to pass.
export const resolveEdges = async (edges = EDGES, nodes = NODES) => {
  const cache = new Map()
  const get = async (id) => {
    if (!cache.has(id)) {
      const node = nodes[id]
      cache.set(id, node ? await node.resolve() : null)
    }
    return cache.get(id)
  }
  const out = []
  for (const e of edges) {
    const from = await get(e.from), to = await get(e.to)
    if (!Array.isArray(from) || !Array.isArray(to)) {
      out.push({ ...e, readerFailed: true,
                 detail: `could not read ${!Array.isArray(from) ? e.from : e.to} — its anchor moved` })
      continue
    }
    const set = new Set(to)
    const missing = from.filter((n) => !set.has(n))
    out.push({ ...e, readerFailed: false, from_n: from.length, to_n: to.length, missing })
  }
  return out
}
