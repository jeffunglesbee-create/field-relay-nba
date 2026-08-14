# CC-CMD-2026-08-14-silent-decay-and-untested-paths

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-14-silent-decay-and-untested-paths.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Scope

Three items that are correct today and get worse by themselves. None is a bug
report; each is a thing with no end condition.

**Already filed elsewhere, do not duplicate:**
`CC-CMD-2026-08-13-stamp-scoring-version-on-write` covers the 13 unstamped
INSERT sites. Referenced here only because TASK 1 interacts with it.

## TASK 1 — era-scoped calibration will be permanently partial, and nothing says so

The jq-provenance pass wired `eraForDate()` bucketing so percentiles compute
within an era instead of across a mixture. It reported `calibration
era-scoped: 0, mixed-era: 8`, and corrected its own ETA when measured: the ≥5
floor is **per `brief_type`**, not on total volume. Real per-type rates:

```
game_recap  ~0.3 days      mlb_game  ~0.6 days
tail types  ~7 days        compound  ~0.1/day → ~35 days, may never reach the floor
```

That is not a 30-day transition after which the mixture flushes. It is a
**permanent split**: `/quality/report` will serve era-scoped percentiles for
high-volume types and mixed-era percentiles for low-volume ones,
**simultaneously and indefinitely**, distinguishable only by reading
`era_scoped` per row.

The fallback is correct — a p25 over 2 briefs is worse than one over a mixture.
The defect is that a reader comparing two rows in the same response has no
reason to know they were computed under different rules.

**Do:**
- State the condition per row in the response, not only as a boolean —
  which era, how many briefs, and whether the floor was met.
- Add a report-level summary: how many types are era-scoped vs mixed, so the
  split is one number rather than eight rows to inspect.
- Record in the outbox that some types may **never** era-scope, naming which,
  with their measured rates. That is a design fact, not a pending state.

**Do NOT** lower the ≥5 floor to make more types qualify, and **do NOT** force
`/journalism/run` to fill buckets. Generating briefs to trip a calibration
threshold is manufacturing data to satisfy a metric — the same instinct the
provenance pass correctly refused.

## TASK 2 — `below_flat_240_pct` is permanently 100 with no retirement condition

The dual-predicate change kept the legacy metric alongside the new one so no
future formula change loses its own baseline to elapsed time. That was the right
call and it recovered a real 23 → 14 measurement.

But 240 is unreachable. Measured across 592 rescored `mlb_game` briefs, the
maximum is **181**; restoring Dim 4's contribution adds at most 16, so ~195.
`below_flat_240_pct` therefore reads **100 on every row, forever**. It is
currently useful as the legacy baseline and will become furniture — a field that
always says the same thing is one nobody reads, and the next person to read it
will read it as a quality signal.

**Do:**
- Give it an explicit retirement condition **in the code, next to the field** —
  the date or event after which it is removed, and why it existed.
- Decide whether 240 is re-based to the real ceiling or the field is dropped
  once the dual-predicate window has served its purpose. State the decision.

A constant that can never be reached is not a threshold. Either it moves or it
goes; leaving it as a permanently-true field is the third option and it is the
one that decays.

## TASK 3 — one J-layer call has no provenance and an untraced caller

Every J-layer LLM call goes through the proxy and now reports measured
provenance (`X-FIELD-Model`, `X-FIELD-Latency-Ms`, `X-FIELD-Gemini-Error`).

**One does not.** `src/index.js:4846` (line number at time of writing — re-probe
it) calls Anthropic **directly** with `env.ANTHROPIC_API_KEY` and
`anthropic-version: 2023-06-01`, bypassing the proxy entirely. It sits in the
World Cup projections path, generating a brief when teams move >3% pFinal.

So it has: no routing, no Gemini primary, no fallback, and **none of the
observability the rest of the J-layer just gained**. If it fails or degrades,
nothing reports it.

The prior pass found the call and stated plainly that it **did not trace the
caller**. So whether it is still reachable is unknown.

**Do:**
1. Trace the caller. Establish whether the path is live — reachable at all, and
   whether the >3% pFinal condition has fired recently. A dead path and a live
   unobservable path need different actions and the difference is measurable.
2. If live: give it the same provenance the rest has, or route it through the
   proxy. Route-through is preferable — it removes a second credential path —
   but it changes the answering model from Sonnet to Gemini-primary, which is a
   **behaviour change** and must be decided, not slipped in.
3. If dead: propose removal in its own CC-CMD with the liveness evidence. Do not
   delete it in this pass.

**Do NOT** assume it is dead because nothing has reported it. Nothing reporting
it is the property under investigation.

## DONE CONDITION

1. `/quality/report` states per-row era scoping with counts, plus a
   report-level split summary; types that may never era-scope named with rates.
2. `below_flat_240_pct` carries a retirement condition in code, and a stated
   decision on re-base vs removal.
3. The direct Anthropic call's caller is traced and its liveness stated as a
   measurement, with the chosen action (instrument / route / propose removal).
4. Nothing in this pass lowered a floor, generated briefs to fill a bucket, or
   deleted a path on the strength of silence.

## Confidence scoring

- TASK 1 (35 pts): the permanent split is visible in the response and named in the outbox
- TASK 2 (25 pts): retirement condition in code, decision stated
- TASK 3 (30 pts): caller traced, liveness measured not assumed, action chosen
- Discipline (10 pts): no floor lowered, no data manufactured, no path deleted on silence

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
Automate follow-ups. No fallbacks, only fixes.

## Outbox

`outbox/cc-session-2026-08-14-silent-decay-and-untested-paths.md`
