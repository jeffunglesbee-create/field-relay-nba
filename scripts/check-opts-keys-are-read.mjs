#!/usr/bin/env node
// A key passed in an options literal must be read by the function receiving it.
//
// WHY THIS EXISTS. On 2026-07-16, commit 6aed3bb deliberately removed layer
// 3b's numeric retry gate and replaced it with a qualitative voice judge:
//
//   -  const THRESHOLD = opts.scoreThreshold || 240;
//   -  if (score < THRESHOLD && retries < maxRetries) {
//
// That removal was right. The composite it gated scored the file's own labeled
// ANTI-exemplar 214/300 and its own real Exemplar A 136/300. What the commit did
// not do was remove the seven call sites still passing `scoreThreshold:` into
// runQualityChain. For 39 days every journalism path handed the chain a retry
// floor it no longer read, and nothing anywhere said so:
//
//   threshold   0  -> proxyCalls 1, score 126, layers ""   (deliberately weak prose)
//   threshold 999  -> proxyCalls 1, score 126, layers ""
//
// A floor of 999 accepted a 126 without one retry. The queue item that sent me
// here was "raise scoreThreshold 110 -> 196", which would have changed nothing
// at all -- era 4's mistake exactly: writing new numbers into a table the
// scorer does not consult.
//
// AND THE ERA LEDGER RECORDED HALF OF IT. 6aed3bb IS era 2's boundary commit.
// Its `change` field reads "Dim 1 redefined per-sentence; Dim 4 clamped to
// [0,1]" -- the scoring half. The retry-gate removal is named in the commit's
// own subject line and absent from the era record. The mechanism built to make
// scoring changes non-silent logged one of the two changes in the commit that
// created this fossil.
//
// So the guard is not about scoreThreshold. It is about the shape: a caller
// says something, the callee stopped listening, and nothing connects the two.
// Same family as SCALE's declared weights versus its implementation ceilings,
// and as UNREACHABLE_DIMS naming a key SCALE no longer had.
//
// --self-test injects an unread key and requires the check to go red.

import { readFileSync } from 'node:fs'

// Callees to police, and where their call sites live.
const WATCH = [
  { fn: 'runQualityChain', defIn: 'src/journalism-quality.js',
    callsIn: ['src/index.js'],
    // Keys the callee legitimately never reads: none today. An entry here needs
    // a reason, because "it's fine" is how the last one lasted 39 days.
    allowUnread: {} },
]

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

// Comments and string bodies are blanked (length-preserving) before any brace
// scan, so a `{` inside a comment or a template literal cannot desynchronise the
// matcher. Blanking rather than deleting keeps every offset valid.
export const blankNonCode = (src) => {
  const out = src.split('')
  let i = 0, n = src.length
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) { j++; break }
        j++
      }
      blank(i + 1, Math.max(i + 1, j - 1)); i = j; continue
    }
    i++
  }
  return out.join('')
}

// The object literal that is the LAST argument of each `fn(` call.
export const optsLiteralsFor = (fn, src) => {
  const code = blankNonCode(src)
  const lits = []
  const re = new RegExp(`\\b${fn}\\s*\\(`, 'g')
  let m
  while ((m = re.exec(code))) {
    // Walk to the call's closing paren, tracking the last `{` opened at depth 1.
    let i = m.index + m[0].length, depth = 1, lastObjStart = -1
    while (i < code.length && depth > 0) {
      const ch = code[i]
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
      else if (ch === '{') {
        if (depth === 1) lastObjStart = i
        // skip the whole object so nested braces don't move lastObjStart
        let d2 = 1, j = i + 1
        while (j < code.length && d2 > 0) { if (code[j] === '{') d2++; else if (code[j] === '}') d2--; j++ }
        i = j; continue
      }
      i++
    }
    if (lastObjStart < 0) { lits.push(null); continue }   // no options literal
    let d2 = 1, j = lastObjStart + 1
    while (j < code.length && d2 > 0) { if (code[j] === '{') d2++; else if (code[j] === '}') d2--; j++ }
    lits.push({ start: lastObjStart, body: code.slice(lastObjStart + 1, j - 1), line: code.slice(0, m.index).split('\n').length })
  }
  return lits
}

// Top-level `key:` in an object literal body. Nested objects are skipped so
// `game: { home }` contributes `game`, not `home`.
export const topLevelKeys = (body) => {
  const keys = []
  let depth = 0
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (depth === 0) {
      const m = line.match(/^([A-Za-z_$][\w$]*)\s*:/)
      if (m) keys.push(m[1])
    }
    for (const ch of raw) { if (ch === '{' || ch === '[') depth++; else if (ch === '}' || ch === ']') depth-- }
    if (depth < 0) depth = 0
  }
  return keys
}

// Every `opts.<name>` the callee reads, plus destructured `{a, b} = opts`.
export const optsReadsIn = (fn, src) => {
  const code = blankNonCode(src)
  const m = new RegExp(`function\\s+${fn}\\s*\\(([^)]*)\\)\\s*\\{`).exec(code)
  if (!m) return null
  const optsName = (m[1].split(',').pop() || '').trim().split('=')[0].trim()
  if (!optsName || !/^[A-Za-z_$][\w$]*$/.test(optsName)) return null
  let d = 1, i = m.index + m[0].length
  while (i < code.length && d > 0) { if (code[i] === '{') d++; else if (code[i] === '}') d--; i++ }
  const body = code.slice(m.index, i)
  const reads = new Set()
  for (const r of body.matchAll(new RegExp(`\\b${optsName}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'))) reads.add(r[1])
  for (const r of body.matchAll(new RegExp(`\\{([^}]*)\\}\\s*=\\s*${optsName}\\b`, 'g')))
    for (const k of r[1].split(',')) { const kk = k.split(':')[0].trim(); if (kk) reads.add(kk) }
  return { optsName, reads }
}

export const unreadKeys = (w, defSrc, callSrcs) => {
  const r = optsReadsIn(w.fn, defSrc)
  if (!r) return { error: `could not locate ${w.fn}'s definition or name its options parameter` }
  const found = []
  for (const [file, src] of callSrcs) {
    for (const lit of optsLiteralsFor(w.fn, src)) {
      if (!lit) continue
      for (const k of topLevelKeys(lit.body))
        if (!r.reads.has(k) && !(k in w.allowUnread)) found.push({ file, line: lit.line, key: k })
    }
  }
  return { reads: [...r.reads].sort(), found }
}

const load = (p) => readFileSync(p, 'utf8')

if (process.argv.includes('--self-test')) {
  console.log('self-test: an unread key is caught, and a read one is not')
  const w = WATCH[0]
  const defSrc = load(w.defIn)
  const callSrc = load(w.callsIn[0])

  // THE DEFECT, REPLAYED. This is the literal line that sat in seven call sites
  // for 39 days after its reader was deleted.
  const bent = callSrc.replace('sport,\n      scoreThreshold', 'sport,\n      scoreThreshold') // no-op guard against drift
  const injected = callSrc.replace(
    /runQualityChain\(seriesPrompt, initial, callProxy, \{\n(\s+)sport,/,
    'runQualityChain(seriesPrompt, initial, callProxy, {\n$1sport,\n$1scoreThreshold: 240,')
  check('the injection actually changed the source',
    injected !== callSrc, 'the anchor moved — this self-test is measuring nothing')
  const bad = unreadKeys(w, defSrc, [['injected', injected]])
  check('an options key the callee never reads is caught',
    !bad.error && bad.found.some((f) => f.key === 'scoreThreshold'),
    JSON.stringify(bad).slice(0, 300))

  // The control. Without it a checker that reds everything passes the above.
  const good = unreadKeys(w, defSrc, [['real', callSrc]])
  check('the real call sites pass',
    !good.error && good.found.length === 0,
    good.error || `unread: ${JSON.stringify(good.found)}`)

  // And the reader must have read something.
  check('the callee\'s opts reads were actually parsed',
    !good.error && good.reads.length >= 3, JSON.stringify(good.reads))

  // A brace inside a comment or template literal must not desynchronise it.
  const tricky = callSrc.replace('const CORS', '// a stray { brace in a comment\nconst _t = `a ${1} template { brace`;\nconst CORS')
  // Keys only, not line numbers: the injected comment shifts every line by two,
  // and comparing the shifted numbers would fail for a reason that has nothing
  // to do with brace tracking. The claim is about WHAT is found, not where.
  const keysOf = (r) => r.found.map((f) => f.key).join(',')
  check('braces in comments and template literals do not shift the parse',
    tricky !== callSrc && keysOf(unreadKeys(w, defSrc, [['t', tricky]])) === keysOf(good),
    `tricky: ${keysOf(unreadKeys(w, defSrc, [['t', tricky]]))}\n       real:   ${keysOf(good)}`)
  check('...and unread keys are still caught in that state',
    unreadKeys(w, defSrc, [['t', tricky.replace(
      /runQualityChain\(seriesPrompt, initial, callProxy, \{\n(\s+)sport,/,
      'runQualityChain(seriesPrompt, initial, callProxy, {\n$1sport,\n$1bogusKey: 1,')]])
      .found.some((f) => f.key === 'bogusKey'),
    'a checker that goes quiet under tricky input is worse than none')
} else {
  console.log('every key passed in an options literal is read by its callee')
  for (const w of WATCH) {
    const res = unreadKeys(w, load(w.defIn), w.callsIn.map((p) => [p, load(p)]))
    check(`${w.fn}: its options parameter was located and parsed`,
      !res.error, res.error || '')
    if (res.error) continue
    check(`${w.fn}: every passed key is read (${res.reads.length} reads: ${res.reads.join(', ')})`,
      res.found.length === 0,
      res.found.map((f) => `${f.file}:~${f.line} passes \`${f.key}\` — ${w.fn} never reads opts.${f.key}`).join('\n       '))
  }
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
