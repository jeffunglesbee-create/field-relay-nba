# cc-session-2026-08-08-followup-closeout

Closes every loose end named in `cc-session-2026-08-08-efl-carabao-cup-coverage.md`
under "Adjacent findings, deliberately not acted on". Instruction was
"Automate follow-ups. No fallbacks, only fixes."

## 1. Two vacuous assertions in `live-deploy-verify-probe.yml` — FIXED

jubilant-bassoon `a8fa38ce`, then generalized in a later commit.

- **SW_VERSION grep never matched.** Pattern was
  `SW_VERSION=\{0,1\}['\"]`, which permits no whitespace around `=`
  while the source reads `SW_VERSION = '...'`. Proven locally before
  pushing: old pattern **NO MATCH**, new pattern → `SW_VERSION = '2026-08-08b'`.
- **My own EFL Cup label grep** (`section: *'EFL Cup'`) returned NOT
  FOUND on run 31278050296. That was my assertion being wrong, not the
  feature: the pipeline runs esbuild + strip-comments, so unminified
  spacing cannot survive.

Then replaced both per-competition greps with an enumeration — every
`eng.*` slug and the cup labels as sorted sets — so the next cup needs
no workflow edit.

**Artifact**, run 31279094554, live site HTTP 200 / 1,943,602 bytes:
```
--- SW_VERSION ---
SW_VERSION = "2026-08-08b"
--- EFL Cup label in the deployed bundle ---
"EFL Cup"
```
Both previously printed nothing. Same defect class as STRUCTURAL 7 and
the soccer label contract check: green checks asserting nothing.

Still-open finding I did not fix and am not claiming to have: the
`NFL_DRAMA_PROFILES` grep in the same file uses BSD-style `\{0,1\}`
against GNU grep and reports NOT FOUND, while the loose search two
blocks down finds `var NFL_DRAMA_PROFILES = { "ARI": 42.7, ...`. The
feature is present; that specific assertion is also vacuous. It is
pre-existing and outside what I was closing out.

## 2. `deploy-gate.yml` Confirm step asserted nothing — FIXED

jubilant-bassoon `406edd87`. The step used to `echo "Deployed $SHA"`, so
a green deploy-gate proved only that wrangler exited 0. It now curls the
live URL and greps for the exact version string this run stamped, with a
6×10s retry for propagation, and **fails** (not warns) otherwise.

Matches the literal version string, not the `SW_VERSION` identifier,
precisely because of finding 1.

**Artifact**, dispatch run 31278907316:
```
NEW_VERSION: 2026-08-08b
Asserting live site serves SW_VERSION 2026-08-08b
✅ Deployed 406edd872991acc3d4284761e6442e19a26c9083 — live site
   confirmed serving 2026-08-08b (attempt 1)
```

## 3. SW-Bump bot — REMOVED, not repaired

`.github/workflows/sw-version-bump.yml` deleted. It was the generator of
the 2026-08-08 drift incident (commit 739ff868 on main for 922 minutes
at SW_VERSION 2026-08-08a while the live site served 2026-08-06a).
Three defects, each read out of the file itself:

1. It `sed`s `index.html` and `sw.js` and never touches
   `src/legacy/field.js`, which CLAUDE.md names the only correct edit
   target and which `sync-source.mjs` rewrites `index.html` from.
   Observed state before this session: field.js `2026-08-06a`,
   index.html/sw.js `2026-08-08a` — so the next legitimate sync would
   have dragged index.html **backward**.
2. It commits with the default `GITHUB_TOKEN`, which by GitHub's design
   does not trigger `push` workflows. deploy-gate therefore never fires
   for its commits: it stamps a version that never ships. That *is* the
   drift, not a symptom of it.
3. It is redundant. deploy-gate's "Sync SW_VERSION to deploy date" step
   already stamps ET date into sw.js + field.js + index.html on every
   deploy and (as of finding 2) asserts the live site serves it.

Removed rather than repaired because fixing (1) leaves (2), and fixing
(2) needs a PAT to add a scheduled deploy that (3) says is unnecessary.
SW_VERSION exists to bust the service-worker cache on deploy; bumping it
without a deploy has no function.

## 4. EFL Trophy (`eng.trophy`) — SHIPPED both halves

Relay `feat: EFL Trophy (eng.trophy) coverage — relay half`; client
paired commit, SW_VERSION `2026-08-08c`. Relay deployed first (Rule 70).

Slug probed at execution time via CF-Worker egress rather than taken
from the prior session's note: id `18481`, `"2026-27 EFL Trophy"`, Group
Stage, first fixture 2026-08-18T18:00Z. Label `'EFL Trophy'` is
sponsor-neutral (currently the Bristol Street Motors Trophy; previously
Freight Rover / Sherpa Van / Autoglass / LDV Vans / Johnstone's /
Checkatrade / Leasing.com / Papa John's) — the label persists into the
archive `sport` column and leads the archive id, so a sponsor rename
would fragment ids the way `CC-CMD-2026-07-15-wc-label-fragmentation`
had to clean up for WC26. `bsdLeagueId: null` because no BSD id was
verified.

**Artifacts:**
- Label contract check run locally *before* pushing — the commitment
  made after `96d41ea` broke that check: labels 18, routed 18,
  `uncovered=[]` (both were 17 pre-edit).
- Break gate verified by **executing** `isDomesticLeagueInBreak` over
  five dates spanning the competition, not by reasoning about the
  substring match: `'EFL Trophy'` → false on all five, with
  `'Bundesliga'` on 2026-08-18 → true as positive control.
- smoke: 965 passed, 0 failed.
- Relay live, `/v2/games?sport=efltrophy&date=2026-08-18` → HTTP 200,
  `count: 6`, `"league":"EFL Trophy"` — the chosen label, not the raw
  key, not WC. Sample: Barnet v Arsenal U21, The Hive Stadium,
  `"round":"EFL Trophy, Group Southern Group F"`.
- Client bundle: `eng.trophy` present in the deployed output (probe
  enumeration, this session).

## 5. FA Cup (`eng.fa`) — second CC-CMD written, deliberately not shipped

`docs/CC-CMD-2026-08-08-fa-cup-coverage.md`.

Not deferred work — a real external block with a stated unblock
criterion (Rule 74). Probed 2026-08-08:
```
eng.fa  -> id 3918, season { year: 2025, "2025-26 English FA Cup",
                             type: "Final" }, events: []
eng.trophy -> season { year: 2026, "2026-27 EFL Trophy",
                       type: "Group Stage" }, real fixtures
```
The distinguishing fact is not that `events` is empty for a future round
— for the FA Cup ESPN's *league season object itself* is still the
finished 2025-26 season. ESPN has not rolled the competition over.
Wiring it now would ship a permanently-empty section with no way to
verify end-to-end (Rule 61) and no way to confirm the emitted label.
Unblocked when the probe reports `season.year >= 2026`; every
verification task in that CC-CMD names its artifact.

## Sandbox note

`curl` to ESPN from this sandbox returns
`curl: (56) CONNECT tunnel failed, response 403` — the proxy blocks
those hosts, in addition to the known `*.workers.dev` block. All ESPN
probes above went through `html_probe` (CF-Worker egress) and all relay
probes through `probe_relay_route`. Recorded because it is the third
distinct egress restriction found this session and the reason the
CI-as-proxy pattern keeps being necessary.
