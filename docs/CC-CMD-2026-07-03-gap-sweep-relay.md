# Claude Code Command — Relay Gap Sweep + Public Solution Research

**Repo:** field-relay-nba only. **Branch:** main — research/documentation
task, no code changes. Commit the outbox manifest directly.

git pull. Read CLAUDE.md.

Write findings to outbox/cc-gap-sweep-relay-2026-07-03.md.

## CONTEXT

Real bugs found and fixed today in this repo (AmbientDO field mismatch
breaking live-tracking for every sport, BSD WebSocket frames silently
dropping shotmap/momentum, ADR-002 pointing at a superseded reference
implementation) were each found by accident while debugging something
else. A chat session then searched public GitHub for existing tools
matching each one *after* the fact — real, but bounded by whatever code
had already been read into that conversation's context, not a systematic
sweep of this repo's ~10,000+ lines.

CC has the full repo checked out and can grep every file for the same
gap *classes*, not just the instances chat happened to already see.

**Real gap-classes confirmed today in this repo, as search templates —
not an exhaustive list:**
1. Field-name mismatches between a real upstream API's response shape
   and what consuming code expects (AmbientDO's `_poll()`: `gameId` vs
   real `id`, flat vs nested `home`/`away`, `period` vs `periodNum`).
2. Silently dropped fields in a relay/broadcast layer (`_bsdOnFrame`
   never forwarding `shotmap`/`momentum` despite BSD's REST API having
   them as siblings of `stats`).
3. Stale documentation naming a superseded implementation
   (`ADR-002-CONTEXT.md` Step 5).
4. Config drift with no detection (observability/logging was disabled
   on this worker with nothing flagging it).

## PRE-BUILD PROBE (Rule 87)

```bash
grep -c "fetch(" src/*.js
```
Confirm a real, large count (this repo makes many real upstream calls —
each is a candidate for gap-class 1 or 2) before scoping the sweep.

## TASK 1: Field-name mismatch sweep

For every distinct upstream API this repo fetches (BSD, ESPN, Squiggle,
MLB Stats API, Odds API, CFL, NHLE, others found via the probe above),
identify every place in `src/*.js` that destructures or reads specific
field names from the response. For each, fetch the real, live endpoint
and diff the actual response shape against what the code assumes. Do
not trust an inline comment describing the shape as ground truth —
verify live. Flag every mismatch found, however small.

## TASK 2: Broadcast/relay field-completeness sweep

For every Durable Object or relay layer that receives data from one
source and forwards it to another (AmbientDO's BSD/ESPN polling and SSE
broadcast, GameDO, BracketDO, any WebSocket relay), confirm every field
a real downstream consumer reads is actually present in what the
producer sends. Cross-reference client-side consumption in
jubilant-bassoon's `index.html` (read-only — do not edit that repo from
this session) against what this repo actually broadcasts.

## TASK 3: Documentation staleness sweep

Grep all `docs/*.md` for named function, endpoint, or table references.
For each, confirm the named thing still exists with the described
behavior in current `src/*.js` — not just that the file or docs entry
exists. Flag anything referencing a function/pattern that has since been
superseded, renamed, or removed.

## TASK 4: For each real, confirmed gap — research public solutions

For every genuine finding from Tasks 1-3, search public GitHub for an
existing open-source tool solving that class of problem — prioritize
tools already built against the same real upstream API where one
exists (matching today's `roman-smith/oddsapi_ev` precedent: a real
match because it already speaks FIELD's actual data source, not a
generic tool needing adaptation). Report genuine misses honestly rather
than forcing a weak analog.

## TASK 5: Outbox manifest (last task)

Per gap-class: real instance count found (not estimated), which had a
public-repo match, which didn't after an honest search.
