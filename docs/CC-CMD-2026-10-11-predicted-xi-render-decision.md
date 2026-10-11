# Claude Code Command — how a PREDICTED XI may be drawn, and by whom

**Date:** 2026-10-11
**Repo:** jubilant-bassoon or field-laboratory — the decision is which, and that is Task 1
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** D then C — a display decision first, then one renderer
**Status:** FILED, not started.

**Required by Rule 87.4.** `docs/CC-CMD-2026-10-10-bsd-predicted-lineups.md`
closed with Task 5 reading *"nothing renders from this document... whether the
laboratory or the client draws a predicted XI is a separate decision with its
own CC-CMD, and the `beta` flag's display treatment is part of that decision."*
That document is this one. It is filed rather than deferred, because a
carry-forward with no document is a spec failure.

## What the relay now serves

`/bsd/events/{id}/lineups`, live at `src/index.js`, pure forward of BSD's shape.
Measured 2026-10-11 across 8 pre-match events, 9 calls
(`outbox/bsd-lineups-probe-latest.json`):

| | |
|---|---|
| `lineup_status` | `predicted` on **8 of 8** |
| `beta` | `true` on **8 of 8** |
| shape | `lineups.{home,away}` with `formation`, `confidence`, `team_id`, `team_name`, `players[]`, `substitutes[]` |
| per player | `id`, `name`, `short_name`, `jersey_number`, `position`, **`ai_score`** |
| `unavailable_players` | `{home,away}` lists; `reason` non-null on **22 of 23** named players (95.65%) |

Response headers carry the state so a renderer never has to infer it:
`X-Lineup-State` (`predicted` / `confirmed` / `status-absent` / `upstream-failed`),
`X-Lineup-Fill` (`served` / `served-empty` / `absent` / `null`),
`X-Lineup-Beta`, `X-Lineup-Updated-At`.

## THE DECISION, which is the whole document

**A predicted XI rendered identically to a confirmed one is a fabrication with
a team sheet's authority.** The vendor says so twice — `beta: true` on the
payload and an `ai_score` on every player — and this project has shipped
confident prose over soft inputs before, which is most of why
`src/journalism-quality.js` exists.

So the question is not whether to draw it. It is what the drawing must carry.

**Task 1 — decide the owner, and record why.** The client renders match pages;
the laboratory renders analysis. A pre-game XI is a match-page object, which
argues for the client — but `field-laboratory/src/Schedule.fs` already carries
the probable-pitcher row this feature is the soccer equivalent of, which argues
for the laboratory. Pick one and write the reason beside the code. Do not build
in both.

**Task 2 — the predicted treatment is not a badge in a corner.** State what
distinguishes a predicted XI from a confirmed one at a glance, and make it a
property of the row rather than a legend elsewhere on the page. `confidence`
and `ai_score` are in the payload; whether either is shown is part of this
decision, and showing a number without saying what it ranges over is its own
defect.

**Task 3 — the three non-answers must not render as a thin team sheet.**
`status-absent`, `served-empty` and `upstream-failed` are three different
things and none of them is "no lineup announced". A renderer that draws an
empty grid for all three tells the reader the same wrong thing three ways.

**Task 4 — `unavailable_players` is the part a brief can cite.** 95.65% of
named players carry a stated reason. That is a fact a scorer can check against
the row rather than echo from its prompt — the property
`journalism-quality.js`'s `marginAgreement` rebuild settled on. Decide whether
it renders beside the XI or only feeds prose.

## Stop conditions

- **No cron, no watch, no diff-on-change.** Rule A is not cleared. A lineup that
  changes an hour before kickoff is the single most notification-shaped object
  this feature introduces, and the relay deliberately serves it on pull only.
- Do not render a predicted XI without a treatment that distinguishes it. If
  Task 2 cannot settle one, STOP — shipping the grid and deferring the treatment
  is how the fabrication gets made.
- Do not reshape the relay's payload in the client. Rule 60: the relay owns the
  contract, and `lineup_status`, `beta`, `confidence` and `ai_score` are all
  carried deliberately.

## Done conditions

1. One owner, named, with the reason recorded beside the code.
2. A predicted XI is visually distinguishable from a confirmed one in a
   committed screenshot of each.
3. The three non-answers render as three different things, each stated.
4. No cron, no watch, no diff-on-change anywhere in the diff.
