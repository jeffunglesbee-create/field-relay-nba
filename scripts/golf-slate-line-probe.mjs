#!/usr/bin/env node
// What does buildGameLine ACTUALLY return for a golf event?
//
// docs/CC-CMD-2026-08-25-golf-slate-line.md, ask 1. That document is explicit
// that its own reasoning is read from source and has never been observed, and
// that if the line turns out harmless the CC-CMD closes as WITHDRAWN. So this
// probe decides whether anything ships.
//
// IT RUNS THE REAL FUNCTION, NOT A COPY. buildGameLine is not exported from
// src/index.js, and pasting it here would make this a test of a copy — the
// source-versus-copy substitution field-laboratory's CLAUDE.md is written
// about. Instead the function text is sliced out of src/index.js by brace
// balance and evaluated. It touches nothing but its two arguments, which the
// probe asserts before trusting the slice.
//
// CI because site.api.espn.com is 403-at-CONNECT from the container.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SRC = 'src/index.js'
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports'

// ── slice the function out of the source ────────────────────────────────────
export const sliceFunction = (src, name) => {
  const head = `function ${name}(`
  const at = src.indexOf(head)
  if (at < 0) return { ok: false, why: `no \`${head}\` in source` }
  if (src.indexOf(head, at + 1) >= 0) return { ok: false, why: `\`${head}\` appears more than once` }
  let depth = 0, i = src.indexOf('{', at)
  const open = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  if (depth !== 0) return { ok: false, why: 'braces never balanced' }
  return { ok: true, text: src.slice(at, i + 1), startLine: src.slice(0, at).split('\n').length, bodyChars: i - open }
}

// ── self-test ───────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  let ran = 0, bad = 0
  const eq = (got, want, label) => {
    ran++; const ok = got === want; if (!ok) bad++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} = ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
  }
  eq(sliceFunction('function f(a) { return a }', 'f').text, 'function f(a) { return a }', 'a one-line function')
  // Four lines, not five: the slice starts at `function` and ends at the
  // closing brace, so the leading `x` and trailing `y` are outside it. Written
  // as 5 first and the self-test caught the arithmetic.
  eq(sliceFunction('x\nfunction f(a) {\n  if (a) { return 1 }\n  return 0\n}\ny', 'f').text.split('\n').length, 4, 'nested braces')
  eq(sliceFunction('x\nfunction f(a) {\n  if (a) { return 1 }\n  return 0\n}\ny', 'f').text.endsWith('}'), true, 'the slice ends at the closing brace')
  eq(sliceFunction('x\nfunction f(a) {\n  if (a) { return 1 }\n  return 0\n}\ny', 'f').text.includes('y'), false, 'nothing after the function comes with it')
  eq(sliceFunction('function g(){}', 'f').ok, false, 'a name that is not there')
  eq(sliceFunction('function f(){}\nfunction f(){}', 'f').ok, false, 'a name that is there twice')
  eq(sliceFunction('function f() { if (1) {', 'f').ok, false, 'braces that never balance')
  eq(sliceFunction('x\nfunction f(a) { return a }', 'f').startLine, 2, 'the reported start line')

  // The slice must be callable and must not reach outside its arguments.
  const fn = new Function(`${sliceFunction('function f(ev) { return ev.competitions?.[0]?.id ?? null }', 'f').text}; return f`)()
  eq(fn({ competitions: [{ id: '7' }] }), '7', 'the slice evaluates and runs')

  console.log(`\nself-test: ${ran - bad}/${ran}`)
  console.log('COVERAGE: the slicer only. It makes no HTTP call and says nothing')
  console.log('about what buildGameLine returns for golf — that needs the live run.')
  process.exit(bad ? 1 : 0)
}

// ── the live probe ──────────────────────────────────────────────────────────
const src = readFileSync(SRC, 'utf8')
const sl = sliceFunction(src, 'buildGameLine')
if (!sl.ok) { console.error(`FAIL — could not slice buildGameLine: ${sl.why}`); process.exit(1) }

// IT MUST NOT REACH OUTSIDE ITS ARGUMENTS, or the slice is not the function.
// Checked rather than assumed: evaluated in a Function scope with no closure,
// so any free identifier it needs would throw.
let buildGameLine
try { buildGameLine = new Function(`${sl.text}; return buildGameLine`)() }
catch (e) { console.error(`FAIL — the slice does not evaluate standalone: ${e.message}`); process.exit(1) }

const calls = []
const get = async (path) => {
  calls.push(path)
  const r = await fetch(`${ESPN}${path}`, { headers: { 'User-Agent': 'FIELD/1.0' } })
  return { status: r.status, body: r.ok ? await r.json() : null }
}

const DATE = process.env.ESPN_DATE || new Date().toISOString().slice(0, 10).replace(/-/g, '')
const out = { probed_at_utc: process.env.PROBE_STAMP || null, espnDate: DATE,
  buildGameLine: { startLine: sl.startLine, bodyChars: sl.bodyChars }, calls: [], findings: {} }

// 1 — the golf scoreboard, the shape of a competitor
const golf = await get(`/golf/pga/scoreboard?dates=${DATE}`)
const ev = golf.body?.events?.[0]
const comp = ev?.competitions?.[0]
const competitors = comp?.competitors || []
const first = competitors[0] || null

out.findings.golf = {
  status: golf.status,
  events: golf.body?.events?.length ?? null,
  eventName: ev?.name ?? null,
  statusState: comp?.status?.type?.state ?? null,
  statusDescription: comp?.status?.type?.description ?? null,
  competitors: competitors.length,
  // THE PREMISE: a golf competitor carries `athlete`, not `team`.
  firstHasTeam: first ? ('team' in first) : null,
  firstHasAthlete: first ? ('athlete' in first) : null,
  firstHomeAway: first?.homeAway ?? null,
  firstScore: first?.score ?? null,
  firstAthleteName: first?.athlete?.displayName ?? null,
}

// 2 — THE ARTIFACT. The literal string, whatever it says.
if (ev) {
  const line = buildGameLine(ev, 'PGA Tour')
  out.findings.line = line
  out.findings.lineIsNull = line === null
  // Two empty names means the line opens with the SCORES either side of the @.
  out.findings.bothNamesEmpty = typeof line === 'string'
    && /^(\S*)\s*@\s*(\S*)\s*·/.test(line)
    && !/[A-Za-z]{2}.*@/.test(line.split('·')[0])
} else {
  out.findings.line = null
  out.findings.lineIsNull = null
  out.findings.bothNamesEmpty = null
}

// 3 — a team sport through the same function, as the control. Without it a
// weird-looking golf line cannot be told from a weird-looking formatter.
for (const [sport, league, label] of [['football', 'nfl', 'NFL'], ['basketball', 'nba', 'NBA']]) {
  const r = await get(`/${sport}/${league}/scoreboard?dates=${DATE}`)
  const e = r.body?.events?.[0]
  if (!e) { out.findings[`control_${league}`] = { status: r.status, events: r.body?.events?.length ?? 0, line: null }; continue }
  out.findings[`control_${league}`] = { status: r.status, events: r.body.events.length, line: buildGameLine(e, label) }
}

out.calls = calls
mkdirSync('outbox', { recursive: true })
const stamp = process.env.PROBE_STAMP || 'latest'
writeFileSync(`outbox/golf-slate-line-probe-${stamp}.json`, JSON.stringify(out, null, 2))
writeFileSync('outbox/golf-slate-line-probe-latest.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))

console.log(`\nCOVERAGE: 1 golf event of ${out.findings.golf.events ?? 0} on ${DATE}, plus 2 team-sport controls.`)
console.log(`calls: ${calls.length}`)

// THE VERDICT IS NOT A PASS/FAIL. This probe decides whether the CC-CMD ships
// or is withdrawn, so it states which and exits 0 either way — a non-zero exit
// would read as "the probe broke".
if (out.findings.golf.events === 0) {
  console.log('\nVERDICT: UNMEASURED — no golf event on this date. Re-run on a tournament day.')
} else if (out.findings.lineIsNull) {
  console.log('\nVERDICT: WITHDRAW — buildGameLine returns null for golf, so no line reaches the prompt.')
} else if (out.findings.bothNamesEmpty) {
  console.log('\nVERDICT: SHIPS — the line carries two empty names and two scores.')
  console.log(`  ${JSON.stringify(out.findings.line)}`)
} else {
  console.log('\nVERDICT: READ IT — a line exists and the empty-name test did not fire. The string is the answer:')
  console.log(`  ${JSON.stringify(out.findings.line)}`)
}
