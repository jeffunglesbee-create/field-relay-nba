# Session doc — nine EPL archive rows left without odds by the `C Palace` defect

**Date:** 2026-11-22 · **Repo:** field-relay-nba · **Branch:** main · **CC-CMD:** `docs/CC-CMD-2026-11-22-epl-rows-left-unpriced-by-c-palace.md` (DONE)
**Owner decisions, verbatim:** "Backfill approved" (no number given; Task 1 forbids proceeding on an inferred yes, so the number was asked for: 270 recommended) → "Go with Claude's best recommendations and state what they are" (the stated recommendations were 270 credits, Coventry last, a free preflight first, one dispatch with no retry, and the D1 count as the done condition).

## Done condition (artifact)

Query, read-only, `field-archive` (D1 `cc49101c-0569-4d41-8e7a-be139cde4f26`), run 2026-11-22 after the dispatch:

```
SELECT COUNT(*) AS unpriced_epl_since_july FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL AND date >= '2026-07-01'
-> [{"unpriced_epl_since_july":0}]
```

Before the dispatch the same query returned 9 (re-read at 21:34Z, immediately before it). **Met.**

## What was spent

- **Billed run:** Actions run `45072843545` (job `137363460288`), `odds-backfill-capped.yml`, inputs `dates=2026-08-22,2026-08-28,2026-09-05,2026-09-12,2026-09-20,2026-10-11,2026-10-18,2026-10-25,2026-08-21`, `sport=EPL`, `approved_credits=270`, dispatched 21:34:21Z, finished 21:34:38Z.
- **The runner's line:** `called 9 of 9 requested date(s) for EPL; 9 file(s) written; 9 of 9 game(s) populated; ledger estimate 270 credits (30 per sport-date that found games; the provider's bill is unmeasured); 0 call(s) with no clean answer, each possibly billed up to 30; approved 270`.
- **Each of the nine answers:** HTTP 200, `ok true`, the date and `sport: "EPL"` echoed, `games_found 1`, `odds_populated 1`, `odds_skipped 0`, no `guarded`, no `stopped`. Nine result files, committed by the run as `83c1e6c` (`outbox/odds-backfill-epl-<date>-20261122T2134*Z.json`).
- **The provider's own meter, read from the answers:** `quota_remaining` after each call, in order: 90504, 90474, 90444, 90414, 90384, 90354, 90324, 90294, 90264. Eight consecutive differences, **each exactly 30**. That measures 30 credits per call for calls 2 to 9. It does NOT measure the first call's debit (there is no reading from before it), so "270 in all" is the ledger estimate plus eight measured steps, not nine measured ones.
- **Not spent:** the free preflight (run `45072795535`) made one gated request to a date with no rows and an unknown label; its log reads `PREFLIGHT OK, nothing spent: https://field-relay-nba.jeffunglesbee.workers.dev answered 400 to an unknown ?sport= label, so it applies the filter.` No file was written. Earlier today 9 credits went to the identity probe (a different CC-CMD, different label).

## What was written (D1, read-only SELECTs after the run)

All nine rows: `source draftkings`, `captured_at` 11:55:36 to 11:55:39Z **on the row's own date** (the vendor served the 11:55Z snapshot for the requested noon), so every one is before its kickoff (13:00Z to 19:00Z). American three-way moneylines:

| date | home v away | kickoff | home / draw / away |
|---|---|---|---|
| 2026-08-21 | Arsenal v Coventry | 19:00Z | -500 / 600 / 1300 |
| 2026-08-22 | Everton v C Palace | 14:00Z | 130 / 235 / 220 |
| 2026-08-28 | C Palace v Man City | 19:00Z | 380 / 300 / -145 |
| 2026-09-05 | Fulham v C Palace | 14:00Z | 115 / 230 / 255 |
| 2026-09-12 | C Palace v Ipswich | 14:00Z | -110 / 270 / 300 |
| 2026-09-20 | Leeds v C Palace | 13:00Z | -140 / 300 / 380 |
| 2026-10-11 | C Palace v Nottm Forest | 13:00Z | 180 / 230 / 155 |
| 2026-10-18 | Brighton v C Palace | 13:00Z | -225 / 380 / 600 |
| 2026-10-25 | C Palace v Newcastle | 14:00Z | 180 / 265 / 140 |

`change_log` holds nine `opening_odds` rows, `source odds_api`, `old_value` NULL, timestamps 21:34:29 to 21:34:35Z. **Undo**, if ever wanted: `UPDATE regular_season_games SET opening_odds = NULL WHERE id IN (<the nine game_id values in that change_log slice>)`; nothing else was written (`closing_odds` untouched; three of the nine already carried one).

**Not checked:** that each line is the right fixture's price against an independent source. What stands behind it is the join (checked on a vendor slate with decoys and different prices, `scripts/check-odds-backfill-sport-filter.mjs`, 27 checks) and the kickoff window, not a second source.

## HEAD progression and what each commit was (single concern each)

| commit | what |
|---|---|
| `38754bb1` | `?sport=` on `/archive/odds-backfill`, the check (15 of 15) and its mutants |
| `4f718b6c` | the spend-capped runner and its dispatch-only workflow, self-test 33, mutants 28 |
| `e58f0527` | CC-CMD Task 0 results (head of the first push) |
| `c9fc09ba` | deploy repair: label-split mutation anchors and the vendor-host scope list (Rule 77) |
| `3919b475` | the filter hardened after the review (echo on every answer, case, Object-property labels, `guarded`) |
| `c2a5e087` | the runner hardened (preflight, write-ahead file, timeout, redaction in both forms, glob, label rule) |
| `64c448ef` | CC-CMD records the review and corrects its premises |
| `09b0074f` | quota-gate ordering check re-anchored on the new destructuring (Rule 77) |
| `83c1e6c` | CI: the nine result files |

**Deploys:** run `45063685118` (head `e58f0527`) RED at "the unauthenticated odds routes spend under their own labels"; run `45068719768` (head `64c448ef`) RED at "the odds quota gate distinguishes null from zero" (step 77 of 127, so 50 steps behind it never ran); run `45071271664` (head `09b0074f`, dispatched by hand because a script-only push is outside `deploy.yml`'s path filter) **GREEN**. Both reds were caused by this session's own commits and are fixed by `c9fc09ba` and `09b0074f`.

**What caught what, honestly:** the first red was found by the review lens that ran the deploy gate, not by my own sweep. My own local sweep of `deploy.yml` missed single-line `run: node ...` steps (its grep matched only multi-line `run: |` blocks), so the second red reached CI. After it, every run step before the deploy step was run locally from a YAML parse of the job (125 of 125; only the three Cloudflare KV bootstrap steps need a token and cannot run outside CI).

## The independent review (29 agents, four lenses, a skeptic per finding)

25 findings, 19 confirmed, 6 refuted. The one that mattered most: the workflow was dispatchable the instant it landed while the deployed relay still ignored `?sport=` (the deploy was red), so a dispatch would have fetched every sport that had rows on the first date at 30 credits each. That is why the runner now **preflights** before any billed request (an unknown `?sport=` label must be answered 400; free on either relay). Also confirmed and fixed: the zero-row answer had no `sport` echo (the runner would have stopped at the first already-priced date); `?sport=epl` and `?sport=constructor` passed the refusal and matched nothing; a credit-guard refusal read as a spend; the attempt was recorded only after the answer; the credential was printed on one path and not redacted in its JSON-escaped form; two globs matched foreign tracked files; the check could not fail for the alias. Refuted, with the reason in each case: the nine-date cap being per sport label and the approval binding a number (stated design); a hung request outliving the job (Node's built-in timeout ends it at 300 s); a label reaching a file name after a billed call (the relay refuses such a label first).

## Integration state (Rule 65)

- **Relay contract:** `GET|POST /archive/odds-backfill?date=YYYY-MM-DD[&sport=<archive label>]`, gated by `FIELD_MCP_SECRET`. Answer: `{ok, date, sport?, games_found, odds_populated, odds_skipped, guarded?, quota_remaining?, stopped?, reason?}`. `sport` is on every answer when `?sport=` was given. `guarded` is present only when the credit guard declined at least one fetch. 400 `unknown ?sport=...` for a label with no Odds-API key. The cron's call passes no sport and is unchanged (asserted by source and by default value).
- **Client consumer:** none. `opening_odds` is read by the existing archive readers; no client field changed. **Status: VERIFIED** for the relay contract (live: preflight 400, nine clean answers) and for the D1 write (the count, the nine rows). **Known mismatch:** none found.

## Residual (genuine, not deferred work)

- **Twenty other EPL rows stay unpriced** (2026-05-09 to 2026-05-24, last season's end). They are one cohort: 26 EPL rows created together on 2026-06-15 16:05:30, 24 of them with `start_time` NULL, all 26 with `finalized_at` NULL; 20 have no `opening_odds` and no `odds_history` row. Four more of the cohort are priced but with a wall-clock `captured_at` of 2026-06-16 and no draw price, and 12 priced EPL rows in all have no draw (not examined). Their own CC-CMD is `docs/CC-CMD-2026-11-22-epl-june-seed-rows-unpriced.md` (FILED; the cost is 150 credits for five dates, the decision is the owner's; nothing spent on it).
- **`Repo guards` is red, from one step that is not this session's:** run `45071139176` (head `09b0074f`) fails only at step 45, "every BSD frame the contract declares matches the captures" (the BSD session's census reaching its read cap); this session's step 30 (the runner's self-test and mutants) and every odds step are green. The BSD session had also noted "the unauthenticated odds routes spend under their own labels" red at `e58f0527` and not investigated it; it was this session's, and it is fixed.
- Left alone on purpose (Rule 69): the stale `Wolves` / `West Ham` aliases in `jubilant-bassoon` `src/legacy/field.js:20277`; the relay secret rotation (owner-gated); NFL R2 caller removal scheduled 11-24; the scheduled read of the Saturday probe (`trig_01G11kB3mfykDMeQABCQpUAp`, 11-29).
