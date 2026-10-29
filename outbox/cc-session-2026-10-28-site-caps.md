# CC session 2026-10-28 — Task 3: per-site caps on the odds guard, built behind one gate statement

**Date:** 2026-10-28 · **Repo:** field-relay-nba
**HEAD:** `4d8cd07` → `5b92e04` → this doc's commit
**Branch:** main. Commit identity `claude@field.dev` / FIELD CI (owner, 2026-10-23).
**CC-CMD:** `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`, Task 3, released by the
owner on 2026-10-28 ("go task 3") after its hold ("Hold it; fix 3 first", 2026-10-23) lifted
with `docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md` DONE. Status PARTIAL → see
"Verified and staged".
**Window:** the change touches `chargeOdds`, so it could not land 2026-11-08..11-23 (the CFL
experiment's VOID window). It landed 10-28, ten days before.

## Per commit

| commit | what |
|---|---|
| `5b92e04` | feat: per-site caps on the odds guard, decided by one gate statement. 25 files. Deploy RELAY Worker `40731128552`, Repo guards `40731128567`, Workflow YAML Gate `40731128621`, all green |
| this doc's commit | docs: the live proof (`outbox/odds-site-caps-live-proof-20261028T172529Z.md`), the CC-CMD results, HANDOFF, this doc |

## What was built

1. **A gate.** `chargeOdds` sends eight statements in one D1 batch. `gate` writes this
   call's `crypto.randomUUID()` token into the one-row `odds_budget_gate` only if the day, the
   month and the site all have room over their PRE-charge totals; `siteCharge`, `monthCharge`
   and `charge` apply only while the gate row holds the token. A call is charged to all three or
   to none, so a month veto now charges neither the day nor the site.
2. **Why not copy the predicate.** The first design copied the day's predicate onto a site
   statement and ordered the statements. It was refuted by running it: 973 of 2,000 random
   sequences agreed with a four-line reference model, and the 10-23 premise test found 398 of 400
   disagreeing. The gate agrees on 2,000 of 2,000.
3. **Caps** (policy, `SITE_CEILINGS`): closing capture 400, live odds 2,000, historical 1,800,
   WC lambdas 300. The CFL route and `ambientFetchLiveOdds` stay uncapped (CFL charged 5,112 against
   798 kept; its options 2 and 3 are held). A grant may carry `siteExtra` and expires by its date.
4. **Visibility.** A site veto stamps `odds:daily:<date>:warned:site:<site>`; `/budget/odds` serves
   `site_ceilings`, `site_ceiling_reached_at` and `site_stamps_unreadable`; the pairing watch reads
   the stamps as refusals.

## How it was checked

1. **Probe block first (Rule 100).** The shared ceiling has not bound since 10-12; the counterfactual
   (21,514 credits refused over 09-20..10-27, 10 of 11 ceiling days avoided) and the design are in the
   CC-CMD.
2. **Harness before code.** `check-odds-site-caps` runs the real `chargeOdds` on node:sqlite against
   the reference model; `mutate-odds-site-caps` breaks the source 38 ways (all caught).
3. **Gates.** `gates.py` on a clean worktree named `field-relay-nba`: 141 of 145, the four failures
   being the two environment-only ones (BSD frame list HTTP 0, `RELAY_SHARED_SECRET`) and the
   scope-claims step twice (two new scripts not named in two SCOPE-EXCLUDES lists, fixed, and the step,
   its mutation and the two checks re-run). The deploy and guards workflows then ran the same steps on
   `5b92e04` in CI: both green.
4. **One adversarial review** (workflow `wf_f45e3a89-b2e`): five lenses, a skeptic per finding. 42
   agents, 5.5M tokens, 107 minutes. 34 reproduced findings, 33 confirmed, 1 refuted; disposition in the
   CC-CMD. Real defects it found: the debug latency route answered 500 (it still prepared the removed
   `ODDS_BUDGET_SQL.site`), units NaN or a string flipped a refusal into a counted escape, and several of
   this change's own checks could not fail (the day correction's "no ceiling" check read `''`, the day
   ceiling and the 09-13 grant were pinned by nothing, the site-veto catch was untested).

## The owner's correction, and what it changed

After the review the owner said, about `ODDS_BUDGET_SQL`: "we should be building upon knowledge, not
disregarding because of small errors and deletions". The first version had deleted the old `site`
statement, the old executed mutants E1-E7 and the old check header on the grounds that the gate
replaced them. They are back: the statements as text with the 2026-09-19 "verified on real SQLite"
result, the executed mutants as E1-E9 on the eight statements (E2 reproduces the 90 / 150 gap, E3 the
150 / 90 gap of 2026-09-19, E9 the 2026-10-18 change reverted, month short), the header history, and a
table in the CC-CMD of where each piece lives. A reference to a statement that no longer exists now fails
`scripts/check-odds-sql-binds.mjs` instead of resolving to `undefined`.

## Verified and staged (Rules 61, 74)

- **VERIFIED live (`outbox/odds-site-caps-live-proof-20261028T172529Z.md`):**
  - `/budget/odds` serves the caps and the stamps; `degraded_open` 0 events;
  - after a real charge (+9 credits, 17:09:48Z to 17:24:39Z) the day, the site split and the month each
    moved by exactly 9; `odds_budget_gate` holds one row with a v4 UUID token; the production D1 accepted
    the new table;
  - the rebuilt `/debug/odds-budget-latency` answers 200 (warm batch 56 ms).
- **STAGED: a real refusal.**
  - **What is staged:** the live behaviour of a site cap refusing a call: the stamp, the
    `site_ceiling_reached_at` reading, the pairing watch's refusal line.
  - **What blocks it:** no site has come near its cap since the deploy (the closing capture's charge
    since 10-22 is at most 90 against 400). The refusal path is executed by the check, not seen live.
  - **What unblocks it:** a site reaching its cap, or no event at all: the check below is a read of the
    first closed full day, 2026-10-29, and a read of any day that refuses.
  - **Verify:** `/budget/odds?date=<D>`: `site_ceiling_reached_at` non-null for the capped site, `by_site`
    at or below its cap, `degraded_open.events` 0, and `by_site_sum == used`.
  - **Wake:** `send_later` 2026-10-30 12:00Z (below).
- **Left as the owner's call:** fix 3 E (a failed stamp write reads as no refusal; it now covers site
  stamps too, recorded in the CC-CMD); the label split for `fetchSportOddsLive` and
  `fetchSportOddsHistorical` (owned by `docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md`: an
  anonymous caller can now exhaust a shared label's cap); the backfill "tried" marker on a refused date
  (item 4 of `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md`, now naming the 1,800 cap as a
  second way to be refused).

## Process notes

- A `git commit --amend` after `git reset --soft origin/main` amended the bot commit at the tip of
  `main` locally (not pushed) and was undone before the push: the commit was redone on top of it.
- Three gates runs: the first, on the tree before the review's fixes, found the bare-catch count one
  over its baseline; the second, on the post-review tree, was killed after the owner's correction and
  restarted; the third is the one that preceded the push. Nothing was pushed from the first two.
- The adversarial review took 107 minutes and the capture gap it was meant to fit (14:30Z to 17:15Z)
  almost closed; the push was at 16:58Z.
- **A gate I did not run turned `main` red for 40 minutes.** The close-out commit (docs only) put a
  bold staged-item heading in the CC-CMD with no verifier named. `scripts/staged-verifier-check.mjs`
  (deploy.yml, every relay push that touches `src/`) exits 1 on that, so the next `src/` push would
  have failed at it. It did not fire at the push: docs-only commits do not run `deploy.yml`, and
  `guards.yml` does not carry the step. The BSD WebSocket session found it at 18:11Z running
  `deploy.yml`'s pre-deploy steps locally for its own push, and told this session instead of editing a
  claim that was not its own. Fixed in the commit after this doc: the paragraph is now a "not observed
  live" note that names the mechanical reader (the daily pairing watch, which goes red on a site
  refusal) instead of a staged claim that no verifier could ever pass on a healthy day. The lesson for
  the next close-out: run the doc-reading steps of `deploy.yml` (staged-verifier-check, cc-cmd-status,
  doc-citations, the HANDOFF checks) AFTER writing the docs, not before.

---

# Part 2 — the owner's three decisions on Task 3, built the same day

**Owner's order (2026-10-28):** "decisions 1, 2, 3 approved". Decision 1: fix 3 E, a refusal record that cannot
fail independently of the decision. Decision 2: split the two capped labels shared with unauthenticated routes.
Decision 3: the cap numbers 400/2000/1800/300 stand.

## Per commit

| commit | what | verified |
|---|---|---|
| `0e6a894` | `feat: odds guard - route labels split, refusal record in the charge batch` (one commit: the two changes share files and fakes, and one gates run covers both; it changes `chargeOdds`, so it had to land before 2026-11-08) | `gates.py` 145 of 147 on the rebased commit (the two environment-only failures: the BSD frame list HTTP 0, `RELAY_SHARED_SECRET` unset); Deploy RELAY Worker `40777339113`, Repo guards `40777339101`; live proof `outbox/odds-refusal-live-proof-20261028T2217Z.md` |

HEAD progression: `5dfaf6f` (start) -> `0e6a894` -> this close-out. Smoke does not apply (relay repo).

## What was built

- **Decision 3** recorded, dated, in `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`.
- **Decision 2.** `identityMismatches` 150, `archiveOddsBackfill` 300, `archiveGameClosing` 900, each charged and
  reconciled by its own route; `siteLabels` in `check-odds-attribution` reads the closed-ternary form; the executed
  check `check-odds-label-split.mjs` and its mutants. Two consequences fixed in the same build: `/identity/mismatches`
  now says `guarded: true` for our own refusal (`C0_GUARDED` in the Saturday probe), and
  `measure-odds-consumer-demand` sums the two historical labels.
- **Decision 1.** `odds_budget_refusal` and the `refusal` statement in the charge batch; the reader serves the earliest
  of the record and the stamp, names a null with an unreadable store behind it, and serves `refusals` (null before
  `REFUSAL_RECORD_FROM`, 2026-10-28). The debug latency route runs a refused pair on its sentinel day.

## How it was checked

Counted from the runs, not written down: `check-odds-site-caps` 229 checks, 50 of 50 mutants;
`check-ceiling-reached` 73, 63 of 63; `check-odds-label-split` 61, 20 of 20; `check-odds-budget-batch` 50
self-tests, 37 of 37; `check-monthly-atomic` 122, 33 of 33; `probe-odds-budget-latency` 19, 10 of 10;
`check-odds-attribution` 31, 24 of 24. Five `gates.py` runs on a tree named `field-relay-nba` (147 steps each): (1) the STAGED tree, 139 of 147 (my three
real failures below, and two mutation steps that refuse a dirty tree); (2) the first commit, 145 of 147; (3) the
review-fix commit, 137 of 147 (my fixes had moved four things: two mutant anchors of `mutate-odds-sql-binds`, one bare
`.catch(() => {})` in the new check, and one scope-claims entry; each fails in both `deploy.yml` and `guards.yml`);
(4) the same commit repaired, 145 of 147, rebased onto the bots' two outbox commits and pushed.

A four-lens adversarial review of the first commit (workflow `wf_0826d07d-53b`: sql, reader, harness, callers; 15
agents, 76 minutes) confirmed ten findings, none in the spend path and all in the checks or the claims; every one is
in the disposition table of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`. The finding that mattered most: the
reader's SQL could be broken three ways with every check green (Rule 90). The one that changed the wording: "no cron's"
was false, because the day is shared and `/odds/*` is an uncapped anonymous spender.

## Verified live and not

The proof is `outbox/odds-refusal-live-proof-20261028T2217Z.md` (route fields, a worker charge after the deploy that moved
the day, the site split and the month by +6 each with `degraded_open` 0, the table's DDL in production D1, and the
refusal path executed on the real D1 by the debug route: two refused calls, scopes `[["day"],["day"]]`, one cell with
n = 2, no counter moved). The probe run is `40778483417`.

**Not observed live: a real refusal.** Nothing is waiting for an unblock: no cap, day or month limit has refused a
real call since the deploy, and on a healthy day none does. What the live evidence does not show is the stamp, the
record and the pairing watch's refusal line on a real one; the checks execute that path and the probe runs the
statement on the real D1. It is read mechanically: the daily pairing watch goes red on a refusal, and the wake at
2026-10-30T12:00Z reads the first closed full day (2026-10-29).

## Errors and what they cost

- The first gates run was on a STAGED tree: two mutation steps refuse a dirty tree, so they failed for that reason and
  not for a defect. Commit first, then run the gates.
- Three real gate failures, all mine: a `|| 0` in the new reader (the absence-collapse ratchet; the fix made a
  non-numeric count an unreadable record instead of a zero), and two anchors that still named the old
  `fetchSportOddsHistorical(env, sportKey, isoDate)` call (`check-quota-gate-ordering`, mutant M2 of
  `mutate-odds-writers-sport-scoped`).
- An accidental run of `scripts/probe-odds-join.mjs --help` made the probe run (it has no help flag) and wrote an
  artifact; it was deleted before the commit.
- The review took 76 minutes of a capture gap that ended at 22:50Z; the push still fitted.
- A first mutation harness placed `refusals` anchors on text the amended reader no longer carried; the harness
  reported them as NOT MUTATED rather than caught, which is the behaviour it exists for.

## Carry-forwards

None owed by this session. Owner decisions that remain, none blocking: gating the unauthenticated routes
(`docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md` TASK 1, now with `/odds/*` named), a cap on
`oddsProxyRoute`, whether 900 is the right number for `archiveGameClosing`.
