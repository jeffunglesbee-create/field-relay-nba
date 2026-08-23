#!/usr/bin/env node
// The stale-data sentinel must fail a source that is fresh and empty.
//
// On 2026-06-22 FBref started returning HTTP 403 to GitHub Actions runner IPs.
// The workflow parsed 0 squads, wrote {"teams": {}} to R2, uploaded
// successfully and exited 0. /health/sources reported
// `soccer_fbref_wc | ok | stale: False` for two weeks, because the file existed
// and was recent -- the only two things the sentinel asked. Every soccer
// journalism prompt assembled empty context for that fortnight.
//
// The session that root-caused it filed the fix as carry-forward #2: "add
// team/entry count > 0 check for FBref sources." It was never built. The FBref
// sources were retired the next day, which removed the instance and left the
// defect standing over six other sources.
//
// `entries` was already being computed by checkGithubJson and read by nothing.
// This checks the verdict function directly, with the empty case as a negative
// control: the point is not that it says healthy on good data, it is that it
// says stale on the exact input that fooled it for two weeks.

import { readFileSync } from 'node:fs'
import { sourceVerdict, countEntries } from '../src/stale-data-sentinel.js'

const NOW = 1_756_000_000_000          // fixed: a clock in a test is a flake
const H = 3600_000
const fresh = NOW - 1 * H
const old   = NOW - 400 * H

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

console.log('the sentinel fails a source that is fresh and empty')

const WITH_FLOOR = { key: 't', maxAgeHours: 24, minEntries: 1 }
const NO_FLOOR   = { key: 't', maxAgeHours: 24 }

// The control: this is what a working source looks like, so a verdict that
// reds everything cannot pass this file.
const good = sourceVerdict(WITH_FLOOR, { ok: true, updatedMs: fresh, entries: 30 }, NOW)
check('a fresh, populated source is healthy',
  good.stale === false && good.empty === false,
  `got stale=${good.stale} empty=${good.empty} reason=${good.reason}`)

// THE NEGATIVE CONTROL. Byte-for-byte the June-22 input: recent upload,
// successful fetch, zero entries.
const emptyFresh = sourceVerdict(WITH_FLOOR, { ok: true, updatedMs: fresh, entries: 0 }, NOW)
check('a fresh source with zero entries is stale',
  emptyFresh.stale === true && emptyFresh.empty === true,
  'this is the exact shape that reported healthy for two weeks')
check('and it says why',
  /entries 0 < minEntries 1/.test(String(emptyFresh.reason)),
  `reason was ${JSON.stringify(emptyFresh.reason)} — an operator cannot act on that`)

// Unreadable must fail, not pass. A declared invariant that cannot be evaluated
// has not been satisfied; treating it as satisfied is how the fortnight happened.
const unreadable = sourceVerdict(WITH_FLOOR, { ok: true, updatedMs: fresh }, NOW)
check('an unreadable entry count is a failure, not a pass',
  unreadable.stale === true && unreadable.empty === true,
  `got stale=${unreadable.stale} empty=${unreadable.empty}`)

// The floor is opt-in. A source that declares none must be unaffected, or this
// change would red every KV and D1 check that has no entries concept.
const noFloor = sourceVerdict(NO_FLOOR, { ok: true, updatedMs: fresh, entries: 0 }, NOW)
check('a source declaring no minEntries is unaffected',
  noFloor.stale === false && noFloor.empty === false,
  `got stale=${noFloor.stale} empty=${noFloor.empty}`)

// Staleness still works, and reports as staleness rather than emptiness.
const stale = sourceVerdict(WITH_FLOOR, { ok: true, updatedMs: old, entries: 30 }, NOW)
check('an old but populated source is stale, not empty',
  stale.stale === true && stale.empty === false,
  `got stale=${stale.stale} empty=${stale.empty}`)

// countEntries must not answer 0 for a container it failed to find -- 0 and
// "wrong key" are different failures and only one of them is the file's fault.
check('countEntries returns null for a container that is not there',
  countEntries({ teams: { BOS: 1 } }, 'data') === null &&
  countEntries({ teams: { BOS: 1 } }, 'teams') === 1 &&
  countEntries({ data: [1, 2, 3] }, 'data') === 3,
  'a missing container must be unreadable, never zero')

// Registry invariant: opting into a body read without declaring a floor reads
// as protected and is not. Matches the source text because that is where the
// pairing lives -- the container is a positional argument, not a field.
const src = readFileSync('src/stale-data-sentinel.js', 'utf8')
const blocks = src.split(/\n    \{\n/).slice(1)
const unpaired = blocks
  .filter(b => /check(GithubJson|R2)\([^)]*,\s*'[a-z]+'\)/.test(b))
  .filter(b => !/minEntries:/.test(b))
  .map(b => (b.match(/key: '([^']+)'/) || [])[1] || '?')
check('every source that reads a container declares a floor for it',
  unpaired.length === 0,
  `unpaired: ${unpaired.join(', ')}`)

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
