#!/usr/bin/env node
// Every Courier /secret sync must carry a shell variable, never a literal.
//
// The Courier (workers/field-deploy) writes a named GitHub Actions secret into
// a named repo, authenticated by OIDC. deploy.yml uses it four times. The value
// it sends is a shell expansion of `${{ secrets.X }}`, which is the whole point:
// the credential passes through the runner's memory and lands in no file.
//
// The regression this guards is small and tempting. RELAY_SHARED_SECRET is not
// set in this repository yet, so its sync step exits 1 with a message saying so.
// The one-line "fix" for that red step is to paste the value in place of the
// variable -- which would put the credential back into a committed workflow, in
// a repo where it already appears 27 times in src/index.js, days after
// field-laboratory's check:secrets failed for exactly that and was fixed.
//
// It also fails if the RELAY_SHARED_SECRET sync disappears: deleting the step is
// the other way to make a red step green, and field-laboratory's
// check:sport-vocabulary goes permanently blind if it does.
//
// --self-test mutates this workflow in memory and requires the check to go red.
// A regex over a 1,100-line YAML file proves nothing until it has been shown to
// fail on the thing it names.

import { readFileSync } from 'node:fs'

const WF = '.github/workflows/deploy.yml'
const COURIER = 'field-deploy.jeffunglesbee.workers.dev/secret'

/**
 * Every Courier sync in the file, as { name, repo, value }. `value` is the raw
 * text between the escaped quotes -- a shell expansion begins with `$`.
 */
export const syncs = (yaml) => {
  const out = []
  const re = /\\"repo\\":\\"([^"\\]+)\\",\\"name\\":\\"([^"\\]+)\\",\\"value\\":\\"([^"\\]*)\\"/g
  let m
  while ((m = re.exec(yaml)) !== null) out.push({ repo: m[1], name: m[2], value: m[3] })
  return out
}

export const verdict = (list) => {
  const literal = list.filter(s => !s.value.startsWith('$'))
  const relay = list.filter(s => s.name === 'RELAY_SHARED_SECRET' && s.repo === 'field-laboratory')
  return { literal, hasRelaySync: relay.length > 0, total: list.length }
}

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

const yaml = readFileSync(WF, 'utf8')

if (process.argv.includes('--self-test')) {
  console.log('self-test: the check rejects its own negative controls')

  // 1. A literal pasted in place of the variable.
  const pasted = yaml.replace('\\"value\\":\\"$RELAY_SECRET\\"', '\\"value\\":\\"some-literal-value\\"')
  const a = verdict(syncs(pasted))
  check('a pasted literal is caught',
    pasted !== yaml && a.literal.length === 1 && a.literal[0].name === 'RELAY_SHARED_SECRET',
    `mutation changed nothing, or the check did not see it: ${JSON.stringify(a.literal)}`)

  // 2. The step deleted outright.
  const dropped = yaml.replace(/\\"repo\\":\\"field-laboratory\\",\\"name\\":\\"RELAY_SHARED_SECRET\\"[^\n]*/, '')
  const b = verdict(syncs(dropped))
  check('a deleted RELAY_SHARED_SECRET sync is caught',
    dropped !== yaml && b.hasRelaySync === false,
    'removing the step is the other way to turn a red step green')

  // 3. Control: the real file must pass, or a check that reds everything would
  //    satisfy 1 and 2 while saying nothing.
  const c = verdict(syncs(yaml))
  check('the real workflow passes',
    c.literal.length === 0 && c.hasRelaySync === true,
    `literals=${JSON.stringify(c.literal)} relaySync=${c.hasRelaySync}`)
  check('and it found the syncs at all',
    c.total >= 4, `parsed ${c.total} Courier sync(s) — the pattern stopped matching`)
} else {
  console.log('Courier secret syncs carry variables, not values')
  const v = verdict(syncs(yaml))
  check(`${v.total} sync(s) parsed`, v.total >= 4,
    'the pattern stopped matching — a sync could be unchecked')
  check('no sync sends a literal', v.literal.length === 0,
    v.literal.map(s => `${s.name} → ${s.repo} sends a literal`).join('\n       '))
  check('RELAY_SHARED_SECRET still syncs to field-laboratory', v.hasRelaySync,
    'without it check:sport-vocabulary there is permanently blind')
  if (!yaml.includes(COURIER)) { fail++; console.log('  FAIL the Courier endpoint is gone from this workflow') }
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
