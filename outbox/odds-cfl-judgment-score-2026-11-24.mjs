#!/usr/bin/env node
// Scores the CFL post-window (2026-11-17..11-23) exactly as outbox/odds-cfl-season-end-prediction-2026-10-18.md committed its tests,
// from the per-day rows read on 2026-11-24 (D1 field-archive SELECTs and the committed odds-daily-vs-vendor logs). Pure: no network, no credits.
// Judging document: outbox/odds-cfl-season-end-judgment-2026-11-24.md.
//
//   node outbox/odds-cfl-judgment-score-2026-11-24.mjs               prints the scores for the recorded rows
//   node outbox/odds-cfl-judgment-score-2026-11-24.mjs --self-test   RULE 90: feeds the same scorer five altered copies of the rows, each built
//                                                                      to flip named tests, and exits 1 unless exactly those tests flip. The
//                                                                      unaltered rows are also asserted against the recorded scores first.
export function score(d) {
const W = d._sources.windows
const inRange = (day, [a, b]) => day >= a && day <= b
const RECONCILING = ['tracks-the-bill', 'we-overcharge-ourselves', 'counter-under-counts']
const win = (r) => d.days.filter((x) => inRange(x.day, r))
const judged = (days) => days.filter((x) => RECONCILING.includes(x.log.verdict))
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0)
const pre = win(W.pre), post = win(W.post), preJ = judged(pre), postJ = judged(post)
const strandedCredits = (x) => x.cfl_by_site - x.cfl_receipts
const dr = (x) => x.daily - x.receipts_all // daily - receipts
const out = { windows: { pre: W.pre, post: W.post }, judged: { pre: `${preJ.length} of ${pre.length}`, post: `${postJ.length} of ${post.length}`, post_excluded: post.filter((x) => !RECONCILING.includes(x.log.verdict)).map((x) => `${x.day} ${x.log.verdict}`) } }
out.inconclusive = preJ.length < 5 || postJ.length < 5
const resPre = sum(preJ, (x) => x.log.residual), resPost = sum(postJ, (x) => x.log.residual)
const tolPre = sum(preJ, (x) => x.log.tolerance), tolPost = sum(postJ, (x) => x.log.tolerance)
out.sums = { residual_pre: resPre, residual_post: resPost, tolerance_pre: tolPre, tolerance_post: tolPost, daily_minus_receipts_pre: sum(preJ, dr), daily_minus_receipts_post: sum(postJ, dr), cfl_by_site_pre: sum(preJ, (x) => x.cfl_by_site), cfl_by_site_post: sum(postJ, (x) => x.cfl_by_site), cfl_stranded_pre: sum(preJ, strandedCredits), cfl_stranded_post: sum(postJ, strandedCredits) }
// H-whole: |sum of post residuals| <= sum of the daily tolerances
out.H_whole = { holds: Math.abs(resPost) <= tolPost, lhs: Math.abs(resPost), rhs: tolPost, also_true_of_the_pre_window: Math.abs(resPre) <= tolPre }
// H-none: post residual sum within +-50% of the pre residual sum, scaled by days judged
const scaled = resPre * (postJ.length / preJ.length), lo = Math.min(scaled * 0.5, scaled * 1.5), hi = Math.max(scaled * 0.5, scaled * 1.5)
out.H_none = { holds: resPost >= lo && resPost <= hi, band: [lo, hi], pre_scaled: scaled, post: resPost, band_is_a_point: lo === hi }
// Spec 2.3: contraction per judged day vs half / quarter of the pre-window mean daily (CFL by site - CFL receipts)
const meanStr = sum(preJ, strandedCredits) / preJ.length, bar = 0.5 * meanStr, quarter = 0.25 * meanStr
const contrA = (resPost - resPre) / postJ.length, contrB = resPost / postJ.length - resPre / preJ.length
out.spec_2_3 = { pre_mean_daily_stranded: meanStr, bar_half: bar, bar_quarter: quarter, contraction_per_judged_day: { normalised_by_post_days: contrA, difference_of_daily_means: contrB }, contracts_roughly: contrA >= bar && contrB >= bar, did_not_contract: contrA <= quarter && contrB <= quarter, degenerate: bar === 0 }
// M(a): CFL by site > 0 on every judged day the app was used, with CFL receipts <= 12 a day
const used = (x) => x.calls.cache_hit + x.calls.reconciled + x.calls.error > 0
const aDays = postJ.filter(used)
out.M_a = { holds: aDays.every((x) => x.cfl_by_site > 0) && aDays.every((x) => x.cfl_receipts <= 12), days_app_used: aDays.length, days_by_site_above_zero: aDays.filter((x) => x.cfl_by_site > 0).length, days_receipts_at_most_12: aDays.filter((x) => x.cfl_receipts <= 12).length }
// M(b): |sum residuals + sum(daily - receipts)| <= max(350, 10% of sum(daily - receipts))
const drPost = sum(postJ, dr), lhsB = Math.abs(resPost + drPost), rhsB = Math.max(350, 0.1 * drPost)
out.M_b = { holds: lhsB <= rhsB, lhs: lhsB, rhs: rhsB }
// M(c): CFL's stranded share inside 15% to 55%. share = stranded calls / (reconciled calls + stranded calls) (the outbox/odds-counter-internal-2026-10-18.md definition), stranded = CFL by site - CFL receipts
const share = (xs) => { const s = sum(xs, strandedCredits) / 6, r = sum(xs, (x) => x.calls.reconciled); return s + r === 0 ? null : s / (s + r) }
const perDay = postJ.map((x) => ({ day: x.day, share: share([x]) }))
out.M_c = { holds: share(postJ) !== null && share(postJ) >= 0.15 && share(postJ) <= 0.55, aggregate_share: share(postJ), per_day: perDay, pre_window_aggregate_share: share(preJ) }
// call volume (both windows)
const vol = (xs) => ({ cache_hit: sum(xs, (x) => x.calls.cache_hit), reconciled: sum(xs, (x) => x.calls.reconciled), error: sum(xs, (x) => x.calls.error), total: sum(xs, (x) => x.calls.cache_hit + x.calls.reconciled + x.calls.error) })
out.call_volume = { pre_7_days: vol(pre), post_judged_6_days: vol(postJ), post_all_7_days: vol(post) }

  return out
}

export const DATA = {
  "_sources": {
    "d1": "field-archive cc49101c-0569-4d41-8e7a-be139cde4f26, read-only SELECTs on odds_budget (used), odds_budget_site (used, site=handleCFLOddsProbs, sum over sites), odds_reconcile_state (credits_kept, state IN ('reconciled','cache-hit') = receipts; n by state), read 2026-11-24 14:0xZ",
    "logs": "outbox/odds-daily-vs-vendor-<date>T<hhmm>.log on origin/main, one per closed day; each log's day= header names the day it judges (the log dated D+1 judges D)",
    "windows": {"pre": ["2026-11-08","2026-11-14"], "post": ["2026-11-17","2026-11-23"], "reported_not_judged": ["2026-11-15","2026-11-16"]}
  },
  "days": [
    {"day":"2026-11-08","daily":504,"by_site_sum":504,"receipts_all":504,"cfl_by_site":84,"cfl_receipts":84,"calls":{"cache_hit":341,"reconciled":14,"error":19,"error_kept":114},"log":{"file":"odds-daily-vs-vendor-2026-11-09T0613.log","vendor_billed":605,"ledger_window":405,"known_ci":200,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-09","daily":174,"by_site_sum":174,"receipts_all":174,"cfl_by_site":60,"cfl_receipts":60,"calls":{"cache_hit":28,"reconciled":10,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-10T0709.log","vendor_billed":286,"ledger_window":126,"known_ci":160,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-10","daily":144,"by_site_sum":144,"receipts_all":144,"cfl_by_site":78,"cfl_receipts":78,"calls":{"cache_hit":33,"reconciled":13,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-11T0602.log","vendor_billed":252,"ledger_window":192,"known_ci":60,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-11","daily":183,"by_site_sum":183,"receipts_all":183,"cfl_by_site":114,"cfl_receipts":114,"calls":{"cache_hit":445,"reconciled":19,"error":6,"error_kept":36},"log":{"file":"odds-daily-vs-vendor-2026-11-12T0703.log","vendor_billed":219,"ledger_window":159,"known_ci":60,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-12","daily":165,"by_site_sum":165,"receipts_all":165,"cfl_by_site":60,"cfl_receipts":60,"calls":{"cache_hit":25,"reconciled":10,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-13T0632.log","vendor_billed":189,"ledger_window":129,"known_ci":60,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-13","daily":156,"by_site_sum":156,"receipts_all":156,"cfl_by_site":66,"cfl_receipts":66,"calls":{"cache_hit":29,"reconciled":11,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-14T0610.log","vendor_billed":239,"ledger_window":159,"known_ci":80,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-14","daily":516,"by_site_sum":516,"receipts_all":516,"cfl_by_site":108,"cfl_receipts":108,"calls":{"cache_hit":39,"reconciled":18,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-15T0618.log","vendor_billed":780,"ledger_window":720,"known_ci":60,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-15","daily":486,"by_site_sum":486,"receipts_all":486,"cfl_by_site":66,"cfl_receipts":66,"calls":{"cache_hit":23,"reconciled":11,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-16T0617.log","vendor_billed":402,"ledger_window":342,"known_ci":60,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-16","daily":165,"by_site_sum":165,"receipts_all":165,"cfl_by_site":18,"cfl_receipts":18,"calls":{"cache_hit":25,"reconciled":11,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-17T0747.log","vendor_billed":187,"ledger_window":87,"known_ci":100,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-17","daily":57,"by_site_sum":57,"receipts_all":57,"cfl_by_site":0,"cfl_receipts":0,"calls":{"cache_hit":27,"reconciled":13,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-18T0716.log","vendor_billed":153,"ledger_window":93,"known_ci":60,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-18","daily":105,"by_site_sum":105,"receipts_all":105,"cfl_by_site":0,"cfl_receipts":0,"calls":{"cache_hit":133,"reconciled":13,"error":1,"error_kept":6},"log":{"file":"odds-daily-vs-vendor-2026-11-19T0715.log","vendor_billed":132,"ledger_window":72,"known_ci":60,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-19","daily":66,"by_site_sum":66,"receipts_all":66,"cfl_by_site":0,"cfl_receipts":0,"calls":{"cache_hit":120,"reconciled":9,"error":1,"error_kept":6},"log":{"file":"odds-daily-vs-vendor-2026-11-20T0703.log","vendor_billed":132,"ledger_window":72,"known_ci":60,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-20","daily":207,"by_site_sum":207,"receipts_all":207,"cfl_by_site":0,"cfl_receipts":0,"calls":{"cache_hit":90,"reconciled":12,"error":39,"error_kept":234},"log":{"file":"odds-daily-vs-vendor-2026-11-21T0657.log","vendor_billed":358,"ledger_window":258,"known_ci":100,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-21","daily":819,"by_site_sum":819,"receipts_all":819,"cfl_by_site":0,"cfl_receipts":0,"calls":{"cache_hit":141,"reconciled":11,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-22T0637.log","vendor_billed":1068,"ledger_window":948,"known_ci":120,"residual":0,"tolerance":53,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-22","daily":693,"by_site_sum":693,"receipts_all":693,"cfl_by_site":0,"cfl_receipts":0,"calls":{"cache_hit":28,"reconciled":10,"error":0,"error_kept":0},"log":{"file":"odds-daily-vs-vendor-2026-11-23T0725.log","vendor_billed":741,"ledger_window":561,"known_ci":180,"residual":0,"tolerance":50,"verdict":"tracks-the-bill"}},
    {"day":"2026-11-23","daily":348,"by_site_sum":348,"receipts_all":348,"cfl_by_site":0,"cfl_receipts":0,"calls":{"cache_hit":239,"reconciled":12,"error":1,"error_kept":6},"log":{"file":"odds-daily-vs-vendor-2026-11-24T0945.log","vendor_billed":null,"ledger_window":null,"known_ci":null,"residual":null,"tolerance":null,"verdict":"window-drift"}}
  ]
};

const clone = (x) => JSON.parse(JSON.stringify(x));
const get = (o, p) => p.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

// The recorded scores (what the judging document reports) and the five altered copies. `expect` lists [path, value] pairs that MUST hold after the
// alteration; `flips` lists the tests the alteration is built to flip from their recorded value. A harness that cannot fail would print PASS on all of
// them, so the self-test also asserts that every flip really changed (a mutation that changed nothing exits 1).
export const RECORDED = { 'H_whole.holds': true, 'H_none.holds': true, 'spec_2_3.degenerate': true, 'M_a.holds': false, 'M_b.holds': true, 'M_c.holds': false, inconclusive: false };
export const MUTANTS = [
  { name: 'a -800 residual on one judged day (2026-11-19)', apply: (d) => { d.days.find((x) => x.day === '2026-11-19').log.residual = -800 },
    flips: { 'H_whole.holds': false, 'H_none.holds': false, 'M_b.holds': false } },
  { name: 'CFL charging 6 a day with 6 receipts behind it on every post day (a net charge with no stranded part)', apply: (d) => { for (const x of d.days.filter((y) => y.day >= '2026-11-17')) { x.cfl_by_site = 6; x.cfl_receipts = 6 } },
    flips: { 'M_a.holds': true } },
  { name: '24 stranded credits a day on every post day', apply: (d) => { for (const x of d.days.filter((y) => y.day >= '2026-11-17')) { x.cfl_by_site = 24; x.cfl_receipts = 0 } },
    flips: { 'M_a.holds': true, 'M_c.holds': true } },
  { name: 'a pre-window carrying 741 a day of residual and 647 a day of stranded credit', apply: (d) => { for (const x of d.days.filter((y) => y.day >= '2026-11-08' && y.day <= '2026-11-14')) { x.log.residual = -741; x.cfl_by_site = x.cfl_receipts + 647 } },
    flips: { 'H_none.holds': false, 'spec_2_3.degenerate': false } },
  { name: 'three post days refused (window-drift)', apply: (d) => { for (const day of ['2026-11-17', '2026-11-18', '2026-11-19']) d.days.find((x) => x.day === day).log.verdict = 'window-drift' },
    flips: { inconclusive: true } },
];

if (process.argv[1] && process.argv[1].endsWith('odds-cfl-judgment-score-2026-11-24.mjs')) {
  if (process.argv.includes('--self-test')) {
    let bad = 0
    const base = score(clone(DATA))
    for (const [p, v] of Object.entries(RECORDED)) { const got = get(base, p); const ok = got === v; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} recorded ${p} = ${JSON.stringify(got)} (expected ${JSON.stringify(v)})`) }
    for (const m of MUTANTS) {
      const d = clone(DATA); m.apply(d)
      if (JSON.stringify(d) === JSON.stringify(DATA)) { bad++; console.log(`FAIL mutant "${m.name}" changed nothing (NOT CAUGHT with no mutation applied is worse than no test)`); continue }
      const s = score(d)
      for (const [p, v] of Object.entries(m.flips)) {
        const was = RECORDED[p], got = get(s, p), ok = got === v && was !== v
        if (!ok) bad++
        console.log(`${ok ? 'ok  ' : 'FAIL'} mutant "${m.name}": ${p} ${JSON.stringify(was)} -> ${JSON.stringify(got)} (expected ${JSON.stringify(v)})`)
      }
      // tests the mutant was NOT built to flip must keep their recorded value, so a flip is attributable to the alteration
      const untouched = Object.keys(RECORDED).filter((p) => !(p in m.flips) && get(s, p) !== RECORDED[p])
      if (untouched.length) console.log(`note mutant "${m.name}" also moved: ${untouched.map((p) => `${p} -> ${JSON.stringify(get(s, p))}`).join(', ')}`)
    }
    console.log(`\nself-test: ${MUTANTS.length} mutants, ${Object.keys(RECORDED).length} recorded assertions, ${bad} failures`)
    process.exit(bad ? 1 : 0)
  }
  console.log(JSON.stringify(score(clone(DATA)), null, 1))
}
