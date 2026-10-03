// A REFUSAL THAT CANNOT EXPIRE IS WORSE THAN A FAILURE.
//
// WHY THIS EXISTS, measured 2026-10-03.
//
// `odds-daily-vs-monthly` returned `month-boundary` on four consecutive runs.
// Its log said "Not a pass and not a failure — the comparison did not run
// (Rule 99)" every time, and that sentence is correct and was the problem: the
// watch was green to every reader, the workflow exited 0, and the comparison it
// exists for had silently stopped happening. The cause was a stale span anchor
// (fixed in scripts/lib/daily-vs-monthly.cjs), but the CLASS is wider than that
// bug — every refusal verdict in this repo can latch the same way, and none of
// them has an expiry.
//
// Rule 99 made refusals honest. It did not make them temporary. This does.
//
// WHAT IT IS NOT. Not a check on the verdict's content: a single refusal is
// legitimate and expected — a real month boundary refuses for a run or two, a
// thin series has no contained day. A STREAK is the signal, because a watch
// that has not produced a judgement in N consecutive runs is not measuring
// anything, whatever its exit code says.
//
// IT READS COMMITTED LOGS FROM GIT, NOT THE WORKING TREE, and that distinction
// is the whole reliability of the gate. The first version read `outbox/` off
// disk. Running the watch locally wrote a fresh `consistent` log, the newest
// filename was that one, and the gate reported streak 0 over a committed record
// that was four refusals deep — the gate turned green because of the act of
// looking at it. Is this the source, or a copy of the source? The working tree
// is a copy. `git show HEAD:...` is the record.
//
// In CI after a checkout the two are identical, so this changes no CI
// behaviour; it stops the gate being satisfiable by hand.

import { execFileSync } from 'node:child_process'

// 3, from the shape of a legitimate refusal rather than taste. A month reset
// refuses the run that spans it and at most the next one, because the run after
// that has two readings inside the new month. Two in a row is normal; three is
// a watch that has stopped working. The measured latch was four and climbing.
const MAX_STREAK = 3

/** The verdicts that mean NO COMPARISON WAS MADE. */
const REFUSALS = new Set([
  'month-boundary', 'no-contained-day', 'not-enough-readings', 'unreadable',
  'no-data', 'counter-reset', 'window-drift', 'NOT RUN',
])

/**
 * The verdict a log concluded with, or null when the log carries none.
 *
 * null is NOT a refusal (Rule 99): a log with no verdict line is a log this
 * parser does not understand, and counting it as a refusal would manufacture a
 * streak out of a format change. It breaks the streak and is reported.
 */
export function verdictOf(text) {
  const m = String(text).match(/^\s*verdict:\s*(.+?)\s*$/m)
  if (m) return m[1].split(/\s{2,}/)[0].trim()
  if (/^NOT RUN\b/m.test(String(text))) return 'NOT RUN'
  return null
}

export const isRefusal = (v) => v !== null && REFUSALS.has(v)

/**
 * The newest-first run of logs whose verdict is a refusal.
 *
 * Stops at the first log that produced a real verdict OR that could not be
 * parsed. Both end the streak, and they are returned as different reasons
 * because "the watch judged" and "we cannot tell" are different facts.
 */
export function refusalStreak(logs) {
  let n = 0
  let endedBy = 'start-of-history'
  for (const l of logs) {
    const v = verdictOf(l.text)
    if (v === null) { endedBy = 'unparseable'; break }
    if (!isRefusal(v)) { endedBy = 'judged'; break }
    n++
  }
  return { streak: n, endedBy, verdicts: logs.slice(0, n).map(l => ({ file: l.file, verdict: verdictOf(l.text) })) }
}

// ── watches under this gate ───────────────────────────────────────────────
// One entry per watch whose log carries a `verdict:` line. Adding a watch here
// is the whole wiring; the gate needs no other edit.
const WATCHES = [
  { label: 'odds-daily-vs-monthly', prefix: 'odds-daily-vs-monthly-' },
  { label: 'odds-daily-vs-vendor', prefix: 'odds-daily-vs-vendor-20' },
]

function selfTest() {
  let pass = 0, fail = 0
  const t = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`) }
    else { fail++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`) }
  }
  const L = (verdict) => ({ file: `x-${verdict}.log`, text: `=== x ===\nverdict: ${verdict}\n` })

  t('a verdict line is read off a log', verdictOf('verdict: consistent') === 'consistent')
  t('trailing detail after two spaces is not part of the verdict',
    verdictOf('  verdict: month-boundary  2026-09 -> 2026-10') === 'month-boundary',
    verdictOf('  verdict: month-boundary  2026-09 -> 2026-10'))
  t('a NOT RUN log reports NOT RUN rather than null',
    verdictOf('NOT RUN — the series does not exist.') === 'NOT RUN')
  t('a log with no verdict at all is null, NOT a refusal', verdictOf('nothing here') === null)
  t('null is not a refusal', isRefusal(null) === false)
  t('consistent is not a refusal', isRefusal('consistent') === false)
  t('daily-exceeds-monthly is not a refusal — it is a real finding',
    isRefusal('daily-exceeds-monthly') === false)
  t('month-boundary is a refusal', isRefusal('month-boundary') === true)

  // THE MEASURED CASE. Four month-boundary logs, newest first.
  const latch = refusalStreak([L('month-boundary'), L('month-boundary'), L('month-boundary'), L('month-boundary'), L('consistent')])
  t('THE LATCH: four consecutive refusals is a streak of 4', latch.streak === 4, JSON.stringify(latch.streak))
  t('...and the streak ends at the run that judged', latch.endedBy === 'judged')
  t('...and it names the offending logs rather than only counting them',
    latch.verdicts.length === 4 && latch.verdicts[0].verdict === 'month-boundary')

  t('a single refusal is a streak of 1 and under the bar',
    refusalStreak([L('month-boundary'), L('consistent')]).streak === 1)
  t('two in a row is still under the bar — a real reset refuses twice',
    refusalStreak([L('month-boundary'), L('month-boundary'), L('consistent')]).streak < MAX_STREAK)
  t('three in a row reaches the bar',
    refusalStreak([L('month-boundary'), L('month-boundary'), L('month-boundary'), L('consistent')]).streak >= MAX_STREAK)
  t('a newest log that judged means no streak at all',
    refusalStreak([L('consistent'), L('month-boundary'), L('month-boundary'), L('month-boundary')]).streak === 0)
  t('MIXED REFUSAL KINDS STILL STREAK — the watch is not judging either way',
    refusalStreak([L('month-boundary'), L('no-contained-day'), L('unreadable')]).streak === 3)
  t('an unparseable log ENDS the streak rather than extending it',
    refusalStreak([L('month-boundary'), { file: 'y.log', text: 'garbage' }, L('month-boundary')]).streak === 1)
  t('...and says so, so a format change is not read as a healthy watch',
    refusalStreak([L('month-boundary'), { file: 'y.log', text: 'garbage' }]).endedBy === 'unparseable')
  t('no logs at all is a streak of 0 ending at the start of history',
    refusalStreak([]).endedBy === 'start-of-history')

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} self-tests`)
  return fail === 0 ? 0 : 1
}

/** Log filenames as HEAD has them. Never the working tree. */
function committedLogNames() {
  const out = execFileSync('git', ['ls-tree', '--name-only', 'HEAD', 'outbox/'], { encoding: 'utf8' })
  return out.split('\n').map(l => l.replace(/^outbox\//, '')).filter(f => f.endsWith('.log'))
}

/** One committed log's content, read out of the object store. */
const committedLog = (f) =>
  execFileSync('git', ['show', `HEAD:outbox/${f}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

function live() {
  const all = committedLogNames()
  let bad = 0
  console.log(`=== refusal streaks  utc=${new Date().toISOString()} ===\n`)
  for (const w of WATCHES) {
    // Newest first. The filenames carry sortable UTC stamps, which is why this
    // sorts names rather than reading mtimes: a `git pull` rewrites every
    // mtime, and a near-miss on exactly that cost a false report once already.
    const names = all.filter(f => f.startsWith(w.prefix)).sort().reverse()
    const logs = names.map(f => ({ file: f, text: committedLog(f) }))
    const r = refusalStreak(logs)
    const over = r.streak >= MAX_STREAK
    if (over) bad++
    console.log(`  ${over ? 'FAIL' : 'ok  '}  ${w.label.padEnd(24)} streak ${r.streak}/${MAX_STREAK}`
      + `  (${logs.length} log(s) on file, ended by ${r.endedBy})`)
    for (const v of r.verdicts) console.log(`          ${v.verdict.padEnd(22)} ${v.file}`)
    if (!logs.length)
      console.log('          NO LOGS ON FILE — not a pass. Nothing here can be judged (Rule 99).')
  }
  console.log(`\nCOVERAGE: ${WATCHES.length} watch(es), read via \`git show HEAD:\` — the`)
  console.log('COMMITTED logs, never the working tree, so running a watch by hand cannot')
  console.log('turn this green. Newest first by filename. A watch absent from WATCHES is not')
  console.log('under this gate at all, and a watch with no logs is reported as')
  console.log('unjudgeable rather than counted as green.')
  if (bad) {
    console.log(`\nFAIL: ${bad} watch(es) have refused ${MAX_STREAK}+ runs in a row. A refusal`)
    console.log('      that cannot expire is a watch that has stopped measuring — its exit')
    console.log('      code says nothing, because refusing IS its success path.')
    return 1
  }
  console.log('\nOK: every gated watch has produced a judgement within the last'
    + ` ${MAX_STREAK} runs.`)
  return 0
}

process.exit(process.argv.includes('--self-test') ? selfTest() : live())
