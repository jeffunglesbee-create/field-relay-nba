# The verification for a STAGED item that has waited six weeks

**2026-08-27** · `scripts/cfb-first-slate-check.mjs`,
`.github/workflows/cfb-first-slate.yml`

## The sentence this exists to execute

Drive, *"FIELD — Sports Data Infrastructure, 2026-07-15"*, its opening line:

> **Status: All pieces done and verified, except `cfb-curatedrank-relay`'s
> downstream consumer chain, which is staged but not yet live-tested against a
> real slate (season doesn't start until Aug 29).**

Rule 74 (STAGED-GATE-A) requires a staged feature to document what is staged,
what blocks it, what unblocks it, and **the exact commands that verify it when
the block lifts**. Three of four were written. The fourth has been a sentence in
a Drive doc for six weeks. The block lifts on **2026-08-29**, in two days.

## Two things unblock on the same slate

**The seed row.** `c52f496` (2026-08-27) added CFB to the journalism cron's
`LEAGUES` table with label `'CFB'`. Before it, `/context/date` had never carried
a college game. The label was declared in that commit before any row was
written, because the archive writes `sport: gm.league` and a label chosen after
the fact orphans rows already there.

**The curatedRank chain.** `adaptESPNFootball` forwards ESPN's real
`curatedRank.current` → `mapV2ToESPN` threads `homeCuratedRank`/`awayCuratedRank`
→ `injectV2SportSection` builds the section → `buildRankBadge` renders the `#N`
poll badge. Every link was tested against forced or historical data. None against
a live slate, because none existed.

field-laboratory's `Sport.CFB` (`cb1c051`, same day) makes a third consumer of
the same label.

## Why `curatedRank` present is not `curatedRank` working

ESPN sends `curatedRank.current = 99` for an unranked team. **99 is a real
number** — finite, present, and meaning "not ranked". A check asserting the field
exists passes on a slate where every team is 99, which is the vacuity failure
this repository has now found four times in one day.

So the assertion is: at least one competitor carrying a rank **1–25**. A slate
with none reports `NOT OBSERVABLE` and exits non-zero rather than green.

## The label assertion, stated as the wrong answers

`CFB` present is one check. The more useful one distinguishes *missing* from
*differently spelled*: if the archive carries `"College Football"` or `"NCAAF"`
instead, the run names the string it found and says the label was declared as
`"CFB"` and the archive disagrees. A missing label and a misspelled one are
different failures and must not report identically.

## DELETE-BY

**This workflow should be deleted or narrowed once it has answered.** It exists
for a question that stops being open the moment a green run records the first
CFB rows under the declared label with a real rank on the slate. A cron left
running past its question is the waste pattern audited in jubilant-bassoon
`outbox/cc-session-2026-08-16-scheduled-workflow-audit.md`.

Concretely: after the first PASS, the daily schedule should come off and the
standing coverage question passes to `seed-coverage.yml`, which already checks
every seeded competition with fixtures reaches the archive — CFB included as of
today. Two workflows asking one question is one too many.

## First meaningful run

**2026-08-30, 16:00 UTC**, reading the 2026-08-29 slate. It checks *yesterday* by
default so the cron has had a full day of 15-minute ticks to seed. Runs before
then will report `NOT OBSERVABLE` — no CFB events on ESPN — which is the correct
answer and not a pass.
