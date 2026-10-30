#!/usr/bin/env node
// Rule 90 for the D1-overload half of the pairing watch, and (P8-P11) for the
// interval degrade line's cross-day handling.
//
// Every mutation here is a way for a database that is failing the odds guard to
// read as healthy. P1 and P2 are the two that already happened once, on
// 2026-10-11, in a probe rather than a watch: `?? 0` turned an unreadable
// counter into "0 events", and reading one level above the field turned
// NOT-REPORTED into the same zero. P4 is the quiet one — counting only the
// daily path reports half the overloads and still looks like a working check.
//
// Each asserts its anchor is unique and applied before reporting; NOT CAUGHT
// with nothing mutated is worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WATCH = 'scripts/watch-odds-pairing-rate.mjs';
const SELF  = [WATCH, '--self-test'];

if (spawnSync('git', ['diff', '--quiet', '--', WATCH]).status !== 0) {
  console.log(`FAIL — ${WATCH} has unstaged changes; restore would lose them.`);
  process.exit(1);
}
if (spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0) {
  console.log(`FAIL — ${WATCH} --self-test is already red on clean source.`);
  process.exit(1);
}
console.log(`baseline: ${WATCH} --self-test passes on clean source\n`);

// THE FILE IS MUTATED IN PLACE, so it is restored on every way out: a normal
// exit, an exception, and Ctrl-C / SIGTERM (which skip 'exit' handlers unless
// they call process.exit themselves). The dirty-file refusal above is the net
// under this one, not the mechanism.
const PRISTINE = fs.readFileSync(WATCH, 'utf8');
process.on('exit', () => { if (fs.readFileSync(WATCH, 'utf8') !== PRISTINE) fs.writeFileSync(WATCH, PRISTINE); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const MUTATIONS = [
  { name: 'R1 a stamped day reads as no refusal',
    anchor: "  if (day.ceiling_reached_at) return { state: 'day-ceiling', at: day.ceiling_reached_at };",
    replace: "  if (false) return { state: 'day-ceiling', at: day.ceiling_reached_at };" },
  { name: 'R2 a missing ceiling_reached_at reads as a clean day',
    anchor: "  if (!has('ceiling_reached_at') || !has('month_limit_reached_at') || typeof day.date !== 'string') return { state: 'not-reported' };",
    replace: "  if (!has('month_limit_reached_at') || typeof day.date !== 'string') return { state: 'not-reported' };" },
  { name: 'R3 a missing month_limit_reached_at reads as a clean day (a relay before fix 3 B)',
    anchor: "  if (!has('ceiling_reached_at') || !has('month_limit_reached_at') || typeof day.date !== 'string') return { state: 'not-reported' };",
    replace: "  if (!has('ceiling_reached_at') || typeof day.date !== 'string') return { state: 'not-reported' };" },
  { name: 'R4 a missing date lets the month stamp be judged against nothing',
    anchor: "  if (!has('ceiling_reached_at') || !has('month_limit_reached_at') || typeof day.date !== 'string') return { state: 'not-reported' };",
    replace: "  if (!has('ceiling_reached_at') || !has('month_limit_reached_at')) return { state: 'not-reported' };" },
  { name: 'R5 the month stamp is ignored (the headroom-only watch of 35d61ec, at its worst)',
    anchor: "  if (typeof m === 'string' && m.slice(0, 10) <= day.date) return { state: 'month-limit', at: m };",
    replace: "  if (false) return { state: 'month-limit', at: m };" },
  { name: 'R6 a month stamp from after the closed day counts against it',
    anchor: "  if (typeof m === 'string' && m.slice(0, 10) <= day.date) return { state: 'month-limit', at: m };",
    replace: "  if (typeof m === 'string') return { state: 'month-limit', at: m };" },
  { name: 'R7 a month stamp with no hour reads as no refusal',
    anchor: "  if (m === true) return { state: 'month-limit', at: null };",
    replace: "  if (false) return { state: 'month-limit', at: null };" },
  { name: 'R8 a stamp the relay could not read counts as no refusal',
    anchor: "  if (Array.isArray(day.stamps_unreadable) && day.stamps_unreadable.length) return { state: 'not-reported', unreadable: day.stamps_unreadable };\n",
    replace: "" },
  { name: 'R9 an unreadable stamp overrides a refusal that was read',
    anchor: "  if (day.ceiling_reached_at) return { state: 'day-ceiling', at: day.ceiling_reached_at };",
    replace: "  if (Array.isArray(day.stamps_unreadable) && day.stamps_unreadable.length) return { state: 'not-reported' };\n  if (day.ceiling_reached_at) return { state: 'day-ceiling', at: day.ceiling_reached_at };" },
  { name: 'R10 a month stamp dated after the day ends the verdict before the unread check',
    anchor: "  if (typeof m === 'string' && m.slice(0, 10) <= day.date) return { state: 'month-limit', at: m };",
    replace: "  if (typeof m === 'string' && m.slice(0, 10) <= day.date) return { state: 'month-limit', at: m };\n  if (typeof m === 'string') return { state: 'none' };" },
  { name: 'R11 the unread check runs before the month limit',
    anchor: "  // `true` is a stamp without an hour: reached, when unknown, so it counts.",
    replace: "  if (Array.isArray(day.stamps_unreadable) && day.stamps_unreadable.length) return { state: 'not-reported' };\n  // `true` is a stamp without an hour: reached, when unknown, so it counts." },
  // 2026-10-28: the per-site caps' stamp. A site refusal is the third way the guard
  // turns a call away, and each of these reads it as nothing.
  { name: 'R12 a site refusal reads as no refusal',
    anchor: "  if (hit.length) {",
    replace: "  if (false) {" },
  { name: 'R13 a missing site_ceiling_reached_at reads as a clean day (a relay before the caps)',
    anchor: "  if (!sites || typeof sites !== 'object' || Array.isArray(sites)) return { state: 'not-reported', missing: 'site_ceiling_reached_at' };",
    replace: "  if (!sites) return { state: 'none' };" },
  { name: 'R14 an array is accepted as the object of site stamps',
    anchor: "typeof sites !== 'object' || Array.isArray(sites)",
    replace: "typeof sites !== 'object'" },
  { name: 'R15 a site stamp with no hour reads as no refusal',
    anchor: "  const hit = Object.entries(sites).filter(([, v]) => v);",
    replace: "  const hit = Object.entries(sites).filter(([, v]) => typeof v === 'string');" },
  { name: 'R16 an unreadable site stamp overrides a site refusal that was read',
    anchor: "  const hit = Object.entries(sites).filter(([, v]) => v);",
    replace: "  if (Array.isArray(day.stamps_unreadable) && day.stamps_unreadable.length) return { state: 'not-reported' };\n  const hit = Object.entries(sites).filter(([, v]) => v);" },
  { name: 'R17 a site refusal is named before the month limit',
    anchor: "  // `true` is a stamp without an hour: reached, when unknown, so it counts.",
    replace: "  if (day.site_ceiling_reached_at && Object.values(day.site_ceiling_reached_at).some(Boolean)) return { state: 'site-ceiling', at: null, sites: [] };\n  // `true` is a stamp without an hour: reached, when unknown, so it counts." },

  { name: 'R18 the site refusal reports its LATEST hour, not its earliest',
    anchor: "return { state: 'site-ceiling', at: hours.length ? hours[0] : null, sites: named };",
    replace: "return { state: 'site-ceiling', at: hours.length ? hours[hours.length - 1] : null, sites: named };" },
  { name: 'R19 every refused site is given the first site\'s hour',
    anchor: "const named = hit.map(([k, v]) => ({ site: k, at: typeof v === 'string' ? v : null }))",
    replace: "const named = hit.map(([k]) => ({ site: k, at: hours.length ? hours[0] : null }))" },
  { name: 'R20 a site with no hour is dropped from the list',
    anchor: "const named = hit.map(([k, v]) => ({ site: k, at: typeof v === 'string' ? v : null }))",
    replace: "const named = hit.filter(([, v]) => typeof v === 'string').map(([k, v]) => ({ site: k, at: v }))" },
  { name: 'P1 a field missing from the response reads as zero',
    anchor: "  if (block === undefined) return { state: 'not-reported', overloads: null };",
    replace: "  if (block === undefined) return { state: 'none', overloads: 0 };",
    catches: 'the wrong-nesting failure of 2026-10-11, inside the watch: the field is not where we look, and that reads as a clean day' },

  { name: 'P2 an unreadable counter reads as zero (the ?? 0 defect)',
    anchor: "    return { state: 'unreadable', overloads: null };\n  }\n  const events = Number(block.events);",
    replace: "    return { state: 'none', overloads: 0 };\n  }\n  const events = Number(block.events);",
    catches: 'the route returns null when the KV read failed; treating it as zero is exactly the coercion that hid the counter once' },

  { name: 'P3 events with no reasons read as zero overloads',
    anchor: "    return { state: 'unattributed', overloads: null, events };",
    replace: "    return { state: 'none', overloads: 0, events };",
    catches: 'every sample before 2026-10-09T00:44Z looked like this — reading it as zero manufactures a 22-day clean baseline' },

  { name: 'P4 only the daily path is counted',
    anchor: "    if (k.includes(D1_OVERLOAD_MARK)) overloads += n;",
    replace: "    if (k.startsWith('daily:') && k.includes(D1_OVERLOAD_MARK)) overloads += n;",
    catches: 'reports 77 of 155 on 2026-10-11 — half the failures, from a check that still looks like it works' },

  // 2026-10-18: one batch, one catch, one `charge:` prefix. P12 and P13 are the
  // two ways the watch could keep reading the old shape and go quietly blind.
  { name: 'P12 the batch-shape mark goes back to the old two-of-three message',
    anchor: "export const MONTH_BATCH_MARK   = /odds budget batch returned \\d+ result\\(s\\), expected \\d+/;",
    replace: "export const MONTH_BATCH_MARK   = /odds budget batch returned 2 result\\(s\\), expected 3/;",
    catches: 'a shape mismatch in the five-statement batch reads 0 for good — the 10-09 incident class, unseen' },

  { name: 'P13 only the old per-batch prefixes are counted',
    anchor: "    if (k.includes(D1_OVERLOAD_MARK)) overloads += n;",
    replace: "    if ((k.startsWith('daily:') || k.startsWith('month:')) && k.includes(D1_OVERLOAD_MARK)) overloads += n;",
    catches: 'every overload after the cutover is keyed charge:, so the watch would report none while D1 failed' },

  { name: 'P5 the budget becomes inclusive',
    anchor: "  return { state: pathBlind > budget ? 'over' : 'within', ...base };",
    replace: "  return { state: pathBlind >= budget ? 'over' : 'within', ...base };",
    catches: 'the day the budget was set on would fail its own calibration' },

  { name: 'P14 a one-batch overload counts once against a two-path budget',
    anchor: "(k.startsWith('daily:') || k.startsWith('month:')) ? n : 2 * n;",
    replace: "n;",
    catches: 'the budget silently doubles in calls at the cutover' },

  { name: 'P15 the weight is keyed on the new prefix instead of the frozen legacy ones',
    anchor: "pathBlind += (k.startsWith('daily:') || k.startsWith('month:')) ? n : 2 * n;",
    replace: "pathBlind += k.startsWith('charge:') ? 2 * n : n;",
    catches: 'a renamed one-batch prefix would count once, halving the budget unit: the failure the comment says the design prevents' },

  { name: 'P6 the overflow bucket is dropped',
    anchor: "    if (k === DEGRADE_OTHER_KEY) overflow += n;",
    replace: "",
    catches: 'overloads past the 8-reason cap land in the overflow bucket and would vanish' },

  { name: 'P7 a null events field reads as zero',
    anchor: "  if (block.events === null || block.events === undefined || !Number.isFinite(events)) {",
    replace: "  if (!Number.isFinite(events)) {",
    catches: 'Number(null) is 0, so a block with events:null would read as a real, read, empty day' },

  // degradeVerdict — docs/CC-CMD-2026-10-12-pairing-degrade-cross-day.md. P8 is
  // the defect itself: the sign-only check that printed "explains — 3297" from
  // one day's counter minus the previous day's.
  { name: 'P8 the date check reverts to the sign',
    anchor: "  if (prevDegraded === undefined || prevDate === currDate) {",
    replace: "  if (true) {",
    catches: 'the real 10-10 -> 10-11 pair would read explains again, from a cross-day subtraction' },

  { name: 'P9 a negative escape reads as explained',
    anchor: "  if (!(escaped > 0)) return { state: 'no-escape', credits: delta, parts };",
    replace: "",
    catches: 'every degrade "explains" a ledger that charged MORE than the vendor billed' },

  { name: 'P10 the previous day\'s close is ignored',
    anchor: "    delta = (close - was) + now;",
    replace: "    delta = now;",
    catches: 'the interval loses everything between the last reading and midnight: 146 on 10-11 -> 10-12 reads 0' },

  { name: 'P11 two midnights are bridged with one close',
    anchor: "  } else if (nextUtcDate(prevDate) === currDate) {",
    replace: "  } else if (prevDate < currDate) {",
    catches: 'a missed day would be reconstructed from the wrong close' },

  // byHourVerdict — docs/CC-CMD-2026-10-12-degrade-reasons-by-hour.md. Informational, so every mutation here is a way
  // for the hour map to say more, or less, than the counter supports.
  { name: 'B1 a missing hour map reads as none',
    anchor: "  if (block === undefined) return { state: 'not-reported' };\n  if (block === null || typeof block !== 'object' || Array.isArray(block)) return { state: 'unreadable' };\n  const events = Number(block.events);",
    replace: "  if (block === undefined) return { state: 'none', events: 0, covered: 0, hours: [] };\n  if (block === null || typeof block !== 'object' || Array.isArray(block)) return { state: 'unreadable' };\n  const events = Number(block.events);",
    catches: 'a relay that does not report the field would read as a day with no degrades' },
  { name: 'B2 a record with events but no by_hour reads as reported',
    anchor: "  if (!by || typeof by !== 'object' || Array.isArray(by)) return { state: 'not-reported', events, covered: 0, hours: [] };",
    replace: "  if (!by || typeof by !== 'object' || Array.isArray(by)) return { state: 'reported', events, covered: events, hours: [] };",
    catches: 'the 2026-10-29 record, and every record before the deploy, would claim an hour breakdown it does not have' },
  { name: 'B3 the coverage test is dropped, so a partial map reads as complete',
    anchor: "  return { state: covered < events ? 'partial' : 'reported', events, covered, hours };",
    replace: "  return { state: 'reported', events, covered, hours };",
    catches: 'the day of the deploy would show one event in one hour as the whole day (Rule 91: the denominator is the point)' },
  { name: 'B4 a map claiming more events than the counter is accepted',
    anchor: "  if (covered > events) return { state: 'inconsistent', events, covered, hours };\n",
    replace: "",
    catches: 'a corrupt map would be reported as the truth' },
  { name: 'B5 the hours are left in enumeration order',
    anchor: ".filter((h) => /^(?:[01]\\d|2[0-3])$/.test(h)).sort()",
    replace: ".filter((h) => /^(?:[01]\\d|2[0-3])$/.test(h))",
    catches: "'14' prints before '09': the afternoon peak reads as the morning" },
  { name: 'B6 a malformed hour key is accepted as a bucket',
    anchor: ".filter((h) => /^(?:[01]\\d|2[0-3])$/.test(h)).sort()",
    replace: ".sort()",
    catches: 'a 25th key would be counted as an hour' },
  { name: 'B7 the per-hour overload count is dropped',
    anchor: "overload: Number(by[h] && by[h].overload) || 0 }))",
    replace: "overload: 0 }))",
    catches: 'the split that separates overload hours from other degrade hours disappears' },
  { name: 'B8 an unreadable event count reads as a covered day',
    anchor: "  if (block.events === null || block.events === undefined || !Number.isFinite(events)) return { state: 'unreadable' };\n  if (events === 0) return { state: 'none', events: 0, covered: 0, hours: [] };",
    replace: "  if (events === 0 || !Number.isFinite(events)) return { state: 'none', events: 0, covered: 0, hours: [] };",
    catches: 'Number(null) is 0: an unreadable block would read as a clean day' },
  { name: 'B9 the not-reported line drops "NOT zero"',
    anchor: "or an older relay); this is NOT zero'];",
    replace: "or an older relay)'];",
    catches: 'an absent hour map prints like a quiet day' },
  { name: 'B10 the partial line drops its reason',
    anchor: "(hrs.state === 'partial' ? '   (the rest predate the field)' : '')];",
    replace: "''];",
    catches: 'the day of the deploy prints one hour as if it were the day, without saying the rest predate the field' },
  { name: 'B11 the partial line drops the denominator',
    anchor: "covers ${hrs.covered} of ${hrs.events} events`",
    replace: "covers ${hrs.covered} events`",
    catches: 'Rule 91: a coverage figure whose denominator is invisible is a claim about everything' },
];

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(WATCH, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(WATCH, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(WATCH, 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    continue;
  }
  const red = spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0;
  fs.writeFileSync(WATCH, original);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}${mut.catches ? `\n            (${mut.catches})` : ''}`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log(`COVERAGE: d1OverloadVerdict (P1-P7, P12-P15), degradeVerdict (P8-P11) and`);
console.log(`refusalVerdict (R1-R20) only. It does NOT exercise the closed-day fetch, ?date= handling, or the other five`);
console.log(`predicates in this watch; the fetch is verified by a scheduled run.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
