# Claude Code Command — Investigate possible fabricated WNBA results in live Morning Report content

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (sole — Morning Report is server-generated journalism, confirmed via client-side comments referencing `bundle.late`; this is a relay-side generation concern, not a client display bug)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/morning-report-fabrication-check-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message. **This is the highest-priority item in this outbox — a live, published, user-facing data-integrity concern, not a cosmetic bug.**

## CONTEXT — real, live, unverified finding, treat with real caution

Fetched the real, live deployed app tonight (`https://jubilant-bassoon.jeffunglesbee.workers.dev`) and found the "Morning Report" journalism card (a Night Owl variant, real feature, server-generated) containing this text:

> *"...the Connecticut Sun narrowly edged out the Chicago Fire in a thrilling 90-87 contest that showcased true grit, while the Washington Mystics dominated the Tempo with a decisive 79-62 victory..."*

**"Chicago Fire" and "Tempo" are not real WNBA teams.** Chicago's WNBA franchise is the Chicago Sky. No WNBA team named "Tempo" exists as of this session. If this is genuinely fabricated content — invented team names and scores in published, user-facing journalism — this is a direct, live violation of this project's own foundational DO-NOT-INVENT discipline (Rule 2, established since the earliest sessions on this codebase), not a labeling inconsistency like the ones fixed elsewhere tonight.

**Do not assume this is fabrication without checking — investigate first, several real alternative explanations exist and must be ruled out before concluding this is a real fabrication incident:**
1. A genuine content-caching bug serving stale text from a much older date, when different (real, at the time) matchups existed — check whether "Chicago Fire" was ever a real placeholder/test name used earlier in this codebase's history, or whether this bundle's timestamp is stale.
2. A prompt-injection or context-corruption bug where the LLM was fed malformed or cross-contaminated context (e.g., a different sport's team names leaking into the WNBA prompt).
3. Genuine model fabrication — the LLM invented plausible-sounding content when its actual context was empty or insufficient, and nothing caught it before publish.
4. A test/fixture artifact that was never meant to reach production, accidentally serving on a live path.

## TASK 0 — Probe (do not skip, do not assume the cause)

- Fetch the real, current Morning Report content again from the live app — confirm this is still reproducing, not a one-time render glitch already self-corrected.
- Find the real generation function (`buildMorningReport`/equivalent — the client-side comment cites `bundle.late`, trace this back to its real relay-side source in `handleJournalismCycle` or wherever the newspaper bundle is actually built).
- Check the real timestamp on this specific bundle/brief — is this fresh (generated for today's actual slate) or stale (served from days/weeks ago, when different real matchups existed)?
- Check whether "Chicago Fire" or "Tempo" appear anywhere else in this codebase's history (test fixtures, old placeholder data, a different sport's team list that could have cross-contaminated) — a real, findable source would point to bug class #1/#2/#4 above, not genuine fabrication.
- Check the real prompt/context that was sent to the LLM for this specific brief — did it contain the real, correct WNBA matchup data, or was context missing/malformed at generation time?

## TASK 1 — Fix, scoped to what TASK 0 actually finds

Do not guess a fix before TASK 0 completes. If this is a stale-cache issue: fix the cache invalidation/serving logic. If this is context corruption: fix the data pipeline feeding the prompt. If this is genuine model fabrication with no context defect found: this needs a real, structural guardrail — e.g., validating generated team names against the real, known roster/schedule data before publishing, not just trusting LLM output — and likely warrants pulling this specific brief from production immediately while a proper fix ships, not leaving fabricated content live during investigation.

## TASK 2 — Verify

Real, live re-check of the deployed app confirming the Morning Report (and any other affected briefs from the same root cause, if TASK 0 finds this isn't isolated) now shows correct, real team names and scores. If a structural validation guardrail was added, a real forced test proving it would have caught this specific case.

## DONE CONDITION

The root cause is identified with real evidence, not assumed. If genuine fabrication, a real structural fix exists (not just this one instance patched) and the live app is confirmed showing correct content. This is treated with the seriousness a live data-integrity incident warrants.

**Confidence scoring:**
- TASK 0 (50 pts): real investigation ruling in/out each of the four hypotheses with actual evidence, not assumed
- TASK 1 (30 pts): fix genuinely matches the confirmed root cause, not a guess
- TASK 2 (20 pts): real live verification the deployed app now shows correct content

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
