# CC-CMD-2026-09-15 — three red crons, one broken and two doing their job

Filed from the first run of `scripts/watch-silently-dead-crons.mjs`, which found
three active workflows failing their last three scheduled runs. **They are not
the same kind of red**, and the difference is the whole triage.

| workflow | red since at least | verdict |
|---|---|---|
| `odds-backfill.yml` | **2026-09-01** | **BROKEN** — `ODDS_API_KEY` empty, exits at its first guard |
| `brief-label-migration.yml` | **2026-08-31** | **by design** — a regression detector, reporting |
| `rule90-staleness-monitor.yml` | 2026-09-13 | **by design** — non-blocking, reporting |

Only the first is a defect. `CC-CMD-2026-09-15-odds-backfill-missing-api-key`
covers it and is blocked on the owner.

## brief-label-migration.yml — the detector is right

Verified by reading `scripts/brief-label-migration.mjs:399`, not inferred from
the red: `verify` exits 1 when `verification.clean` is false, and the comment
above it says so — *"a non-conforming value REAPPEARING means the code started
emitting one again, and that should be a failed run rather than silent
re-accumulation."*

Its own committed manifest names what is non-conforming:

| sport | brief rows |
|---|---:|
| EFL League Two | 24 |
| EFL League One | 23 |
| EFL Championship | 21 |
| College Football | 7 |

**75 rows, four labels.** `error: null`, `plan: []` — there is nothing it can
migrate, because the authority set is **read from the games table**
(`brief-label-migration.mjs:186-194`), not from a constant. A brief label is
non-conforming exactly when no game row carries that label.

So the question is not "add four strings to a list". It is which side is wrong:

- if those competitions are really archived, the **games** rows should carry the
  label and do not;
- if they are not, the **briefs** are labelled for competitions this archive does
  not cover.

`College Football` is the interesting one: `CFB` **is** in the authority set, so
that is one competition under two names — an alias problem, not a coverage
problem, and a different fix from the other three.

Unstarted. No write proposed here.

## rule90-staleness-monitor.yml — the detector is right, and it is about Rule 90

Four rule-registry entries marked `UNEXERCISED` past the 14-day threshold:

| entry | days |
|---|---:|
| rule-92 — Watch Engine WC selection, categorical tiers only | 65.8 |
| rule-93 — OTW momentum, score-event detector only | 65.8 |
| rule-94 — `_fieldDataReady` sentinel is a permanent contract | 65.8 |
| rule-98 — undocumented API integrations discipline | 43.6 |

`UNEXERCISED` is this repo's word for a rule with no mutation-proven check —
the thing Rule 90 exists to require. **This session leaned on Rule 90 all day
and wrote seven new mutation harnesses while four declared rules have had none
for two months.** Each needs a check that can be made to fail on purpose; that
is four separate pieces of work, not a batch.

Unstarted.

## The watch had to learn the difference

Left alone, `watch-silently-dead-crons.mjs` would report these two every day
forever — and a watch that cries wolf is exactly how `odds-backfill.yml` went
fifteen days unnoticed. `docs/declared-detectors.json` now names them, with the
condition each reports, why it is red today, and how that was verified.

**An entry there is not an excuse.** The watch still prints how long each has
been red, so a detector red for months stays visible rather than becoming
furniture, and the reason has to be written down — which is what makes silencing
a genuinely broken workflow visible in review.

## Tasks

1. Decide which side of the four `brief` labels is wrong — games rows missing
   the label, or briefs labelled for uncovered competitions. `College Football`
   is separable and probably an alias for `CFB`.
2. Four mutation-proven checks, one per UNEXERCISED rule-registry entry.
3. Keep `docs/declared-detectors.json` honest: an entry leaves when its
   condition clears, not when it gets annoying.
4. Outbox manifest.

## Done condition

`watch-silently-dead-crons.mjs` green with **zero** dead crons and **zero**
declared detectors — every detector green because its condition cleared, not
because it was listed.
