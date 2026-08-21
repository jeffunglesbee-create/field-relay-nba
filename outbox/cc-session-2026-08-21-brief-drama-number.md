# CC Session — 2026-08-21 — brief-data-quality ask 1 (drama number in prose)

**Serves:** `docs/CC-CMD-2026-08-20-brief-data-quality.md` rev 3, ask 1
(filed by field-laboratory, in that repo).
**HEAD:** `e071557` → `5ef3e1f` (fix) → `62586a5` (ci)
**Deploy:** run `32444193043`, success 2026-08-21T03:41Z.

## The defect, and its actual mechanism

The stored La Liga recap read: *"…failed to generate momentum during the ESPN
Deportes broadcast **in a game with a 52/100 drama rating**."* `brief_text` is
rendered to the user, so that is ADR-002 **PROHIBITED #3** — a raw composite
drama number displayed to the user — which the 2026-07-07 corrections explicitly
do NOT relax (`ADR-002-CONTEXT.md` L75-78).

Traced, not guessed. Two prompt builders pushed the value into the model's
DEBRIEF CONTEXT block as `` ` Drama: ${drama_peak}/100` ``:

| site | reached from |
| -- | -- |
| `buildGameCompletePrompt` (~L5310) | `/journalism/game-complete` (call site ~L15717) |
| inline copy inside `handleJournalismCycle` (~L8563) | the **cron** — the path that wrote the observed row |

The model transcribed it. Both fixed in `5ef3e1f`; `drama_peak` also dropped
from the cron path's `_dc` object, where the removed line was its only consumer
(Rule 63).

## What was NOT changed, deliberately

Rule E permits the relay to store and pull-serve derived drama state "of any
shape — numeric or labeled", and post-game briefs sit in the amnesty zone. Only
the number reaching the reader violates. Untouched: `drama_peak` in D1,
`/archive/query`, `/context/*`, every client render, and the pull/push
architecture (Rule A is not in play here).

## The previous mitigation, and why it failed

The prompt header already said *"use to enrich the recap, don't list
mechanically."* That was the guardrail. An instruction to a model is not a
constraint on it — which is the whole argument for `62586a5`.

## Guard (`62586a5`), blocking, pre-deploy

`scripts/check-no-drama-number-in-prompts.mjs`. Strips comments before matching,
because both fix sites now carry explanatory comments that quote the removed line
verbatim — a naive grep flags those and the guard becomes unusable. That is the
Rule 90 failure mode (matched, but not for the right reason) avoided at authoring
time.

Negative-tested two ways, both fail by name:

```
restore the original line          -> FAIL: drama number pushed into prompt lines
rename to `Intensity: ${x}/100`    -> FAIL: drama number pushed into prompt lines
```

The rename case is the one that earns its keep: a variable rename is how this
regresses in practice, and a literal-string guard would miss it.

## Status

- **Code path: VERIFIED.** Deploy run `32444193043`, step 8 "No raw drama number
  in generated prose" — success, and it precedes step 9 (deploy), so a
  regression blocks the deploy rather than being caught after.
- **Output: PENDING one cron cycle.** The CC-CMD's artifact is about generated
  rows, so it needs a new `game_recap` written after 03:41Z on a finished game.
  Probe:
  ```
  curl -s "$RELAY/archive/query?brief_type=game_recap&limit=40" | node -e '
    const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const re=/\b\d{1,3}\s*\/\s*100\b|\bdrama (rating|score)\b/i;
    const bad=d.results.filter(r=>re.test(r.brief_text)&&r.created_at>"2026-08-21 03:41");
    console.assert(!bad.length,"post-fix row still carries a drama number");
    console.log(bad.length?bad.map(r=>r.id):"PASS");'
  ```
  Scoped to `created_at` after the deploy on purpose — historical rows still
  carry the phrase, and the CC-CMD's own negative test requires
  `game_recap_la liga_401882925` to keep flagging.

## Residual — one data decision, not deferred work

Historical rows retain the phrase. Scrubbing them is a live-D1 mutation outside
this ask, and would defeat the CC-CMD's stated negative test. Same shape as the
UEFA label row fixed 2026-08-20: needs explicit authorisation, and the fix is a
targeted `UPDATE` with pre-state assertion, not a blanket regex rewrite of
`brief_text`.
