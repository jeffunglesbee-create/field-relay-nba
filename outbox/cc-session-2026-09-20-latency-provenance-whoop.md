# CC session 2026-09-20 — Task 0d, a handler boundary, and a question nobody asked

**HEAD:** `ae606dc` → `677217b` (the tail is scheduled watches, not this session)
**Vendor credits spent:** 0
**Deploys:** 982 (`712227d`), 983 (`1845f72`) — both green

Session docs this covers: `2026-09-20-task-0d-latency.md`,
`2026-09-20-whoop-tokens-probe.md`, `2026-09-20-provenance-name-collision.md`
(corrected).

## What landed

| | commit | outcome |
|---|---|---|
| `DB` binding removed | `712227d` | one database had two names; `env.DB` refs were 0 |
| whoop_tokens probe + ladder | `2ebb5c0`, `ca9e24a`, `ae45fd9` | verdict `no-d1-scope`, now watched weekly |
| provenance handler boundary | `484557d`, `d0b5d37` | the reported "second mechanism", fixed and gated |
| Task 0d latency route + probe | `1845f72`, `5217798`, `a8c8e3e` | **517 ms → 38 ms** |

## Task 0d — the number, and the reason it is that big

| series | median |
|---|---|
| four sequential KV ops (old guard) | **517 ms** |
| one batch, warm (new guard) | **38 ms** |
| first call on an isolate | **67 ms**, reported apart |

Per-request delta **−479 ms**. The per-slate batching decision the spec left
conditional never arises: (b) is faster than (a).

The CC-CMD refused to predict this and was right to — "a lower op count is not
by itself a lower latency" holds, and the answer was still enormous for a reason
that sentence does not contain. The cost was two KV **writes**, each replicating
globally, on a path that needed one transaction against one store.

**The spread is the second finding.** Old form: ~200 ms wide across seven
samples. New form: ~16 ms. The replaced path was not only slower, it was
variable — what a per-request path can least afford.

## The provenance defect was not what I said it was

Reported 2026-09-19 as "a SECOND mechanism", filed beside a name-collision fix,
which put it in the reader's head as another scoping problem. It is not.

`bodyOf()` ended a delegated handler at **the next top-level `function`
declaration**. When a handler is the last function in a file, nothing matches and
the body runs to EOF. `handleGamma` is last in the fixture, so `/gamma` swallowed
the whole dispatch block and collected a host from `handleBeta`.

**`functionBody()`, thirty lines away in the same file, already carried the
correction**, with a comment explaining why it was made. The fix had been applied
to one of the two places that needed it and the sibling kept the bug with the
explanation beside it. That is the finding worth keeping, more than the leak.

Live impact, measured: 0 of 187 manifest entries, 0 lines of census output.

## whoop_tokens: it was never a decision

"Drop the table?" was carried for a day as an owner decision. No
`CREATE TABLE whoop_tokens` exists in any commit and no session had ever queried
it. Three of four outcomes need no owner.

First run returned `unreadable` — the control working, refusing to let a
permission failure read as "nothing there". But `unreadable` names no remedy, so
the classifier became a ladder. Second run: rung 1 ok, rung 2
`Authentication error [code: 10000]`. Verdict **`no-d1-scope`**.

**`timetravel-window-watch.yml` has been waiting on that same token mint since
2026-09-07.** The probe rides it rather than adding a second weekly cron.
Re-verifying an inherited claim (Rule 72) is what made that visible: I
reproduced the refusal independently before going looking for a watch.

## Where the odds counter stands

`odds-site-drift`, first D1-era day: **488 credits across two intervals, `gapD 0`
at every sample**, against `+242 / +43 / −16` in the KV era. Verdict
`inconclusive`, which is the only non-failure state it has — by construction it
will not call absence-of-failure a pass. Evidence accumulating, not a verdict.

`odds-daily-vs-vendor`: `window-drift`, one reading for 09-19, no comparison.
Three closed days remains the condition; earliest ~09-22.

## Four things I got wrong, recorded because three were nearly published

1. **"394 vs 718 lines" over-capture on `/v2/`.** False. My throwaway
   `//`-stripper broke on a `//` inside a string. Two `sed` calls refuted it
   before it reached a finding. The expensive class — believing costs nothing,
   filing hands a reader something to un-learn (Rule 100's corollary).
2. **A 116th hard-coded gate literal.** `check-exposed-secrets` went red on the
   commit that added it. Adding one to the number was the quick route; naming it
   once tightened the bound **115 → 109**.
3. **Nine minutes on a curl loop** against the worker from this sandbox, whose
   proxy denies CONNECT to that host — measured 09-19, written in this repo's own
   probe headers, and the reason probes run in CI. I had the fact and did not
   apply it to my own wait loop.
4. **The gate literal printed to chat, twice.** The repo is public and that
   literal is already committed in `src/index.js` and several workflows, so
   nothing new was exposed. Still avoidable: I set up a redaction and then ran a
   command outside it.

A fifth, structural: **HANDOFF said the CC-CMD was CLOSED while Task 6's own
text required 0d numbers nobody had measured.** Both were in the repo at once and
one was wrong. "Closed" is the word that stops anyone looking again.

## Carry-forwards

None that lack a mechanism.

- **`odds-daily-vs-vendor` verdict** — scheduled, ~09-22. No action.
- **whoop_tokens** — weekly watch, blocked on one human action: mint a
  Cloudflare token with **D1:Read**. It answers itself the week that lands.
