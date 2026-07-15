# Claude Code Command — Investigate cross-sport team-name contamination in live Morning Report content

**Date:** 2026-07-15 (revised — original version of this CC-CMD had a wrong premise, corrected below, do not act on any cached/prior copy)
**Repo:** jeffunglesbee-create/field-relay-nba (sole — Morning Report is server-generated journalism, confirmed via client-side comments referencing `bundle.late`; this is a relay-side generation concern, not a client display bug)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/morning-report-cross-sport-contamination-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message. **High priority — a live, published, user-facing bug, not cosmetic.**

## CONTEXT — corrected premise, read carefully before starting

Fetched the real, live deployed app tonight (`https://jubilant-bassoon.jeffunglesbee.workers.dev`) and found the "Morning Report" journalism card (a Night Owl variant, real feature, server-generated) containing this text:

> *"...the Connecticut Sun narrowly edged out the Chicago Fire in a thrilling 90-87 contest that showcased true grit, while the Washington Mystics dominated the Tempo with a decisive 79-62 victory..."*

**An earlier version of this CC-CMD wrongly assumed "Chicago Fire" and "Tempo" were both fabricated/invented team names. That premise is wrong — do not investigate it as a hallucination question.** Verified directly: Toronto Tempo is a real, current WNBA franchise (the league's 14th team, first game May 8, 2026, real roster, real preseason games already played against Connecticut Sun in April 2026). Chicago Fire FC is a real, well-established MLS team — completely unrelated to WNBA.

**The real bug: a real MLS team name (Chicago Fire) is appearing inside what should be a WNBA game recap sentence, attributed a score (90-87) as if it played Connecticut Sun.** This is cross-sport data contamination, not invention — a specific, findable class of bug (wrong data source read at generation time, a shared variable overwritten between sequential sport processing, or context-window bleed between an MLS brief and a WNBA brief generated close together), not "the model made something up." "Tempo" itself may be entirely correct, or may have its own separate, real issue (e.g., a real Tempo game got the wrong opponent/score) — TASK 0 needs to check the Tempo sentence independently rather than assume it's clean just because the team name itself is real.

## TASK 0 — Probe

- Fetch the real, current Morning Report content again from the live app — confirm this is still reproducing.
- Find the real generation function (trace the client's `bundle.late` reference back to its actual relay-side source — likely within `handleJournalismCycle` or the newspaper-bundle assembly logic).
- Check the real timestamp and generation inputs for this specific bundle — was this WNBA brief's prompt/context genuinely built from real WNBA game data, or did something (a shared variable, a caching key collision, a loop-index bug) pull in MLS data instead partway through?
- Check whether any real Chicago Fire (MLS) game happened around this date with a score that could plausibly have leaked in — a real, findable source would confirm this is a genuine cross-contamination bug, not a coincidence.
- Independently verify the "Tempo... Washington Mystics... 79-62" sentence — check whether Toronto Tempo actually played Washington Mystics with this score, or whether this half of the sentence has its own separate accuracy problem.

## TASK 1 — Fix, scoped to what TASK 0 actually finds

Do not guess before TASK 0 completes. If this is a shared-variable/loop bug in multi-sport brief generation: fix the isolation between sequential sport processing. If this is a caching key collision: fix the cache key to be sport-specific, not just date/slot-specific. Whatever the real mechanism, the fix should prevent one sport's real data from ever appearing in another sport's generated text — a structural guard (e.g., validating that any team name in a generated brief belongs to the correct sport's real roster before publishing) is worth considering if the root cause doesn't have an obvious narrow fix.

## TASK 2 — Verify

Real, live re-check of the deployed app confirming the Morning Report (and any other affected briefs from the same root cause, if TASK 0 finds this isn't isolated to this one instance) now shows correct, real, correctly-attributed team names and scores for the actual sport being reported.

## DONE CONDITION

Root cause identified with real evidence (a specific, findable contamination mechanism, not "the model hallucinated"). Fix matches the confirmed cause. Live app verified showing correct content.

**Confidence scoring:**
- TASK 0 (50 pts): finds the real, specific contamination mechanism with evidence, independently checks both halves of the sentence rather than assuming Tempo's half is clean
- TASK 1 (30 pts): fix matches the confirmed root cause
- TASK 2 (20 pts): real live verification the deployed app now shows correct content

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
