#!/usr/bin/env node
// Empty catches: bare / suppressed-with-reason / clean, with a baseline that
// fails when BARE RISES — not when it is above zero.
//
// docs/CC-CMD-2026-10-03-empty-catch-gate.md.
//
// WHY NOT GREP, AND WHY NOT LINE-BASED. scripts/audit-empty-catches.py exists
// and its own header says what it was built for: "grep-based manual review
// repeatedly missed real sites (multi-line catch bodies where the log call sits
// on the next line, not the catch() line itself)". jubilant-bassoon's
// check-absence-collapse.mjs, whose conventions this file follows, classifies
// ONE LINE AT A TIME — correct for `|| 0` collapses, and unable to see a body
// that spans lines. Porting that shape here would reintroduce the exact defect
// the auditor exists to avoid.
//
// THE DEPENDENCY DECISION (Task 0.3), AND IT CHANGED ONCE IT WAS MEASURED.
// The auditor needs `pip install tree-sitter tree-sitter-javascript`. The first
// answer was to keep it out of CI: a pip step is a network dependency on every
// gate run, and guards.yml installs nothing today beyond actions/setup-node.
//
// Then the control found two defects in this file that no amount of reading
// would have — a regex literal holding quotes, and a nested template literal —
// each of which silently zeroed whole files. A 0.8s adjudication that catches
// that class is worth an install step, so the install is in the workflow and
// `--control` runs in the gate. An absent tree-sitter FAILS rather than
// skipping, because a control that did not run is not a pass.
//
// The scan itself stays dependency-free, so `--self-test` and the baseline
// check still work on any machine with node and nothing else.
//
// SO: this file reads the WHOLE BODY by brace-matching over a code-only mask of
// the source, which spans lines by construction, and takes the CONVENTIONS from
// the client — three counts, a pragma that carries a reason, MALFORMED
// SUPPRESSION for a bare one, --self-test, --require, --json, and the file
// excluded from its own scan because it quotes the patterns it matches.
//
// AND THE PYTHON AUDITOR IS THE CONTROL, not the engine. Its
// `TOTAL genuinely empty (both patterns): N` line is an independent derivation
// from a real tree-sitter parse. `--control` compares this file's empty total
// against it per file and reports disagreements. Two derivations that agree are
// worth more than either alone; this one runs in CI and the other adjudicates.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = 'scripts/check-empty-catches.mjs'

// ── a code-only mask, same length as the source ─────────────────────────────
// Non-code characters become spaces, so an offset in the mask is the same
// offset in the raw text. That is what lets brace matching run on code while
// comment text is read from the original.
// REGEX LITERALS ARE HANDLED, and they are the reason this function has an
// `ok` flag. src/browser-do.js:122 holds
// `selector.match(/:text\(['"](.+)['"]\)/)` — four quote characters inside a
// regex. Read as string delimiters they pair off wrongly and leave the scanner
// inside a string for the REST OF THE FILE: the first run of this checker
// found 4 catch sites in that file where the tree-sitter control found 13, and
// every site after line 122 was invisible. The count was not wrong by a little.
// It was a silent zero over two thirds of a file.
//
// Telling a regex from a division needs the preceding token, which is the
// problem scripts/lib/route-scan.mjs declined to solve and documented. The
// heuristic below is the standard one: after an operator, an opening bracket or
// a keyword, `/` starts a regex; after a value it is division.
//
// AND THE HEURISTIC IS NOT TRUSTED. A single- or double-quoted string cannot
// span a newline in valid JavaScript, so hitting one proves the scan is lost.
// `ok: false` then says so and the file is reported UNPARSED — never as a count.
// A wrong answer that looks like a clean file is the failure this guards.
const REGEX_PRECEDERS = /[([{,;:=!&|?+\-*~^%<>]$|\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)$/

export const codeMask = (src) => {
  let out = '', i = 0, ok = true, lostAt = null
  let quote = null, blk = false, lineC = false
  // TEMPLATE INTERPOLATIONS NEST, and treating a template as one opaque string
  // loses the scan on the FIRST nested backtick. Four files failed this way —
  // src/context-assembler.js:394, src/mcp-oauth.js:407,
  // scripts/build-provenance-view.mjs:67, scripts/jq-pre-game-backfill.mjs:127
  // — every one of the shape `${x ? `<b>${y}</b>` : ''}`. The inner backtick
  // closed the outer template, the following `''` opened a quote, and the rest
  // of the file was read as a string. context-assembler alone carries 11 empty
  // catches that were invisible.
  //
  // So the state is a STACK: a template pushes, `${` pushes an interpolation
  // whose contents are CODE, and its matching `}` pops back to the template.
  // The `${` and its `}` are emitted so brace matching still balances.
  const stack = []
  // A ROLLING TAIL, not a scan of everything emitted so far. The obvious
  // `out.replace(/\s+$/, '')` runs over the whole accumulated mask on EVERY
  // slash, and src/index.js holds thousands — that single expression was most
  // of a 2m15s scan across 396 files. Twelve characters is enough for the
  // longest keyword this needs to see (`instanceof`).
  let tail = '', lines = 1
  const push = (str) => {
    out += str
    for (let k = 0; k < str.length; k++) {
      const ch = str[k]
      if (ch === '\n') lines++
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') tail = (tail + ch).slice(-12)
    }
  }
  const lose = () => { if (ok) { ok = false; lostAt = lines } }
  const prevSig = () => tail
  const top = () => (stack.length ? stack[stack.length - 1] : null)

  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (blk) { if (c === '*' && n === '/') { push('  '); i += 2; blk = false; continue } push(c === '\n' ? '\n' : ' '); i++; continue }
    if (lineC) { if (c === '\n') { push('\n'); i++; lineC = false; continue } push(' '); i++; continue }
    if (quote) {
      if (c === '\\') { push('  '); i += 2; continue }
      if (c === quote) { push(' '); i++; quote = null; continue }
      if (c === '\n') { lose(); push('\n'); i++; quote = null; continue }   // cannot span a line
      push(' '); i++; continue
    }
    const t = top()
    if (t && t.t === 'tmpl') {
      if (c === '\\') { push('  '); i += 2; continue }
      if (c === '`') { push(' '); i++; stack.pop(); continue }
      if (c === '$' && n === '{') { push('${'); i += 2; stack.push({ t: 'interp', d: 0 }); continue }
      push(c === '\n' ? '\n' : ' '); i++; continue
    }
    if (c === '/' && n === '/') { push('  '); i += 2; lineC = true; continue }
    if (c === '/' && n === '*') { push('  '); i += 2; blk = true; continue }
    if (c === '/' && REGEX_PRECEDERS.test(prevSig())) {
      let j = i + 1, cls = false
      push(' ')
      while (j < src.length) {
        const d = src[j]
        if (d === '\\') { push('  '); j += 2; continue }
        if (d === '\n') { lose(); break }              // a regex cannot span a line either
        if (cls) { if (d === ']') cls = false; push(' '); j++; continue }
        if (d === '[') { cls = true; push(' '); j++; continue }
        if (d === '/') { push(' '); j++; break }
        push(' '); j++
      }
      i = j; continue
    }
    if (c === '`') { push(' '); i++; stack.push({ t: 'tmpl' }); continue }
    if (c === '"' || c === "'") { push(' '); i++; quote = c; continue }
    if (t && t.t === 'interp') {
      if (c === '{') { t.d++; push(c); i++; continue }
      if (c === '}') { if (t.d === 0) { stack.pop() } else { t.d-- } push(c); i++; continue }
    }
    push(c); i++
  }
  // An unclosed string, comment or template at EOF means the scan never
  // recovered. Reporting it is the point; a count from a lost scan is a
  // fiction, and a fiction of zero is the worst answer this gate can give.
  if (quote || blk || stack.length) lose()
  return Object.assign(out, { ok, lostAt })
}

// codeMask returns a String object carrying `ok`. Callers that only index it
// behave as before; the scan reads `.ok` to decide UNPARSED.
export const maskOk = (m) => m.ok !== false

const matchPair = (mask, open, openCh, closeCh) => {
  let d = 0
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === openCh) d++
    else if (mask[i] === closeCh) { d--; if (d === 0) return i }
  }
  return -1
}

// ── classification ──────────────────────────────────────────────────────────
// A body is EMPTY when its code-only form holds nothing. That is the auditor's
// own definition and it counts a comment-only body as empty, because a comment
// has no runtime effect. The comment is then what separates a STATED REASON
// from a bare swallow, which is the distinction the whole gate is about.
export const SUPPRESS = /\/\/\s*catch-ok:(.*)$/m
export const SUPPRESS_BLOCK = /\/\*\s*catch-ok:([\s\S]*?)\*\//

// THE PRAGMA IS ACCEPTED OUTSIDE THE BODY TOO, and it has to be. A bare
// `catch (_) {}` has nowhere inside it to write a reason, so the natural place
// is the line itself — which is exactly the trailing form the client's
// check-absence-collapse.mjs already uses. Written as body-only first, and the
// first four reasons added to this repo's own scripts landed above the `try`
// and changed the count by nothing: 116 before, 116 after. A suppression
// mechanism nobody can reach is not a mechanism.
//
// `where` is the body plus the catch's own header and closing lines. A PLAIN
// comment still counts only inside the body — a comment on the surrounding line
// could be about anything — but the explicit `catch-ok:` token is precise
// enough to honour wherever it sits in those lines.
export const classifyBody = (raw, code, where = '') => {
  if (code.replace(/[{}\s;]/g, '').length > 0) return { kind: 'clean' }
  const scope = `${raw}\n${where}`
  const m = scope.match(SUPPRESS) || scope.match(SUPPRESS_BLOCK)
  if (m) {
    const reason = m[1].trim()
    return reason
      ? { kind: 'suppressed', op: 'catch-ok', reason }
      : { kind: 'flagged', op: 'bare', note: 'MALFORMED SUPPRESSION — catch-ok with no reason' }
  }
  // A comment with no pragma is the 41 this document found already reasoned.
  const prose = raw.replace(/\/\*[\s\S]*?\*\//g, (s) => s).match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)
  const text = (prose || []).map(s => s.replace(/^\/\/|^\/\*|\*\/$/g, '').trim()).join(' ').trim()
  if (text.length > 0) return { kind: 'suppressed', op: 'comment', reason: text.slice(0, 120) }
  return { kind: 'flagged', op: 'bare' }
}

// Returns every catch site in a source, empty or not.
export const catchSites = (src) => {
  const mask = codeMask(src)
  const sites = []
  // LINE NUMBERS BY BINARY SEARCH, not by slicing the prefix. The obvious
  // `src.slice(0, off).split('\n').length` is O(file) per site, and src/index.js
  // is 22k lines with ~900 catch sites — that one expression was most of a
  // 2m15s scan of 396 files.
  const nl = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') nl.push(i + 1)
  const lineAt = (off) => {
    let lo = 0, hi = nl.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nl[mid] <= off) lo = mid; else hi = mid - 1 }
    return lo + 1
  }
  // The full source lines the catch opens and closes on — where a reason goes
  // when the body has no room for one.
  const lineSpan = (off) => {
    const l = lineAt(off)
    return src.slice(nl[l - 1], l < nl.length ? nl[l] : src.length)
  }
  const edgeLines = (startOff, endOff) =>
    lineAt(startOff) === lineAt(endOff) ? lineSpan(startOff) : `${lineSpan(startOff)}\n${lineSpan(endOff)}`

  // pattern 1 — catch (e) { ... } and catch { ... }
  for (const m of mask.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
    const open = mask.indexOf('{', m.index)
    const close = matchPair(mask, open, '{', '}')
    if (close < 0) continue
    sites.push({ pattern: 'block', line: lineAt(m.index),
      raw: src.slice(open + 1, close), code: mask.slice(open + 1, close),
      where: edgeLines(m.index, close) })
  }

  // pattern 2 — .catch(callback). The auditor covers this and a
  // block-statement-only parser does not; 44 genuine sites were found by adding
  // it, so it is not a refinement.
  for (const m of mask.matchAll(/\.catch\s*\(/g)) {
    const open = mask.indexOf('(', m.index)
    const close = matchPair(mask, open, '(', ')')
    if (close < 0) continue
    const argMask = mask.slice(open + 1, close)
    const argRaw = src.slice(open + 1, close)
    const arrow = argMask.match(/^\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/)
    const fn = argMask.match(/^\s*(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*/)
    const line = lineAt(m.index)
    let bodyStart = null
    if (arrow) bodyStart = arrow[0].length
    else if (fn) bodyStart = fn[0].length
    else continue                                   // .catch(handler) — a named fn is not a body
    const after = argMask.slice(bodyStart)
    const brace = after.indexOf('{')
    if (brace >= 0 && after.slice(0, brace).trim() === '') {
      const bOpen = open + 1 + bodyStart + brace
      const bClose = matchPair(mask, bOpen, '{', '}')
      if (bClose < 0) continue
      sites.push({ pattern: 'promise', line,
        raw: src.slice(bOpen + 1, bClose), code: mask.slice(bOpen + 1, bClose),
        where: edgeLines(m.index, bClose) })
    } else {
      // An expression body. Only null / undefined / a parenthesized one of
      // those is empty — `.catch(e => log(e))` is not.
      const expr = after.trim(), rawExpr = argRaw.slice(bodyStart).trim()
      const bare = expr.replace(/[()\s]/g, '')
      sites.push({ pattern: 'promise', line,
        raw: rawExpr, code: (bare === 'null' || bare === 'undefined') ? '' : expr || 'x',
        where: edgeLines(m.index, close) })
    }
  }
  return sites.sort((a, b) => a.line - b.line)
}

// ── entry guard ─────────────────────────────────────────────────────────────
// WITHOUT THIS THE EXPORTS ARE UNUSABLE. The CLI ran at import time, so
// `import('./check-empty-catches.mjs')` from a diagnostic printed the usage
// banner and exited 2 before any exported function could be called — which is
// exactly what happened the first time the control disagreed and the sites had
// to be listed by hand.
const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
const args = process.argv.slice(2)

if (isEntry && args.includes('--self-test')) {
  const cases = [
    // THE CASE THE AUDITOR WAS BUILT FOR: the log sits on the NEXT line, so a
    // line-based checker reads the catch line as empty.
    ['try { f() } catch (e) {\n  console.warn(e)\n}', 'clean', 'multi-line body, call on the next line'],
    ['try { f() } catch (e) {}', 'flagged', 'bare block catch'],
    ['try { f() } catch (e) { /* nothing to do */ }', 'suppressed', 'block comment as the reason'],
    ['try { f() } catch (e) {\n  // vendor omits it on preseason rows\n}', 'suppressed', 'line comment as the reason'],
    ['try { f() } catch (e) { // catch-ok: attribution must never fail a fetch\n}', 'suppressed', 'catch-ok with a reason'],
    ['try { f() } catch (e) { // catch-ok:\n}', 'flagged', 'catch-ok with NO reason is MALFORMED, not accepted'],
    ['try { f() } catch (e) { // catch-ok:   \n}', 'flagged', 'catch-ok with only whitespace'],
    ['try { f() } catch {}', 'flagged', 'optional-binding catch, bare'],
    ['p().catch(() => {})', 'flagged', 'bare promise catch'],
    ['p().catch(() => { /* fire and forget */ })', 'suppressed', 'commented promise catch'],
    ['p().catch(e => { log(e) })', 'clean', 'promise catch that does something'],
    ['p().catch(() => null)', 'flagged', 'expression body returning null'],
    ['p().catch(() => ({ results: [] }))', 'clean', 'expression body returning a value'],
    ['p().catch(console.error)', null, 'a named handler is not a body — no site'],
    // Braces and the word catch inside strings and comments must not register.
    ['const s = "catch (e) {}"', null, 'the pattern inside a string'],
    ['// is .catch(()=>{}) fire-and-forget', null, 'a comment ABOUT the pattern is not the pattern'],
    ['try { f() } catch (e) { msg("}") }', 'clean', 'a closing brace inside a string in the body'],
    ['try { f() } catch (e) {\n  /* a\n     multi-line\n     reason */\n}', 'suppressed', 'multi-line block comment reason'],
    // THE src/browser-do.js:122 CASE. Four quote characters inside a regex
    // literal. Read as delimiters they left the scanner inside a string for the
    // rest of the file and hid every later site.
    ["const t = s.match(/:text\\(['\"](.+)['\"]\\)/); try { f() } catch (e) {}", 'flagged', 'a site AFTER a regex literal holding quotes'],
    ['const r = /[/]/; try { f() } catch (e) {}', 'flagged', 'a slash inside a regex character class'],
    ['const q = a / b; const w = c / d; try { f() } catch (e) {}', 'flagged', 'division is not a regex'],
    // THE TRAILING FORM, which is the only place a reason fits on a bare body.
    ['try { f() } catch (_) {} // catch-ok: cleanup; already-gone is the goal', 'suppressed', 'pragma trailing the catch line'],
    ['try { f() } catch (_) {}', 'flagged', 'the same line with no pragma'],
    ['try { f() } catch (_) {} // just a note about something else', 'flagged', 'a plain trailing comment is NOT a reason'],
    ['try { f() } catch (e) {\n} // catch-ok: on the closing line', 'suppressed', 'pragma on the closing line'],
    ['// catch-ok: above the try, which is NOT the catch\ntry { f() } catch (e) {}', 'flagged', 'a pragma above the statement does not reach it'],
  ]
  let ran = 0, bad = 0
  for (const [src, want, label] of cases) {
    ran++
    const sites = catchSites(src)
    const got = sites.length === 0 ? null : classifyBody(sites[0].raw, sites[0].code, sites[0].where).kind
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} = ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
  }
  // The mask is load-bearing on its own, so it is tested on its own.
  const mk = codeMask('a"b{c"d')
  ran++; if (mk.length !== 7) { bad++; console.log(`  FAIL  mask preserves length = ${mk.length}`) }
  else console.log('  PASS  mask preserves offsets (same length as source)')
  ran++; if (mk.includes('{')) { bad++; console.log('  FAIL  mask keeps a brace that was inside a string') }
  else console.log('  PASS  mask drops a brace that was inside a string')

  // The lost-scan invariant. A quote that reaches a newline proves the scan is
  // wrong, and `ok:false` is what stops a wrong answer reading as a clean file.
  ran++; if (codeMask("const a = 'unterminated\nconst b = 1").ok !== false) {
    bad++; console.log('  FAIL  an unterminated quote does not set ok:false')
  } else console.log('  PASS  an unterminated quote sets ok:false')
  ran++; if (codeMask("const a = 'fine'\nconst b = `t\nmpl`").ok !== true) {
    bad++; console.log('  FAIL  a template literal spanning lines wrongly sets ok:false')
  } else console.log('  PASS  a multi-line template literal is still ok')
  ran++; if (codeMask("const t = s.match(/:text\\(['\"](.+)['\"]\\)/)").ok !== true) {
    bad++; console.log('  FAIL  the browser-do regex sets ok:false')
  } else console.log('  PASS  quotes inside a regex literal do not lose the scan')

  // THE NESTED-TEMPLATE CASE, which cost four whole files. A backtick inside a
  // ${} interpolation closed the outer template; the `''` after it opened a
  // quote that ran to the newline.
  const nest = "const s = `a ${x ? `<b>${y}</b>` : ''} c`\nconst z = 1"
  ran++; if (codeMask(nest).ok !== true) {
    bad++; console.log(`  FAIL  a nested template literal loses the scan (lostAt ${codeMask(nest).lostAt})`)
  } else console.log('  PASS  a nested template literal does not lose the scan')
  ran++; {
    const sites = catchSites(nest + '\ntry { f() } catch (e) {}')
    const got = sites.length === 1 ? classifyBody(sites[0].raw, sites[0].code, sites[0].where).kind : `${sites.length} sites`
    if (got !== 'flagged') { bad++; console.log(`  FAIL  a site after a nested template = ${got}`) }
    else console.log('  PASS  a site after a nested template is still found')
  }
  ran++; if (codeMask('const a = `unterminated').ok !== false) {
    bad++; console.log('  FAIL  an unclosed template at EOF does not set ok:false')
  } else console.log('  PASS  an unclosed template at EOF sets ok:false')
  // The interpolation's own braces must balance, or the catch-body matcher
  // would run past the end of a body that follows one.
  ran++; {
    const m = codeMask('const s = `${a}`; try { f() } catch (e) {}')
    const opens = (String(m).match(/\{/g) || []).length, closes = (String(m).match(/\}/g) || []).length
    if (opens !== closes) { bad++; console.log(`  FAIL  interpolation braces do not balance (${opens} vs ${closes})`) }
    else console.log('  PASS  interpolation braces balance in the mask')
  }

  console.log(`\nself-test: ${ran - bad}/${ran}`)
  console.log('COVERAGE: the site finder, the mask and the classifier, against')
  console.log('synthetic sources. Reads no file in the repo and proves nothing')
  console.log('about the current bare count — run --control for that.')
  process.exit(bad ? 1 : 0)
}

// ── the scan ────────────────────────────────────────────────────────────────
const EXT = /\.(js|mjs)$/
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) { if (!/^(node_modules|\.git|\.wrangler|dist|build)$/.test(e)) walk(p, out) }
    else if (EXT.test(e)) out.push(p)
  }
  return out
}

if (!isEntry) { /* imported for its exports — the scan below does not run */ }
else {
const roots = args.filter(a => !a.startsWith('--'))
if (!roots.length) { console.error('usage: check-empty-catches.mjs <root>... [--baseline=N] [--require=path:line] [--json] [--control]'); process.exit(2) }
const requires = args.filter(a => a.startsWith('--require=')).map(a => a.slice(10))
const baselineArg = args.find(a => a.startsWith('--baseline='))
const baseline = baselineArg ? Number(baselineArg.slice(11)) : null

const flagged = [], suppressed = [], unparsed = []
let cleanSites = 0, filesScanned = 0
const emptyByFile = new Map()
const scannedFiles = []

for (const root of roots) {
  const abs = resolve(root)
  const files = statSync(abs).isDirectory() ? walk(abs) : [abs]
  for (const f of files) {
    const rel = relative(process.cwd(), f)
    if (rel === SELF) continue      // it quotes every pattern it matches
    filesScanned++
    scannedFiles.push(rel)
    let src; try { src = readFileSync(f, 'utf8') } catch (_) { continue }
    // UNPARSED IS NOT ZERO. If the mask lost its place the site list is a
    // fiction, and a fiction of "no empty catches here" is the worst possible
    // answer from a gate whose whole job is to count them.
    const mask0 = codeMask(src)
    if (!maskOk(mask0)) { unparsed.push(`${rel} (scan lost at line ${mask0.lostAt})`); continue }
    let empties = 0
    for (const s of catchSites(src)) {
      const c = classifyBody(s.raw, s.code, s.where)
      if (c.kind === 'clean') { cleanSites++; continue }
      empties++
      const at = `${rel}:${s.line}`
      const rec = { at, pattern: s.pattern, op: c.op }
      if (c.kind === 'suppressed') suppressed.push({ ...rec, reason: c.reason })
      else flagged.push({ ...rec, ...(c.note ? { note: c.note } : {}) })
    }
    if (empties) emptyByFile.set(rel, empties)
  }
}

console.log(`\nscanned ${filesScanned} file(s) across ${roots.length} root(s): ${roots.join(', ')}`)
console.log(`(${SELF} excluded from its own scan — it quotes the patterns it matches)`)
console.log(`\n  bare                    ${flagged.length}`)
{
  const byPat = {}
  for (const f of flagged) byPat[f.pattern] = (byPat[f.pattern] || 0) + 1
  for (const [p, n] of Object.entries(byPat).sort((a, b) => b[1] - a[1])) console.log(`      ${p.padEnd(16)} ${n}`)
  const mal = flagged.filter(f => f.note).length
  if (mal) console.log(`      MALFORMED        ${mal}`)
}
console.log(`  suppressed-with-reason  ${suppressed.length}`)
{
  const byOp = {}
  for (const s of suppressed) byOp[s.op] = (byOp[s.op] || 0) + 1
  for (const [o, n] of Object.entries(byOp).sort((a, b) => b[1] - a[1])) console.log(`      ${o.padEnd(16)} ${n}`)
}
console.log(`  clean (catch sites)     ${cleanSites}`)
console.log(`  UNPARSED (files)        ${unparsed.length}${unparsed.length ? '  ← counted as nothing, which is why they are named' : ''}`)
for (const u of unparsed) console.log(`      ${u}`)
console.log(`  empty total             ${flagged.length + suppressed.length}  (the auditor's TOTAL line)`)
console.log('\nThree counts, not a verdict. "bare 0" alone cannot tell "nothing to')
console.log('find" from "the matcher matched nothing" — run --require against a')
console.log('known instance to rule the second out (Rule 99).')

const byFile = [...emptyByFile.entries()].sort((a, b) => b[1] - a[1])
console.log(`\n── empty catches by file (${byFile.length} files) ──`)
for (const [f, n] of byFile.slice(0, 15)) console.log(`  ${String(n).padStart(3)}  ${f}`)
if (byFile.length > 15) console.log(`  … ${byFile.length - 15} more files, each with fewer`)

if (args.includes('--json')) console.log(JSON.stringify({ flagged, suppressed, cleanSites, filesScanned, byFile }, null, 1))
else {
  console.log(`\n── first ${Math.min(10, flagged.length)} of ${flagged.length} bare ──`)
  for (const f of flagged.slice(0, 10)) console.log(`  ${f.at}  [${f.pattern}]${f.note ? `  ${f.note}` : ''}`)
}

let failed = false

// --control: the Python tree-sitter auditor adjudicates, in ONE process.
// It compares the UNION of scanned files, not just the ones this checker found
// something in — the case it most needs to catch is a file this reads as zero
// and the AST reads as five, and src/browser-do.js was caught only because its
// count happened to be 2 rather than 0.
if (args.includes('--control')) {
  const { execFileSync } = await import('node:child_process')
  const comparable = scannedFiles.filter(f => !unparsed.some(u => u.startsWith(f)))
  let out = ''
  try {
    out = execFileSync('python3', ['scripts/audit-empty-catches.py', ...comparable],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.error('\n── control: scripts/audit-empty-catches.py did not run ──')
    console.error(`  ${String(e.message).split('\n')[0]}`)
    console.error('  tree-sitter absent? `pip install tree-sitter tree-sitter-javascript`.')
    console.error('  A control that did not run is NOT a pass.')
    failed = true
    out = ''
  }
  if (out) {
    const ast = new Map()
    const errs = []
    for (const m of out.matchAll(/^PERFILE (\S+) (\d+|ERROR .*)$/gm)) {
      if (m[2].startsWith('ERROR')) errs.push(`${m[1]} — ${m[2]}`)
      else ast.set(m[1], Number(m[2]))
    }
    console.log('\n── control: scripts/audit-empty-catches.py, one process, the union ──')
    let disagree = 0
    for (const f of comparable) {
      const mine = emptyByFile.get(f) || 0
      if (!ast.has(f)) { console.log(`  NO-VERDICT  ${f} — the auditor returned no line for it`); disagree++; continue }
      const theirs = ast.get(f)
      if (theirs !== mine) { console.log(`  DISAGREE  ${f}: this ${mine}, ast ${theirs}`); disagree++ }
    }
    for (const e of errs) console.log(`  AST-ERROR  ${e}`)
    console.log(`  compared ${ast.size} of ${comparable.length} comparable files (the UNION, not just nonzero ones), ${disagree} disagreed`)
    console.log(`  ${unparsed.length} file(s) excluded as UNPARSED and named above`)
    // AN EMPTY CONTROL IS A FAILURE, not a pass.
    if (ast.size === 0) { console.error('  the control adjudicated NOTHING — that is a failure'); failed = true }
    if (disagree || errs.length) failed = true
  }
}

for (const need of requires) {
  const hit = flagged.find(f => f.at.includes(need))
  if (hit) console.log(`\nrequire OK: ${need} flagged as ${hit.op}`)
  else { console.error(`\nrequire FAILED: no bare site matches "${need}" — the check does not work`); failed = true }
}

// THE GATE IS A RATCHET, NOT A ZERO. Driving the backlog to zero in one pass is
// 60-odd judgement calls made at speed, which is how `.catch(() => {})` reached
// _scheduleAlarm in ambient-do.js under a comment reading "Always reschedule —
// never let the alarm die silently."
if (baseline !== null) {
  if (flagged.length > baseline) {
    console.error(`\nFAIL — bare empty catches ROSE: ${flagged.length} against a baseline of ${baseline}.`)
    console.error('Add a reason to the new one. The pragma is `// catch-ok: <why>` and a bare')
    console.error('pragma is rejected. Lowering the baseline is the other way to go green.')
    failed = true
  } else if (flagged.length < baseline) {
    console.log(`\nbare FELL to ${flagged.length} from a baseline of ${baseline} — lower the baseline in the workflow to lock it in.`)
  } else {
    console.log(`\nbare holds at the baseline of ${baseline}.`)
  }
}

process.exit(failed ? 1 : 0)
}
