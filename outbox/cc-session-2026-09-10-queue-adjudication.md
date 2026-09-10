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
