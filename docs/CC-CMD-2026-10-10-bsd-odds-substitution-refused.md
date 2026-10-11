# Claude Code Command — record the BSD odds refusal where the next session will look

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** D (decision record) — **nothing is built and nothing is migrated**
**Status:** DONE 2026-10-11. Three tasks, four done conditions, no stop
condition hit. The refusal is now in `src/index.js` beside `const ODDS_BASE`,
with pointers from `src/odds-consumer-rules.js` and `src/odds-shape.js`.
`git diff` is 60 insertions, 0 deletions, comments only.

**THE MEASUREMENT HOLDS COMPLETELY.** Seventeen premises were re-verified
against `outbox/bsd-surface-probe-latest.json` before anything was written into
`src/`: the pre-match market list, the live market list, `hasOpeningValue:
false` in both states, both event ids and both states, and the two verbatim
verdict strings all reproduce exactly.

**FOUR CITATIONS IN THIS DOCUMENT WERE REFUTED AND WERE NOT COMMITTED.** A
decision record whose job is to be believed by a future reader must not carry
unsourced claims into production code:

1. **Task 1's placement was wrong.** `src/odds-consumer-rules.js` is not "the
   code that would be changed" — the metered vendor is consumed in
   `src/index.js`, where `const ODDS_BASE = 'https://api.the-odds-api.com'`
   lives. The block went there, with a pointer left in the two odds modules so
   a reader landing on either still finds it.
2. **The precedent does not exist.** `CC-CMD-2026-07-12-cliche-freshness-scoring.md`
   is not in `docs/`, and `grep -rn 'Do NOT re-dispatch' docs/ src/ outbox/`
   returns only this document. The argument it was offered for — a refusal has
   to be findable where the work would start — is sound on its own and is made
   without the citation.
3. **The vendor quote has no source.** `grep -rn 'multi-bookmaker'` across
   `docs/ src/ outbox/ scripts/ CONTRACTS.md HANDOFF.md` returns only this
   document. The *finding* — BSD's odds are richer live than pre-match — is
   measured and kept; the claim that it contradicts the vendor's own wording is
   dropped, because that wording is not on file.
4. **Rule 47 is the wrong rule.** It is RELAY-IS-DUMB, governing what the relay
   may compute. "No behaviour changes" is this document's own Type D scope, not
   Rule 47, and the committed block does not cite a rule it does not follow.

Found by a Rule 100 premise audit run before execution
(`/workflows` run `wf_d94e8d5b-563`, 25 agents). The pattern is the one this
repository names repeatedly: the numbers were measured and the prose around
them was not.

## This document exists to be found, not to be executed

`CC-CMD-2026-10-10-bsd-measure-before-building.md` closed DONE today with a
measured verdict: **the free-odds substitution is NOT viable.** The decision is
already made. What is missing is a copy of the reason anywhere a session would
look *before* proposing it again — and this repository has paid for that gap
before. `CC-CMD-2026-07-12-cliche-freshness-scoring.md` closed BLOCKED with
"Do NOT re-dispatch this CC-CMD as-is; the core premise needs to change first,"
and that sentence only works because someone reading the cliché code finds it.

Nobody reading `src/odds-shape.js` or `src/odds-consumer-rules.js` today would
find the BSD measurement. The idea is attractive — BSD football odds are free,
the metered vendor is not — so it will be proposed again.

## THE MEASUREMENT, which is the whole document

`outbox/bsd-surface-probe-latest.json`, 2026-10-10, 16 calls of a 40 budget.

| | pre-match (event 220230, `notstarted`) | live (event 207856, `2nd_half`) |
|---|---|---|
| market keys, verbatim | `asian_handicap`, `btts`, `draw_no_bet` | those **plus** `1x2`, `over_under_05`, `over_under_15`, `over_under_25`, `over_under_35`, `double_chance`, `total_corners` |
| moneyline | **ABSENT** | present (`1x2`) |
| goals total | **ABSENT** | present (`over_under_*`) |
| spread | present (`asian_handicap`, 30+ lines) | present (34+ lines) |
| opening price | **none** (`hasOpeningValue: false`) | **none** |

**BSD's odds are richer LIVE than PRE-MATCH**, which is the opposite of the
vendor's own description ("multi-bookmaker odds (pre-match)"). FIELD prices
pre-match — `opening_odds` and `closing_odds` are columns on every game row —
so the state that matters is the one missing a moneyline and a total.

And `hasOpeningValue: false` everywhere kills opening-versus-closing outright,
which is not a nice-to-have here: this repository has a whole apparatus around
it — `odds-capture-provenance.js`, `odds-kickoff.js`, the `inplay_odds`
relabelling column that exists so a post-kickoff capture cannot masquerade as a
closing price.

**Verdict, verbatim from the artifact:** `"sufficient only for a subset
(spread)"` / `"the free-odds substitution is NOT viable"`.

## Tasks

**Task 1 — put the refusal next to the code that would be changed.** A short
block in `src/odds-consumer-rules.js` (and a pointer from `src/odds-shape.js`
if its header is where a reader lands first) naming: the date, the two event
ids, the per-state market lists, the absent opening price, and this document.
Facts and a pointer, not prose. Rule 47 — no behaviour changes.

**Task 2 — state what would change the answer, so the refusal is falsifiable
rather than permanent.** Three conditions, any one of which reopens it:

1. a pre-match event carrying `1x2` **and** an `over_under_*` key — the probe
   sampled ONE pre-match event, and one event is not the vendor's policy;
2. any market carrying an opening value;
3. FIELD's model ceasing to need a pre-match moneyline and total, which is a
   product decision and not BSD's to make.

A refusal with no stated reversal condition is a belief. This one has three.

**Task 3 — do not generalise it past football.** The probe measured football.
`/basketball/api/v2/events/{id}/odds/` and the hockey and tennis equivalents
were **not** probed, and basketball's league list includes the NBA and WNBA —
so the cost argument for those sports is **unmeasured, not refused**. Say that
in the block. Collapsing "not viable for football" into "not viable" is the
substitution this repository keeps finding.

## Stop conditions

- Nothing is removed, migrated or rewired. If a task starts changing an odds
  path, STOP — that is a different document and this one argues against it.
- Do not restate the verdict without its numbers. A bare "measured not viable"
  is the kind of claim the staleness sweep exists to catch; the per-state market
  lists are what make it checkable.

## Done conditions

1. A reader of `src/odds-consumer-rules.js` finds the refusal, its date, its two
   event ids and the per-state market lists without leaving the file.
2. The three reversal conditions are written down.
3. The football-only scope is explicit, and basketball/hockey/tennis are named
   as unmeasured rather than refused.
4. No behaviour changed; `git diff` touches comments and this document only.
