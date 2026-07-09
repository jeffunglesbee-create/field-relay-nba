# CC-CMD: Close the client-emitted-types quality gate gap

**Date:** 2026-07-09
**Repo:** jeffunglesbee-create/jubilant-bassoon (sole) — **NOT field-relay-nba**.
This file was authored from a field-relay-nba session that does not have
jubilant-bassoon in its repo scope, so it's staged here instead of in the
target repo. A session with jubilant-bassoon write access must execute it.
**Branch:** main — commit directly, do not create a feature branch or PR
(matching this CC-CMD family's established convention; adjust if
jubilant-bassoon's actual branch policy differs — confirm via that
repo's own CLAUDE.md/STANDARDS.md before assuming this holds).

## CONTEXT

field-relay-nba's `runQualityChain`/`scoreProse`
(`src/journalism-quality.js`) is a 7-layer quality gate — cliché
detection, sport-vocabulary contamination, generic-lead detection, stat
verification, score-contradiction detection, cross-league hallucination
detection, and a score-threshold rewrite (layer 3b, just made
dimension-targeted and fixed for a retry-budget starvation bug,
2026-07-08) — that every relay-driven journalism generation path runs
through (10 call sites in `src/index.js`).

**jubilant-bassoon has a separate, real, still-live implementation of
part of the same scoring logic — confirmed, not assumed:**
- `jubilant-bassoon/CODE_MAP.json` lists `scoreProse` (line 26755) and
  `computeTemporalPrecision` (line 26636) as real, present functions.
  `journalism-quality.js`'s own comments confirm the relay's versions
  were *ported from* / *mirror* these browser originals (`computeVoiceConsistency`
  is named explicitly too).
- `jubilant-bassoon/outbox/cc-journalism-gaps-client-2026-06-17.md`
  confirms this client-side `scoreProse()` is still actively called —
  "resolves asynchronously inside `fetchSeriesPreviewFromClaude` (via a
  `renderProseScore` sink)" — and explicitly states the gap this
  CC-CMD exists to close: *"the relay-side path captures quality for
  queue-routed types; client-emitted types accept the gap."*
- Searched jubilant-bassoon (GitHub code search, not a full file read)
  for `runQualityChain`, `layers_fired`, `"3b:"`, `maxRetries`,
  `hasCliche`, `checkSportVocab` — **zero matches for any of them.**
  This is evidence, not proof (code search is snippet-based, not
  exhaustive), but it's consistent with client-side `scoreProse()`
  being called to *compute and display/log* a score, not to *drive a
  retry-on-violation loop* the way the relay's `runQualityChain` does.

**What this means, if the evidence above holds up under direct
investigation:** for "client-emitted types," a generated brief with a
cliché, wrong-sport vocabulary, a cross-league hallucination, or a
score below threshold is scored (client already has the dimension math)
but nothing acts on a bad score — no retry, no correction, no rewrite.
The relay's 2026-07-08 fixes (starvation, dimension-targeting) do not
reach these paths at all, because they never touch the relay's
`runQualityChain` in the first place.

**Deliberately not pre-deciding the fix shape.** Two real options exist
and this doc does not assume which is correct without investigation:
1. Route client-emitted generation through a relay endpoint that calls
   the existing, already-fixed `runQualityChain` — avoids building a
   second, parallel retry chain that would need to be kept in sync with
   the relay's forever (the exact durability risk already named for the
   relay's own `_arcSubComponents`/`_voiceViolationDetail` helpers,
   2026-07-08 outbox).
2. Wire a client-side retry loop onto the scoring that already exists
   there (`scoreProse`, dimension breakdown per CODE_MAP) — avoids a
   network round-trip, keeps client-emitted types client-emitted for
   whatever original reason made them so.

**Whichever it is depends on facts this doc's author does not have**:
why these specific types are client-emitted at all (latency? no relay
context available at generation time? historical accident from before
server-side generation existed?), and whether a relay round-trip is
actually viable at their call site. TASK 1 exists to find out before
TASK 2 commits to an approach.

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "fetchSeriesPreviewFromClaude\|renderProseScore" index.html | head -30
# Find every client-emitted generation call site, not just the one the
# 2026-06-17 outbox doc happened to mention. Confirm the exact current
# count and names -- this doc's citation may be stale by the time this
# runs.

grep -n "function scoreProse\|function computeTemporalPrecision\|function computeVoiceConsistency" index.html
# Re-confirm these still exist at (approximately) their CODE_MAP line
# numbers -- CODE_MAP.json itself may be stale.

grep -n "hasCliche\|checkSportVocab\|hasGenericLead\|missingStats\|hasCrossSportHallucination\|runQualityChain\|maxRetries\|layers_fired" index.html
# Re-confirm zero matches (or find them, if this doc's GitHub-code-search-based
# finding was wrong) -- do not trust this doc's "zero matches" claim without
# re-running the search directly against current file content.

grep -n "qualityScore" index.html | head -20
# Find every consumer of the client's computed quality score -- confirm
# it really is display/log-only (as this doc infers) and never gates a
# retry, or find where it should but doesn't.

# In field-relay-nba (separate repo, for reference only -- do not edit
# it as part of this CC-CMD, this CC-CMD is jubilant-bassoon-scoped):
#   src/journalism-quality.js -- runQualityChain, scoreProse (opts.breakdown)
#   src/index.js -- the 10 runQualityChain call sites, for reference on
#     what a relay-routing endpoint's contract would need to look like
#     if TASK 1 finds relay-routing is the right approach.
```

## TASK 1 — Scope the gap precisely

Enumerate every client-emitted generation call site (every caller of
`fetchSeriesPreviewFromClaude` or equivalent — the probe's first grep
is a starting point, not assumed to be complete). For each, determine:
- Does it already check `qualityScore` against any threshold, or is
  the score purely computed-and-displayed/logged?
- Is a relay round-trip already happening at this call site for
  anything else (i.e., is the client already talking to
  field-relay-nba synchronously at this point), or would routing
  through the relay's quality gate require a *new* round-trip that
  doesn't currently exist?
- Why is this specific type client-emitted rather than relay-driven —
  check git blame / commit history / any design-decision codex/outbox
  entries for the original reasoning, don't guess.

Write the findings as a real inventory (call site, current behavior,
round-trip feasibility, original rationale if found) before choosing
between the two fix shapes in CONTEXT. If different call sites warrant
different answers, say so explicitly rather than forcing one uniform
fix.

## TASK 2 — Close the gap (shape determined by TASK 1's findings)

**If relay-routing is viable for some or all call sites:** add a relay
endpoint (or reuse an existing one if TASK 1's probe finds a suitable
candidate — check field-relay-nba's existing `/journalism/*` routes
before assuming a new one is needed) that accepts a draft + context and
returns `runQualityChain`'s result. Point the viable client-emitted
call sites at it. This is a cross-repo change — per this repo's own
Rule 70 (ATOMIC-A) equivalent if jubilant-bassoon has one, or by plain
correctness regardless: the relay-side endpoint and the client-side
caller must ship together, not as two independent, sequenced changes
where one lands without the other.

**If client-side retry is necessary for some or all call sites**
(genuine latency constraint, no round-trip tolerance, or TASK 1 finds
a real architectural reason relay-routing doesn't fit): wire the
*existing* client-side `scoreProse` output into an actual
retry-on-low-score loop, following the relay's own established pattern
(name the specific violation, give a specific correction — see
`src/journalism-quality.js`'s layer 2/2b/2c/2d/2d-score/2e/3b prompts
in field-relay-nba for the reference style, do not invent a new tone).
Do not port all 7 relay layers wholesale if the client only needs the
score-threshold rewrite (3b's equivalent) — scope this to what TASK 1's
inventory actually shows is missing, not a speculative full port.

**Whichever shape, or mix of shapes, TASK 1 lands on:** state the
decision and its reasoning explicitly in the outbox — this is a real
architectural fork, not a mechanical fix, and the reasoning matters as
much as the result for whoever reads this later.

## TASK 3 — Live verification

Construct a real test brief through whichever call site(s) were fixed,
deliberately weak in a way layer 3b (or its client-side equivalent)
should catch (e.g. a cliché, or a score below whatever threshold this
path uses). Confirm the fix actually intervenes — not that the code
runs without error, that a real violation gets a real correction, the
same evidentiary bar TASK 4 of the 2026-07-08 relay-side CC-CMD used
(all-seven-layers-fire test, two genuinely different targeted-prompt
cases, not asserted from code reading).

## DONE CONDITIONS

- [ ] Every client-emitted generation call site enumerated with real
      current behavior, not assumed from this doc's citation
- [ ] Fix shape (relay-routing vs. client-side retry vs. a mix) decided
      per call site based on TASK 1's actual findings, reasoning stated
- [ ] If relay-routing: field-relay-nba and jubilant-bassoon changes
      shipped together, not sequenced with a gap where one depends on
      the other not yet being deployed
- [ ] Real constructed test proves the fix actually intervenes on a
      genuine violation, for at least one representative call site
- [ ] Outbox states which call sites (if any) remain unfixed and why,
      rather than implying full closure if the fix only reached some

## CONFIDENCE SCORING

- +20 — call-site inventory complete and accurate, not assumed from
  this doc's citations
- +25 — fix shape decision is reasoned from TASK 1's actual findings,
  not defaulted to one option without justification
- +15 — if relay-routing chosen: cross-repo change shipped atomically,
  not left half-deployed
- +25 — real constructed test proves genuine intervention on a real
  violation, not just that code runs
- +15 — outbox honestly states scope of what was fixed vs. what (if
  anything) remains open

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q jubilant-bassoon || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-09-client-emitted-quality-gap.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
