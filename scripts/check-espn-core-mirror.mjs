#!/usr/bin/env node
// The ESPN core API mirror (src/espn-core-mirror.js; docs/CC-CMD-2026-10-14-espn-host-flip.md Task 3).
//
// Holds, against the source and against raw bodies a runner read (outbox/espn-core-fixtures/, written by
// scripts/espn-core-runner-probe.mjs on 2026-11-19, byte for byte):
//   * no read site in src/index.js fetches the core API any more (it answers 403 to the Worker);
//     the five read sites read the mirror instead
//   * the runner and the relay build the SAME key for the same resource, for all four kinds
//   * trimming keeps every value a reader uses: each stat's name, value and displayValue; each eventlog
//     item's refs and `played`; an athlete's position
//   * a missing mirror row is said ("not mirrored"), never an empty answer
//   * the runner is dispatched from the relay's */15 tick and has no GitHub schedule of its own
//
//   node scripts/check-espn-core-mirror.mjs              run the check
//   node scripts/check-espn-core-mirror.mjs --self-test  each mutant must turn a check red (Rule 90)

import { readFileSync } from 'node:fs'
import * as M from '../src/espn-core-mirror.js'
import { soccerLeaguesFrom } from './espn-core-mirror.mjs'

const fx = name => JSON.parse(readFileSync(`outbox/espn-core-fixtures/${name}.json`, 'utf8'))
const flat = b => [...(b?.splits?.categories || []).flatMap(c => c.stats || []), ...(b?.stats || [])]
  .map(s => `${s.name}|${s.value ?? null}|${s.displayValue ?? null}`)

// A template literal from a source file, evaluated with the given names: the URL each side really builds.
function template(src, anchor, vars) {
  const i = src.indexOf(anchor)
  if (i < 0 || src.indexOf(anchor, i + 1) >= 0) throw new Error(`template anchor missing or not unique: ${anchor}`)
  const tpl = src.slice(i + anchor.length).match(/^\s*`([^`]+)`/)
  if (!tpl) throw new Error(`no template literal after: ${anchor}`)
  return new Function(...Object.keys(vars), `return \`${tpl[1]}\``)(...Object.values(vars))
}

function run(D) {
  const results = []
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
  const { src, runner, wf } = D

  // 1. No core fetch left in the relay.
  const coreFetch = [...src.matchAll(/fetch\(\s*[^;]{0,240}?(sports\.core\.api\.espn\.com|\$\{compBase\}|\$\{CORE\})/g)].map(m => src.slice(0, m.index).split('\n').length)
  check('no read site in src/index.js fetches the core API (403 to the Worker)', coreFetch.length === 0, `fetch of a core URL at line(s) ${coreFetch.join(', ')}`)
  const hostLines = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('sports.core.api.espn.com') && !/^\s*\/\//.test(l)).map(([n]) => n)
  check('no code line in src/index.js names the core host (the provenance stamp would claim a fetch)', hostLines.length === 0, `line(s) ${hostLines.join(', ')}`)
  const body = (start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a + 1); return a >= 0 && b > a ? src.slice(a, b) : '' }
  const sites = {
    'golf competitor stats': body('async function handleGolfCompetitorStats(', '\nasync function '),
    'golf eventlog': body('async function handleGolfEventlog(', '\nasync function '),
    'soccer xg': body("if (pathname === '/soccer/xg') {", "if (pathname === '/soccer/sub-impact') {"),
    'soccer sub-impact': body("if (pathname === '/soccer/sub-impact') {", '/soccer-fbref/'),
  }
  for (const [name, b] of Object.entries(sites)) {
    check(`${name} reads the mirror`, b.includes('readCoreMirror(env,'), 'no readCoreMirror call in its body')
    // Any fetch left in a read site goes to the site API (ESPN_API_BASE, which the Worker reaches),
    // never to a variable or host that could be the core API.
    const others = [...b.matchAll(/\bfetch\(\s*([^,)]{0,60})/g)].map(m => m[1].trim()).filter(a => !a.startsWith('`${ESPN_API_BASE}/'))
    check(`${name} fetches nothing but the site API`, others.length === 0, `other fetch target(s): ${others.join(' ; ')}`)
  }
  check('the xg answer says when each side was mirrored (`_mirror`)', sites['soccer xg'].includes('_mirror: {'), '`_mirror` is gone from the payload')
  check('the sub-impact answer counts positions it could not read', /positionsUnresolved,\s*\n\s*_source/.test(sites['soccer sub-impact']), '`positionsUnresolved` is not in the payload')
  check('/d1/execute allows the mirror table', /CORE_MIRROR_TABLE\];\s*\n\s*const tableName = sql\.match/.test(src), 'CORE_MIRROR_TABLE is not the last ALLOWED_TABLES entry')

  // 2. The runner and the relay key the same resource the same way.
  const v = { eventId: '401850980', athleteId: '11183', season: '2026', encodeURIComponent }
  const g = { id: '401850980' }, c = { id: '11183' }
  const pairs = [
    ['golf-competitor-stats',
      M.coreUrlOf(template(sites['golf competitor stats'], 'const path = ', { ...v })),
      template(runner, 'const statUrl = c => ', { CORE: 'https://sports.core.api.espn.com/v2/sports', ev: g, c })],
    ['golf-eventlog',
      M.coreUrlOf(template(sites['golf eventlog'], 'const path = ', { ...v })),
      template(runner, 'const logs = season ? comps.map(c => ', { CORE: 'https://sports.core.api.espn.com/v2/sports', season: '2026', c })],
    ['soccer-team-stats',
      M.coreUrlOf(template(sites['soccer xg'], "const compPath = ", { league: 'eng.1', eventId: '401879244' }) + '/competitors/331/statistics'),
      template(runner, 'const teamUrl = (g, c) => ', { CORE: 'https://sports.core.api.espn.com/v2/sports', g: { lg: 'eng.1', ev: { id: '401879244' } }, c: { id: '331' } })],
    ['soccer-athlete',
      M.coreUrlOf(template(sites['soccer sub-impact'], 'const m = await readCoreMirror(env,\n                    ', { league: 'eng.1', athleteId: '342029' })),
      template(runner, 'if (on) athleteUrls.push(', { CORE: 'https://sports.core.api.espn.com/v2/sports', g: { lg: 'eng.1' }, on: '342029' })],
  ]
  for (const [kind, relayUrl, runnerUrl] of pairs) {
    const rk = D.key(relayUrl), wk = D.key(runnerUrl)
    check(`${kind}: the relay and the runner build one key, of this kind`, rk === wk && D.kind(relayUrl) === kind && D.kind(runnerUrl) === kind,
      `relay ${relayUrl} -> ${rk} (${D.kind(relayUrl)}); runner ${runnerUrl} -> ${wk} (${D.kind(runnerUrl)})`)
  }

  const norm = D.key('http://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/athletes/342029/?lang=en&region=us')
  check('the key is https, without query string or trailing slash (ESPN $refs carry ?lang=en&region=us)',
    norm === 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/athletes/342029', norm)

  // 3. Trimming keeps what the readers use, on the raw bodies a runner read.
  const gs = fx('golf-competitor-stats').body, ts = D.trim('golf-competitor-stats', gs)
  check('golf stats: every stat kept with name, value and displayValue', JSON.stringify(flat(ts)) === JSON.stringify(flat(gs)) && flat(gs).length >= 20, `${flat(ts).length} of ${flat(gs).length}`)
  const picked = Object.fromEntries(flat(ts).map(s => s.split('|')).map(([n, val]) => [n, val]))
  check('golf stats: the Austin winner reads -17 to par, 299.2 yards, 75 greens', picked.scoreToPar === '-17' && picked.driveDistAvg === '299.2' && picked.gir === '75', JSON.stringify({ scoreToPar: picked.scoreToPar, driveDistAvg: picked.driveDistAvg, gir: picked.gir }))
  for (const side of ['home', 'away']) {
    const raw = fx(`soccer-team-stats-${side}`).body, t = D.trim('soccer-team-stats', raw)
    const xg = flat(t).find(s => s.startsWith('expectedGoals|'))
    check(`soccer ${side}: every stat kept, xG present, body at most a third of raw`,
      JSON.stringify(flat(t)) === JSON.stringify(flat(raw)) && xg && JSON.stringify(t).length * 3 < JSON.stringify(raw).length,
      `${flat(t).length} of ${flat(raw).length} stats, ${JSON.stringify(t).length} of ${JSON.stringify(raw).length} bytes, xG ${xg}`)
  }
  const el = fx('golf-eventlog').body, tel = D.trim('golf-eventlog', el)
  const refs = b => (b.events?.items || b.items || []).map(i => [i.event?.$ref, i.competition?.$ref, i.competitor?.$ref, i.statistics?.$ref, i.played ?? null].join('|'))
  check('golf eventlog: every item keeps its four refs and `played`', JSON.stringify(refs(tel)) === JSON.stringify(refs(el)) && refs(el).length > 0, `${refs(tel).length} of ${refs(el).length}`)
  const at = fx('soccer-athlete').body
  check('soccer athlete: the position abbreviation is kept', D.trim('soccer-athlete', at)?.position?.abbreviation === at.position?.abbreviation && !!at.position?.abbreviation, JSON.stringify(D.trim('soccer-athlete', at)))

  // 4. A missing row is said.
  return { results, check, pending: (async () => {
    const none = await D.read({ ARCHIVE_DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } }, 'golf/leagues/pga/events/1/competitions/1/competitors/1/statistics/0')
    check('a missing mirror row reads as "not mirrored", with no body', none.body === null && none.error === 'not mirrored', JSON.stringify(none))
    const broken = await D.read({ ARCHIVE_DB: { prepare: () => { throw new Error('no such table') } } }, 'golf/leagues/pga/events/1/competitions/1/competitors/1/statistics/0')
    check('a failed mirror read says so', broken.body === null && /mirror read failed/.test(broken.error || ''), JSON.stringify(broken))

    // 5. The dispatch.
    const tick = body("if (_journalismShouldFire) {", '\n        }')
    check('the */15 tick dispatches the runner', tick.includes('dispatchEspnCoreMirror(env)'), 'no dispatch inside the */15 block')
    check('the dispatch posts to espn-core-mirror.yml', /async function dispatchEspnCoreMirror[\s\S]{0,700}actions\/workflows\/espn-core-mirror\.yml\/dispatches/.test(src), 'wrong or missing workflow')
    check('the workflow has no GitHub schedule (it fires hours late here)', !/^\s*schedule:/m.test(wf) && /workflow_dispatch:/.test(wf), 'a schedule: block is present')
    const lg = D.leagues(src)
    check('the runner mirrors the relay\'s soccer leagues (18 or more, MLS, EPL, UCL and the World Cup among them)',
      lg.length >= 18 && ['usa.1', 'eng.1', 'uefa.champions', 'fifa.world'].every(x => lg.includes(x)), `${lg.length}: ${lg.join(', ')}`)
  })() }
}

async function evaluate(D) { const r = run(D); await r.pending; return r.results }
const print = results => {
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      → ${r.detail}`}`)
  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  return passed === results.length
}

const base = {
  src: readFileSync('src/index.js', 'utf8'), runner: readFileSync('scripts/espn-core-mirror.mjs', 'utf8'),
  wf: readFileSync('.github/workflows/espn-core-mirror.yml', 'utf8'),
  key: M.coreMirrorKey, kind: M.coreMirrorKind, trim: M.trimCoreBody, read: M.readCoreMirror, leagues: soccerLeaguesFrom,
}
const swap = (field, a, b) => { if (base[field].split(a).length !== 2) throw new Error(`mutation anchor not unique in ${field}: ${a.slice(0, 60)}`); return { ...base, [field]: base[field].replace(a, b) } }

if (process.argv.includes('--self-test')) {
  const mutants = {
    'a core fetch put back in golf stats': swap('src', 'const mirror = await readCoreMirror(env, path);\n    if (!mirror.body) return { ok: false, error: mirror.error, eventId, athleteId };',
      'const mirror = await readCoreMirror(env, path); await fetch(path);\n    if (!mirror.body) return { ok: false, error: mirror.error, eventId, athleteId };'),
    'the core host written back into a read site': swap('src', '`soccer/leagues/${league}/athletes/${athleteId}`);', '`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${league}/athletes/${athleteId}`);'),
    'the key keeps the query string': { ...base, key: u => String(u).replace(/^http:/, 'https:') },
    'trim drops displayValue': { ...base, trim: (k, b) => { const t = M.trimCoreBody(k, b); for (const c of t?.splits?.categories || []) for (const s of c.stats) delete s.displayValue; return t } },
    'trim keeps no eventlog played flag': { ...base, trim: (k, b) => { const t = M.trimCoreBody(k, b); for (const i of t?.events?.items || []) delete i.played; return t } },
    'a missing row reads as an empty body': { ...base, read: async (env, u) => { const r = await M.readCoreMirror(env, u); return r.error === 'not mirrored' ? { body: {}, fetchedAt: null, error: null } : r } },
    'the xg `_mirror` field removed': swap('src', '                _mirror: {\n', '                _mirrorGone: {\n'),
    'the dispatch removed from the */15 tick': swap('src', '            ctx.waitUntil(dispatchEspnCoreMirror(env).catch(e =>', '            ctx.waitUntil(Promise.resolve().catch(e =>'),
    'a GitHub schedule added': { ...base, wf: base.wf.replace('on:\n  workflow_dispatch:', "on:\n  schedule:\n    - cron: '*/10 * * * *'\n  workflow_dispatch:") },
    'the runner keys athletes by team': swap('runner', '`${CORE}/soccer/leagues/${g.lg}/athletes/${on}`', '`${CORE}/soccer/leagues/${g.lg}/teams/${on}`'),
    'the mirror table not allowed': swap('src', '                CORE_MIRROR_TABLE];', "                'espn_core_mirror_x'];"),
  }
  let survived = 0
  for (const [name, D] of Object.entries(mutants)) {
    let red
    try { red = (await evaluate(D)).filter(r => !r.ok).length } catch (e) { red = `threw: ${e.message.slice(0, 80)}` }
    const caught = typeof red === 'string' || red > 0
    console.log(`${caught ? 'CAUGHT' : 'SURVIVED'}  ${name} (${red}${typeof red === 'number' ? ' red' : ''})`)
    if (!caught) survived++
  }
  const clean = (await evaluate(base)).every(r => r.ok)
  console.log(`\nself-test: ${Object.keys(mutants).length - survived}/${Object.keys(mutants).length} mutants caught; clean run ${clean ? 'green' : 'RED'}`)
  process.exit(survived === 0 && clean ? 0 : 1)
}
process.exit(print(await evaluate(base)) ? 0 : 1)
