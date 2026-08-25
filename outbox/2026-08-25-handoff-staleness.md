# HANDOFF had zero mentions of today, after ten commits

**2026-08-25.**

`CLAUDE.md`'s session protocol opens with **"Read HANDOFF.md first"**. That
document was dated 2026-08-24 while ten substantive commits had landed on the
25th — a deleted workflow, three new deploy gates, a credential removal, two
odds CC-CMDs. A session following the protocol exactly would have seen none of
it.

Nothing noticed, because a document going stale produces no error.

## The close-out is written

`HANDOFF.md` now carries **2026-08-25**, `9f6bbbb` → `ccc39ce`, deploys 875 and
876, and the four gates the day added.

## `scripts/check-handoff-current.mjs`

A deploy gate. Reads the newest `**HEAD:** \`a\` → \`b\`` line and the newest
`## SESSION CLOSE-OUT — YYYY-MM-DD` heading, and compares them against what has
actually landed.

### It measures DAYS, not commits, and the first version proved why

The first version failed above 25 unrecorded commits. Run against this morning's
state it reported the ten commits by name — and **PASSED**. A guard that cannot
fail on the case that motivated it is a claim, not a guard.

Lowering the count bar is not the fix either. Set it low enough to catch a day
of unwritten work and it fires partway through a busy session, which is how a
check gets deleted.

The real defect is work landing on one day and the close-out never being
written, so the question is how OLD the unrecorded work is. One day of grace: a
session's own same-day commits never trip it; work still unrecorded tomorrow
does. Verified both directions — a close-out dated two days before the oldest
unrecorded commit exits 1 and names it.

Housekeeping is excluded. `chore:`, `status:` and `[skip ci]` commits are 11 of
the 21 this repo produced today, and counting Drive syncs as unrecorded work
would make any threshold fire on noise.

### The shallow-clone case is a warning, deliberately

`deploy.yml` checked out at `fetch-depth: 25`. This repo produced **21 commits
on 2026-08-25 alone**, so 25 is under a day — a one-day-old handoff would fall
outside the checkout entirely.

When the sha HANDOFF names is not in the checkout, a shallow clone and a
rewritten history are indistinguishable. That state prints a `::warning::`
saying the lag is a **lower bound, not a count**, and that staleness was NOT
verified this run. It does not fail, because failing on the first case would
turn a normal CI checkout red.

`fetch-depth` is raised to **200** so the case is rare rather than routine. That
is the number that decides whether this check can verify anything at all, and
the workflow comment now says so where the old `# git log -20` note was.

Same three-state discipline field-laboratory's `docs/history-boundary.txt`
records for its own history check, and for the same reason: a local count over
a fraction of history is meaningless and must never be printed as a fact.

## Verify

```
node scripts/check-handoff-current.mjs --self-test   # 10 cases, no git needed
node scripts/check-handoff-current.mjs               # against real history
```
