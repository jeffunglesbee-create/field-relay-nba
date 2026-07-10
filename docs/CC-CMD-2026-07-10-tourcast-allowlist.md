# CC-CMD: Add tourcast.pgatour.com to the relay browser-rendering allowlist

**Date:** 2026-07-10
**Repo:** field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

Confirmed live tonight: the relay's browser-rendering capability
(exposed via the FIELD Handoff MCP tools `browser_navigate`/
`browser_quick`/`browser_interact`) is real and working — a screenshot
action against `espn.com` returned a genuine rendered PNG. This is
Cloudflare's managed Browser Rendering, not a locally-run binary — no
download dependency, unlike the June 28 Playwright script that was
never runnable due to an unrelated sandbox network restriction.

The only blocker to running the June 28 TourCast probe (find whether
PGA Tour's own live broadcast tool exposes shot-position data via its
own XHR/fetch calls) through this already-working infrastructure is a
domain allowlist, currently: "ATS sites (iCIMS, Workday, Greenhouse,
Lever, Taleo, SuccessFactors), cloudflare.com, espn.com, FIELD app."
`tourcast.pgatour.com` is not on it. Confirmed separately tonight that
the domain itself is reachable (a raw request gets a 403 from PGA
Tour's own bot detection, not a network-level block) — a real browser
render is exactly what the June 28 doc anticipated would be needed to
get past that.

**Scope discipline: add the domain, do not build the probe logic in
this pass.** This CC-CMD's job is making the target reachable. The
actual probe (navigate, wait for XHR/fetch, inspect for coordinate
fields) is follow-up work once this lands and can be verified.

## PROBE BLOCK

```bash
git log --oneline -5

grep -rn "ATS sites\|iCIMS\|Workday\|Greenhouse\|allowlist" src/ --include="*.js" | head -20
# Find the actual allowlist definition backing browser_navigate/
# browser_quick — confirm its real current structure before editing.
```

## TASK 1 — Add the domain

Add `tourcast.pgatour.com` (and, if the probe shows the allowlist is
checked by full domain rather than subdomain-flexible matching, also
consider whether `pgatour.com` broadly is warranted — but default to
the narrowest addition, just the one subdomain actually needed, unless
the probe shows a reason to go wider). Match the existing allowlist's
current format and structure exactly — don't restructure it in this
pass.

## TASK 2 — Live verification

Call `browser_quick` (screenshot action, matching tonight's proven-
working pattern) against `https://tourcast.pgatour.com/` through the
actual deployed tool, not just confirm the code change looks right.
Report what comes back — a real render, a further error, or evidence
the page requires interaction (e.g. a cookie-consent gate) before
useful content loads. Any of these outcomes is fine to report; the
requirement is a real, observed result, not a code-level assumption
that adding the domain is sufficient on its own.

## DONE CONDITIONS

- [x] `tourcast.pgatour.com` added to the real allowlist, format
      matching existing entries
- [x] Live-verified via an actual `browser_quick` call post-deploy,
      real result reported (success, further error, or interaction
      requirement) — not assumed from the code change alone

## CONFIDENCE SCORING

- +40 — domain correctly added, matching existing allowlist structure
- +30 — live-verified via a real deployed call, not local reasoning
- +30 — actual observed result reported honestly, whatever it turns
  out to be

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-10-tourcast-allowlist.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
