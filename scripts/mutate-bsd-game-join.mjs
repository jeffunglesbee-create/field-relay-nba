// The mutation harness for the BSD game join (Rule 90, MUTATE-FIRST-A). A check that has only ever passed has proven
// nothing: each mutation below breaks one rule of src/bsd-game-join.js, and scripts/check-bsd-game-join.mjs must go red.
//
// THE HARNESS'S OWN HONESTY (Rule 90's corollary): an anchor that is not unique, or that matches nothing, is a
// failure of the harness, printed as such. "NOT CAUGHT" with no mutation applied is worse than no test, so the
// baseline (the unmutated module) must pass first and every mutation must be CONFIRMED applied by a changed text.
//
// Usage:  node scripts/mutate-bsd-game-join.mjs

import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const SRC = 'src/bsd-game-join.js'
const TMP = 'src/.mutant-bsd-game-join.js'
const original = readFileSync(SRC, 'utf8')

const MUTATIONS = [
  { id: 'M1 accept the reversed orientation',
    find: "resolveTeamKey(nameOf(e.home_team)) === h && resolveTeamKey(nameOf(e.away_team)) === a);",
    replace: "(resolveTeamKey(nameOf(e.home_team)) === h && resolveTeamKey(nameOf(e.away_team)) === a) || (resolveTeamKey(nameOf(e.home_team)) === a && resolveTeamKey(nameOf(e.away_team)) === h));" },
  { id: 'M2 take the first of several candidates',
    find: "if (candidates.length > 1) return { bsd_event_id: null, how: 'ambiguous', candidates: candidates.length };",
    replace: "" },
  { id: 'M3 let the kickoff choose when the names find nothing',
    find: "if (candidates.length === 0) return { bsd_event_id: null, how: 'unmatched', candidates: 0 };",
    replace: "if (candidates.length === 0) { const at = (events || []).filter(e => minutesApart(row, e) === 0); if (at.length === 1) return { bsd_event_id: String(at[0].id), how: 'joined', kickoff: 'ok', candidates: 1 }; return { bsd_event_id: null, how: 'unmatched', candidates: 0 }; }" },
  { id: 'M4 delete the kickoff refusal',
    find: "if (gap !== null && gap > BSD_KICKOFF_REFUSE_MINUTES) return { bsd_event_id: null, how: 'refused-kickoff', candidates: 1 };",
    replace: "" },
  { id: 'M5 treat a missing start_time as a refusal',
    find: "if (gap !== null && gap > BSD_KICKOFF_REFUSE_MINUTES) return",
    replace: "if (gap === null || gap > BSD_KICKOFF_REFUSE_MINUTES) return" },
  { id: 'M6 drop the sport guard',
    find: "if (!BSD_SOCCER_SPORTS.includes(row?.sport)) return { bsd_event_id: null, how: 'not-soccer' };",
    replace: "" },
  { id: 'M7 supply only the context date, not the next UTC day',
    find: "return [isoDate, next];",
    replace: "return [isoDate];" },
]

const runCheck = mod => spawnSync('node', ['scripts/check-bsd-game-join.mjs', '--offline', ...(mod ? ['--module', mod] : [])], { encoding: 'utf8' })

let failedHarness = 0, caught = 0
try {
  const base = runCheck(null)
  console.log(`baseline (unmutated): exit ${base.status}`)
  if (base.status !== 0) { console.log('HARNESS FAIL: the unmutated module does not pass the check, so no mutation can be judged'); process.exit(2) }
  for (const m of MUTATIONS) {
    const n = original.split(m.find).length - 1
    if (n !== 1) { console.log(`HARNESS FAIL  ${m.id}: anchor matched ${n} times, wanted exactly 1; NOTHING WAS MUTATED`); failedHarness++; continue }
    const mutated = original.replace(m.find, m.replace)
    if (mutated === original) { console.log(`HARNESS FAIL  ${m.id}: the replacement changed nothing`); failedHarness++; continue }
    writeFileSync(TMP, mutated)
    const r = runCheck(TMP)
    const reds = (r.stdout.match(/^FAIL .*/gm) || []).map(l => l.slice(5, 100))
    if (r.status !== 0) { caught++; console.log(`CAUGHT   ${m.id}  <- ${reds[0] || 'exit ' + r.status}${reds.length > 1 ? ` (+${reds.length - 1} more)` : ''}`) }
    else console.log(`NOT CAUGHT  ${m.id}  (applied, and the check still passed)`)
  }
} finally { rmSync(TMP, { force: true }) }
console.log(`\n${caught} of ${MUTATIONS.length} join mutations caught`)

// ---- the I/O wiring (src/index.js), aimed at scripts/check-bsd-game-join-wiring.mjs through --source ----------------------
const INDEX = 'src/index.js'
const TMPIDX = 'scripts/.mutant-index.js'
const indexOriginal = readFileSync(INDEX, 'utf8')
const WIRING = [
  { id: 'W1 drop the IS NULL scope on the read', find: "bsd_event_id IS NULL AND sport IN", replace: "sport IN" },
  { id: 'W2 write with a bare UPDATE instead of reconcile', find: "const r = await reconcile(env, { target: table, updates, changelog: { source: 'bsd_game_join', label: 'bsd_event_id' } });", replace: "const r = { synced: (await env.ARCHIVE_DB.prepare(`UPDATE ${table} SET bsd_event_id = ? WHERE id = ?`).bind(updates[0].fields.bsd_event_id, updates[0].id).run()).meta.changes };" },
  { id: 'W3 log the change under a source brief-freshness treats as material', find: "changelog: { source: 'bsd_game_join', label: 'bsd_event_id' }", replace: "changelog: { source: 'lineup', label: 'bsd_event_id' }" },
  { id: 'W4 read a non-page as an empty day', find: "if (!Array.isArray(rows)) return null;", replace: "if (!Array.isArray(rows)) return [];" },
  { id: 'W5 remove the upstream page cap', find: "if (budget.upstreamPages >= budget.maxUpstreamPages) return null;", replace: "" },
  { id: 'W6 an unauthenticated admin route', find: "if (!relaySecretMatches(request.headers.get('X-FIELD-Relay'), env))\n                return new Response('Unauthorized', { status: 401, headers: CORS });\n            let body;\n            try { body = await request.json(); }", replace: "let body;\n            try { body = await request.json(); }" },
  { id: 'W7 the cycle hook outside its try/catch', find: "try { await runBsdGameJoinWindow(env, dateKey); }\n    catch (e) { console.error(\"[BSD-GAME-JOIN] window failed:\", e.message); /* a lineup id is an enrichment, not a requirement */ }", replace: "await runBsdGameJoinWindow(env, dateKey);" },
  { id: 'W8 a failed date retried every tick (no failure marker)', find: "else await env.FIELD_JOURNALISM.put(failKey, String(result.reason || 'failed'), { expirationTtl: 3600 });", replace: "" },
  { id: 'W9 an unparseable body swallowed as null (a bare catch)', find: "try { body = await request.json(); }\n            catch (e) {\n                return new Response(JSON.stringify({ ok: false, error: `body is not JSON: ${e.message}` }),\n                    { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });\n            }", replace: "body = await request.json().catch(() => null);" },
]
const runWiring = srcPath => spawnSync('node', ['scripts/check-bsd-game-join-wiring.mjs', ...(srcPath ? ['--source', srcPath] : [])], { encoding: 'utf8' })
let wiringCaught = 0
try {
  const base2 = runWiring(null)
  console.log(`\nwiring baseline (unmutated): exit ${base2.status}`)
  if (base2.status !== 0) { console.log('HARNESS FAIL: the unmutated wiring does not pass its check'); process.exit(2) }
  for (const m of WIRING) {
    const find = m.find.replace(/\\n/g, '\n')
    const n = indexOriginal.split(find).length - 1
    if (n !== 1) { console.log(`HARNESS FAIL  ${m.id}: anchor matched ${n} times, wanted exactly 1; NOTHING WAS MUTATED`); failedHarness++; continue }
    const mutated = indexOriginal.replace(find, m.replace)
    if (mutated === indexOriginal) { console.log(`HARNESS FAIL  ${m.id}: the replacement changed nothing`); failedHarness++; continue }
    writeFileSync(TMPIDX, mutated)
    const r = runWiring(TMPIDX)
    const reds = (r.stdout.match(/^FAIL .*/gm) || []).map(l => l.slice(5, 100))
    if (r.status !== 0) { wiringCaught++; console.log(`CAUGHT   ${m.id}  <- ${reds[0] || 'exit ' + r.status}`) }
    else console.log(`NOT CAUGHT  ${m.id}  (applied, and the check still passed)`)
  }
} finally { rmSync(TMPIDX, { force: true }) }
console.log(`\n${wiringCaught} of ${WIRING.length} wiring mutations caught`)
process.exit(caught === MUTATIONS.length && wiringCaught === WIRING.length && !failedHarness ? 0 : 1)
