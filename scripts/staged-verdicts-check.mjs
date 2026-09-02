#!/usr/bin/env node
// Every staged-item verdict must prove it can fail.
//
// scripts/verify-staged-items.mjs is the executor field-laboratory registers
// its staged items against, and the one this repo's CC-CMDs cite as their done
// condition. Until 2026-08-23 not one of its four verdicts had ever been
// demonstrated to fail: they ran daily, printed PASS or PENDING, and nothing
// established that a genuine regression would make them say otherwise.
//
// That is not hypothetical here. Four probes in this project were found vacuous
// during August, and all four shared exactly one property — never shown to fail:
//
//   an n=2 "CONFIRMED" reaching an outbox;
//   a 5.4-point gap reported on n=16 that reversed at n=95;
//   a brief-contamination predicate that could never observe a cessation;
//   a staged-claim scanner that found zero claims because it matched an
//   invented convention instead of the observed one.
//
// So this asserts, for each verdict, that a KNOWN-BAD payload does not produce
// PASS. A verdict that passes its own negative control is vacuous, and every
// green it has printed was uninformative.
//
// A MISSING mustFailOn IS ITSELF A FAILURE. Optional would make it the field
// nobody fills in, which is how Rule 89's "specify an artifact" became prose.

import { VERDICTS } from './staged-verdicts.mjs'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

console.log('staged verdicts are falsifiable')

for (const [id, verdict] of Object.entries(VERDICTS)) {
  const has = Object.prototype.hasOwnProperty.call(verdict, 'mustFailOn')
  check(`${id}: declares a negative control`, has,
    'no mustFailOn — this verdict has never been shown to fail, so a PASS proves nothing')
  if (!has) continue
  let out
  try { out = verdict(verdict.mustFailOn) } catch (e) { out = `THREW: ${e.message}` }
  check(`${id}: does not PASS its negative control`,
    typeof out === 'string' && !out.startsWith('PASS'),
    `returned ${JSON.stringify(out)} — a known-bad payload reads as PASS`)
}

// A verdict must also be able to say PASS at all. One that can never pass is
// the mirror defect, and it is the one the brief-contamination predicate had:
// permanently red, so nobody could ever act on it.
const CAN_PASS = {
  closing_after_opening: { rows: 8, sequenced: 8 },
  soccer_opening_coverage: {
    measurable: [{ sport: 'EPL', games: 5, pct: 80, baseline_pct: 23.1 }],
    tooFew: [], regressed: [],
    improved: [{ sport: 'EPL', games: 5, pct: 80, baseline_pct: 23.1 }],
    minGames: 4,
  },
  epl_brief_event_grounded: {
    briefRows: 4, postLeakFix: 4, grounded: 4, historicalLeaks: 0, liveNote: '', leaking: [],
  },
  recap_names_a_scoring_play: { recapRows: 6, testable: 6, named: 6 },
  thread_notes_cleanup: { total: 40, expiredBeyondGrace: 0 },
  d1_write_provenance: { everEntries: 9, controlEntries: 3, dashEntries: 1, windowHours: 48, gameDaysInWindow: 2 },
}
// EVERY REGISTERED VERDICT NEEDS A CLEAN PAYLOAD, not just the ones someone
// remembered. This loop iterated CAN_PASS rather than VERDICTS, so a verdict
// added without an entry here was silently exempt from the one check that says
// it can ever go green — the same shape as a `mustFailOn` nobody wrote, which
// the block above already refuses to allow.
for (const id of Object.keys(VERDICTS))
  check(`${id}: declares a clean payload`, Object.prototype.hasOwnProperty.call(CAN_PASS, id),
    'without one, "can this verdict ever say PASS" is never asked of it')
for (const [id, payload] of Object.entries(CAN_PASS)) {
  const out = VERDICTS[id](payload)
  check(`${id}: CAN reach PASS on a clean payload`, String(out).startsWith('PASS'),
    `returned ${JSON.stringify(out)} — a verdict that can never pass is permanently red and gets ignored`)
}

console.log(fail ? `\n${fail} failed` : `\n${pass} passed`)
process.exit(fail ? 1 : 0)
