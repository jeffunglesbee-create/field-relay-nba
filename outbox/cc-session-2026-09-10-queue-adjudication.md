# Adjudicating the ten `undetermined` cc-cmd-queue rows — 2026-09-10

## Result

```
before   total 285   open 12   undetermined 10   closed 263
after    total 285   open 17   undetermined  0   closed 268
```

`undetermined_items` is now `[]`. Verified by re-reading the live
`session_health` after the writes, not by trusting them:
`outbox/codex-queue-adjudicate-apply.log`, run 34421566923.

## Why the bucket had to be adjudicated rather than absorbed

`716391d` added `undetermined` so a row whose title states no disposition, and
whose status nobody set, stays visible instead of being decided by a predicate
nobody authorised to decide it. That makes the bucket a standing question, not a
residual — and a standing question with no answer is just a slower version of the
defect. Ten rows, ten answers.

## The method, and why it changed half the answers

**The title is what made these undetermined, so the title cannot settle them.**
Every verdict was read from the row's BODY. Where a body made a claim that is
checkable today, the claim was re-probed at HEAD (Rule 72) rather than inherited.

Five of ten verdicts changed as a result. Three of those five were not vague —
they were **wrong**.

| row | what the record said | what the probe found |
|---|---|---|
| `enqueue-context-gap` | "TASK 3-4 (relay) still pending" | **Stale within hours.** This repo's own `outbox/cc-enqueue-context-gap-relay-2026-07-09.md` records both executed on 2026-07-09 (`0952d28`) and live-verified; `src/index.js` still binds `home`/`away`/`homeScore`/`awayScore`/`matchupNote` into `JOURNALISM_QUEUE.send`. |
| `worth-watching-display` | "CORRECTED to v2 **before execution**" | It executed. `src/legacy/field.js` carries `// 5. Tonight's Pick`, the tier-0-only `ELIMINATION` badge, and a comment restating v2's naming-collision fix. |
| `p15b-p16` | `loadQualityCalibration`'s empty catch "not yet actioned" | **`loadQualityCalibration` is not defined anywhere in `src/` at HEAD** — only named in comments. The residual cannot still be a gap. |
| `amnesty-zone-held` | "4 remain genuinely held"; relay CC-CMD "still needs dispatching" | `/archive/drama/leaderboard` is live and in the MCP probe allow-list, its comment dated 2026-07-20 — one day after the note. `amnesty-bottom-sheet` carries `Status: CLOSED 2026-09-04`. **Held set is 2, not 4.** |
| `relay-empty-catches-sweep` | "~95 remain" (July) | Re-measured today: **70** functionally-empty catch bodies across `src/*.js`. |

`enqueue-context-gap` is the one worth keeping. A **client** session wrote
"TASK 3-4 (relay) still pending" about a repo it was not in, and that sentence
outlived the work by two months. It is the source-versus-copy substitution these
repos already ratchet against, committed into the instrument that measures them.

## The ten verdicts

### Closed (5)

| key | reason |
|---|---|
| `CC-CMD-2026-07-07-worth-watching-display.md` | v2 executed — probe above. |
| `CC-CMD-2026-07-09-enqueue-context-gap.md` | relay TASKS 3-4 shipped same day — probe above. |
| `datamuse-relay-proxy` | body already said "Both sides complete and verified live as of 2026-07-12", with commits `664a039` / `8ede35e`, a real fetch response, and end-to-end scores. Nothing was undetermined but the leading word. |
| `bucketc-inverse-problem-confirmed` | investigation complete: 2 genuine misclassifications reclassified C→B, telemetry reinstated, suites run, plus a separate real `budget.inc()` ReferenceError fixed. |
| `journalismbrief-endpoint-correction` | "Both now fixed", and what survives is documented (`/journalism/brief` ignores `?date=`, so `/analytics/newspaper/{date}` is the right target). |

### Open (5)

| key | disposition | reason |
|---|---|---|
| `CC-CMD-2026-07-07-espn-cache-date-qualification.md` | BLOCKED | Held **by design**, and the hold still stands. The doc's own header: *"Status: NOT for tonight. This is a scoping document, not an execution-ready CC-CMD. Do not dispatch this with an execution one-liner until it's been reviewed and staged deliberately."* 74 `espnScores` references, a dozen-plus unqualified read sites. |
| `p15b-p16-getqualitytarget` | OPEN | Reduced from three residuals to one. See below. |
| `brief-archive-health-audit` | OPEN | Its own body names the residual: compound/client (5 rows, silent since July 10) and series_preview/stakes (1 row each, ever) "flagging for a future pass, not dispatched this turn". |
| `relay-empty-catches-sweep` | OPEN | 70 measured today. |
| `2026-07-16-drama-gateway-and-amnesty-zone-held` | BLOCKED | 2 remain — `amnesty-card-face` and `amnesty-arc-poster` — awaiting one product-sequencing decision. |

## What I could not settle, and did not guess

**P16 (retroactive drama estimation).** The note of 2026-07-13 says it is
"confirmed still genuinely unbuilt". But a *Retroactive Drama Backfill*
(`CC-CMD-2026-07-02-drama-backfill-client`) is shipped in the client at two
sites — dated **eleven days before** that note. Either they are different
features or the note was wrong, and the record does not say which. It is stated
as the single live question on that row rather than resolved by preference.

## Two of these were never queue entries

`bucketc-inverse-problem-confirmed` and `journalismbrief-endpoint-correction`
both have finished work and a **standing instruction** as their residual — "carry
this check into the next Tier C cluster", "apply the negative-result rule to your
own conclusions".

A standing instruction never completes. It therefore cannot ever leave a work
queue, and a row that can never close will sit in `undetermined` or `open`
forever no matter how good the classifier is. That is a **category error, not a
disposition problem**: they belong under `rule`.

Both are closed here as queue items. Refiling them under `rule` is flagged, not
done — creating knowledge-base rows is a different act and is the owner's call.

## Mechanism, and why it is safe

`codex_write` is an upsert: moving a title means supplying the body too. Retyping
a 2,000-character body is an invitation to corrupt it silently — which is exactly
the incident this queue is still recovering from. So the script **reads each row
and writes its own content object straight back**; the body never passes through
a transcription step, and `codex_write`'s history guard (`content IS NOT ?`) sees
it unchanged and writes no `codex_history` row. Only title and status move.

A **pre-image** of all ten bodies is committed to `outbox/` *before* any write, so
the change is reversible from a file and not only from `codex_history`.

**One honest gap in the pre-image:** `codex_read` does not return `status`, so the
pre-image holds title, content and category only. Reversal is still complete in
effect, because `undetermined` is only reachable when status is neither
`resolved` nor `done` — every one of the ten was therefore at the default.

### Guards, all with teeth

1. **ANCHOR, live.** Every key must still classify as `undetermined` before it is
   touched. A row that already classifies means the script is aimed at the wrong
   record, and it refuses to write. 10/10 passed against live D1 in `plan`.
2. **Every new title must classify as its own verdict says**, or the write is a
   no-op wearing a new sentence. 10/10.
3. **Post-write it re-reads all ten** and asserts title moved, class matches,
   body unchanged — then calls the live `session_health` and asserts
   `undetermined` is zero. The done condition is the instrument's answer, not the
   script's exit code.

Two mutations run against the offline self-test, both CAUGHT, each naming the
offending row: dropping an `OPEN` prefix from a verdict title, and flipping a
closed verdict to a null status with no `DONE` in the title. Both surfaced as
`-> undetermined`.

## Reading the numbers correctly

`open` is 17 but `returned` is 12, and that is not truncation — `truncated` is
`false` and the cap is 40. The five rows adjudicated just now have
`hours_stale` under the 2-hour threshold because they were touched seconds
earlier, so they are open without yet being stale. They enter `items` on their
own in two hours.

## Not adjudicated, and why not

`deploy_match: false` in the same response compares full HEAD against the
deployed commit, so it goes false on any docs- or outbox-only commit.
`relay_head_src` is `716391d` and `relay_deployed` is `f5efa60`, which contains
it — the source is deployed. Noted, not chased: it is a separate instrument with
a separate question, and widening scope here would be the "while I'm here" change
Rule 69 prohibits.

## Confidence

**96.** Every verdict is anchored to something read today rather than inherited;
the five that changed were changed by a probe, not by preference; the one I could
not settle is stated as unsettled. The deduction is for `relay-empty-catches-sweep`:
my count of 70 uses a different instrument from the tree-sitter tool behind the
118/~95 figures, so it establishes "greater than zero" — which is all the
adjudication needed — but it does not reconcile with the prior number, and I did
not build the bridge.

---

# Follow-ups, automated rather than carried forward

Both recommendations from the section above are now executed, and the second is
a standing mechanism rather than a one-off.

## 1. The two standing instructions are refiled as rules

```
rule-bucket-c-sibling-citations-recheck              from bucketc-inverse-problem-confirmed
rule-negative-results-apply-to-your-own-conclusions  from journalismbrief-endpoint-correction
```

Run 34424259532. `scripts/codex-refile-standing-rules.mjs`.

**The instruction is extracted, never retyped.** Each rule body is lifted from
its source row by a literal marker, and the extractor asserts the marker occurs
**exactly once** before using it. Paraphrasing a standing rule while refiling it
would be inventing a rule and attributing it to a past session — the same act
this repo's DO NOT INVENT rule prohibits, wearing the costume of tidying up.

**The point of the refiling is asserted, not assumed.** After the writes the
script re-reads `session_health` and requires the queue counts to be unchanged:

```
queue before  total 285 open 17 undetermined 0 closed 268
queue after   total 285 open 17 undetermined 0 closed 268
PASS  the two new rule rows did NOT enter the cc-cmd queue
```

A standing rule counted as work is precisely the defect being removed, so the
check that it isn't has to run, not be reasoned about.

## 2. The bucket is watched, weekly

`.github/workflows/codex-undetermined-watch.yml`, Mondays 07:41 UTC. First live
reading, run 34424310055:

```
checked 285 of 285 cc-cmd-queue rows — the instrument partitions every row,
so the denominator is the whole table

{ "total": 285, "open": 17, "undetermined": 0, "closed": 268 }

PASS  no queue row is undetermined
      0 of 285 rows are undetermined
```

**Zero is not a stable state.** Nothing prevents the next queue row being written
with a title the classifier cannot read — the instrument reports the problem, it
cannot stop it. Ten rows accumulated over roughly two months before anybody
counted them. Without this, the next ten accumulate identically, and the only
thing that changed is that a better instrument was there not to be read.

**It reports and fails loudly. It writes nothing to D1.** Adjudicating a row
means reading its body and forming a judgement, and that is the owner's — this
pass overturned three titles that were not merely vague but *wrong*, which is not
work a schedule can do. Weekly rather than daily because the thing being watched
for happened about once a week, and six more runs buy no information.

## Mutation results, including the one that survived

Three mutations against the **shipped source**, not just fixtures, each asserting
its anchor was unique before mutating.

| mutation | result |
|---|---|
| the watch treats `undetermined > 0` as fine | CAUGHT |
| the refile extractor resolves an ambiguous marker to the first hit | CAUGHT |
| the watch stops requiring `undetermined` to be a number | **SURVIVED** |

**The survivor was fixed by widening the test, not by accepting the pass.** The
fixture used a *missing* field — and `3 + undefined + 7` is `NaN`, so the
arithmetic check failed the row regardless. The type guard was untested by its
own test, and looked identical to a working one from the outside.

`null` is the discriminating case: it coerces to `0`, sums to exactly `total`,
sails through the arithmetic, and **only** the type check stops it. That is the
realistic regression too — an instrument that keeps emitting the key while losing
the value reads as a permanently healthy queue. Re-mutated against the widened
test: CAUGHT.

That is the third time this session a check that had only ever passed turned out
not to reach what it was aimed at. Rule 90 keeps earning its place by the same
mechanism each time: the check and the code both looked right, and only breaking
one of them told them apart.

## Confidence

**97.** Both follow-ups ran live and verified by re-reading rather than by exit
code; the queue-isolation invariant is asserted rather than argued; the one
surviving mutation was fixed at the test rather than explained away. Same
deduction as above stands for the empty-catch count, which is unchanged by this
section.

---

# P16 settled — 2026-09-10

The one question the adjudication above deliberately left open. Run 34424960402.

```
queue before  total 285 open 17 undetermined 0 closed 268
queue after   total 285 open 16 undetermined 0 closed 269
PASS  the queue moved by exactly the number of settlements, in the right direction
```

## The answer: P16 was built, and was already running when it was called unbuilt

The 2026-07-13 note says P16 (retroactive drama estimation) is "confirmed still
genuinely unbuilt". It shipped 2026-07-02.

### Identity, and the limit of the argument

The note ranks P16 6th of 6 in a "June 20 health-monitoring table". **That table
exists nowhere in either repo** — both searched. So the identity is established
from subject and date, not by reading the table it came from. Stating that limit
matters, because the whole defect being corrected here is a claim asserted from
something other than the source.

What both halves of the drama-backfill pair say:

| | |
|---|---|
| `jubilant-bassoon docs/CC-CMD-2026-07-02-drama-backfill-client.md` | titled **"Retroactive Drama Backfill"**; "structurally, not accidentally, degraded **since at least 2026-06-20**" |
| `field-relay-nba docs/CC-CMD-2026-07-02-drama-backfill-discovery.md` | "silently, structurally degraded **since at least 2026-06-20** with zero visible indication anywhere" |

June 20 is the date of the table P16 sat in, the subject is retroactive drama
computation, and no other retroactive-drama work exists in either repo.

### It shipped, and was tuned after shipping

Tuning is the stronger evidence: it means somebody watched the thing run.

```
field.js:35096   the backfill block, citing CC-CMD-2026-07-02
field.js:35297   fetch(`${relayBase}/archive/drama-missing?limit=20`)
field.js:42195   called on the boot path, best-effort, never blocks boot
                 "Cap raised 3 -> 20 games per session: verified 2026-07-02 that
                  the original cap of 3 wasn't keeping pace with the real backlog
                  (128 -> 137 missing games since shipping)"
```

The relay half is live too: `/archive/drama-missing` is the discovery endpoint
that CC-CMD built, and the client calls it by name.

### Live artifact, and what it does not prove

`GET /archive/drama/leaderboard?sport=MLB&limit=5` returns five games with real
`drama_peak` values (100, 100, 100, 100, 99) and dense several-hundred-sample
`drama_arc` series, dated 2026-05-25 through 2026-08-07.

**It does not show that any individual arc came from the backfill rather than
from a live session,** and this settlement does not claim it does. The mechanism
is established from the code and its post-ship tuning; the leaderboard
corroborates. Saying so is the difference between this settlement and the note it
corrects.

### The row closes entirely

Its other two residuals were retired earlier today — `getQualityTarget` is
superseded, and `loadQualityCalibration` is not defined anywhere in relay `src/`
at HEAD. With P16 answered, nothing is left open on `p15b-p16-getqualitytarget`.

## Why a new script rather than the adjudication table

`codex-queue-adjudicate.mjs`'s anchor requires every target to classify as
`undetermined` before the write. That is exactly right for the ten-row pass and
useless afterwards: an adjudicated row is now `open` or `closed`, so settling it
again must assert a **different** before-state.

`scripts/codex-queue-settle.mjs` declares the expected prior classification per
settlement and checks it. It is the path for every settlement after the ten-row
pass, rather than a second one-off — and it carries the same three properties:
body round-tripped never retyped, pre-image before any write, verified by
re-reading and then by the live instrument.

It adds one guard the ten-row script did not need: **the queue must move by
exactly the number of settlements, in the right direction.** A write that lands
on the wrong row cannot pass that.

Mutation against the shipped source, anchor asserted unique first: flipping the
declared before-state to the state being moved *to* — a no-op settlement
reporting success having changed nothing — CAUGHT.

## A correction to my own reporting

While this run was in flight I wrote that the queue would go to "17 open / 269
closed". That is not arithmetic that can happen: closing one open row moves open
17 → 16. The measured result is `open 16 / closed 269`.

## Confidence

**94.** The mechanism is read from source at HEAD and from its own post-ship
tuning comment, and the settlement's queue-delta guard passed. The deduction is
the identity argument: the June-20 table that named P16 does not exist in either
repo, so "P16 is this feature" rests on a date match, a subject match, and the
absence of any other candidate — strong, but not the same as reading the table.
