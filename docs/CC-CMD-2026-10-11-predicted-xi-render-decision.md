# Claude Code Command — how a PREDICTED XI may be drawn, and by whom

**Date:** 2026-10-11
**Repo:** jubilant-bassoon or field-laboratory — the decision is which, and that is Task 1
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** D then C — a display decision first, then one renderer
**Status:** DONE 2026-10-11. Four tasks, four done conditions. Built in
**field-laboratory** — that was Task 1 and the reason is recorded beside the
code in `src/Lineups.fs`. Session doc:
`field-laboratory/outbox/cc-session-2026-10-11-predicted-xi.md`.

**TASK 1 — field-laboratory. Five measurements, taken before the decision.**

1. The client is NOT a blank slate: `src/legacy/field.js` already renders a
   Lineups section from `PL_RELAY_BASE/match/{id}` — the Premier League's own
   `fixture.teamLists`, published about an hour before kickoff and confirmed by
   definition. Its rows are `#shirt POS Name` with no qualifier, so a BSD
   predicted XI placed there would be this document's own opening claim, word
   for word.
2. It collapses every non-answer to one outcome — `if (!starters.length)
   continue;` and `anchor.remove()` on any failure. Task 3 forbids exactly that,
   so its failure handling would have to be replaced, not extended.
3. The laboratory already carries the refusal Task 3 needs at the type level:
   `type ProbablePitcher = private ProbablePitcher of string`.
4. **Only the laboratory can satisfy done condition 2 today.** It renders from
   committed captures pinned by a query parameter; the client fetches PL live on
   page load with no fixture path.
5. It is already a BSD consumer (`RELAY_DRAW`) and already renders the
   probable-starter row this feature is the soccer equivalent of.

Nothing is built in jubilant-bassoon.

**THE TWO STATES ARE BOTH CAPTURABLE, which done condition 2 needed and nobody
had established.** `bsd-lineups-probe.yml` runs `38118474339` / `38151345923` /
`38151411240`:

```
pre-match events, 2026-10-11 06:34Z   predicted  8 of 8   beta true
pre-match events, 2026-10-11 15:27Z   predicted  8 of 8   beta true
finished events,  2026-10-10          confirmed  3 of 3   beta false
```

Sixteen pre-match observations nine hours apart never said `confirmed`; three
finished events never said anything else. So `confirmed` is captured from a
PLAYED event and `predicted` from an unplayed one, and neither fixture is
hand-made — which `data/PROVENANCE.md` and `scripts/capture-render-fixture.mjs`
both forbid.

**TASK 2 — the mark is a column, twenty-two times a side, and the numbers are
sealed.** A per-card badge does not survive a row being cropped, quoted or read
aloud; a per-row word means the two sheets differ on every line. The colour is
the redundant channel (`Palette.Semantic.Caution`), never the primary one.

This document's reasoning about `ai_score` needed correcting, and the bytes did
it. The KEYS `confidence` and `ai_score` are present on a confirmed sheet; every
VALUE is null — `confidence` null/null, `ai_score` 0 of 22 populated, against
0.791/0.85 and 22 of 22 at 0.411–0.87 on the predicted one. They do discriminate.
They are still not rendered: `SealedScore` has no formatter, because the observed
interval can be stated and what the number MEASURES cannot.

**TASK 3 — there are FIVE non-answers, not three.** `X-Lineup-State` carries
`status-unrecognised:<word>`, which this document does not name and which is the
dangerous one: a renderer built to three falls through on the fourth, and falling
through draws the sheet. `Lineups.Answer` has seven cases. Measured on the
rendered page: five routed bodies, five distinct `data-answer` values, five
distinct sentences, no grid on the three that carry no players.

**TASK 4 — beside the XI.** 7 of 7 named players carry a non-null reason across
both captures. Rendering it beside the sheet exposed a contradiction in the
vendor's own confirmed payload: **Idan Toklomati is in Charlotte FC's starting
eleven AND listed injured**. The page now reports it and resolves nothing.

**Stop conditions held.** No cron, no watch, no diff-on-change — and
`scripts/check-lineups-pull-only.mjs` plus two mutations keep it that way after
this diff.

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
