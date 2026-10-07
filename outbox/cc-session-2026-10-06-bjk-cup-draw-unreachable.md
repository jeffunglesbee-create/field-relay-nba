# CC session 2026-10-06 — the BJK Cup draw nobody could reach

> **This repo's copy.** Identical to
> `jubilant-bassoon outbox/cc-session-2026-10-06-bjk-cup-draw-unreachable.md`.
> The work spans both repos and the relay's share is `e351a92` — the probe's
> copies of the client's lists — so Rule 67's session doc has to exist here too
> rather than only where the client change landed.

**Repos:** jubilant-bassoon (client), field-relay-nba (the probe's copy of the
client's lists)
**HEAD progression (client):** `8ff506e7` → `6af0ffbb` → `c90694a4` (gate's A190
auto-fix) → `8213bc50` → `9555e6d4`

**SHA correction:** this doc first cited `9837e4cb` and `1c661787` for the last
two commits. Both were rewritten by the rebase that landed them — four other
workflows had pushed to main in the meantime — and the published SHAs pointed at
nothing. Corrected to `8213bc50` and `9555e6d4`. The lesson is the one this repo
already writes down about copies: a SHA recorded before the push is a prediction,
not a reading.
**HEAD progression (relay):** `b5f37d2` → `e351a92` → `399cd5a` (the run's own
artifact)
**Smoke:** 1055 passed, 0 failed (was 1055/0 before; A-TDRAW-16 and A-TDRAW-17
were rewritten rather than added)
**SW_VERSION:** `2026-09-22b` → `2026-10-06a`
**Confidence:** 96
**Credits spent at the Odds API vendor:** 0

---

## What this started as

`tennis-tier-ladders.yml` appeared as a genuinely NEW entry in the 2026-10-06
dead-cron watch. One run-log read was the plan.

It is not a dead cron. It is a detector whose red is its output, it is NOT in
`docs/declared-detectors.json`, and it had been reporting the same real finding
once a week for three weeks with a committed artifact each time:

```
2026-09-14  success   clientSplitDrift: []
2026-09-21  failure   "Billie Jean King Cup (509) now serves 2 main-draw match(es)
                       but the client excludes it by name — a real draw nobody can reach"
2026-09-28  failure   same, now 7 matches
2026-10-05  failure   same, 7 matches
```

The draw model held 41 of 41 editions on every one of those runs. The only
finding was the cross-repo one — which is the single thing this probe exists for,
because the lists live in one repo and the truth lives in another.

## The finding, confirmed from the deployed route today

| | 391 United Cup (client ADMITS) | 509 BJK Cup (client EXCLUDED) |
|---|---|---|
| category | `other` | `other` |
| mainDrawMatches | 7 | 7 |
| rounds | QF=4 SF=2 F=1 | QF=4 SF=2 F=1 |
| p1/p2 | nations (Poland, USA, …) | nations (Ukraine, Czechia, …) |
| rank | `null` on every entry | `null` on every entry |
| sets | `null` on every node | `null` on every node |
| edges | 6, one clean tree | 6, one clean tree |
| anomalies | `[]` | `[]` |

Indistinguishable in structure. Admitting one and hiding the other was a name,
not a decision.

The client's own comment predicted this: *"If BSD ever serves a Davis Cup
knockout under the seven-round vocabulary, this line is what has to change, and
it is findable."* It happened to the senior BJK Cup rather than the Davis Cup,
and that line is what changed.

`508` BJK Cup Group I (130 matches, 0 main-draw rounds) and `446` Davis Cup
(0 main-draw rounds) stay excluded, on the measurement rather than the habit.

## What changed

**jubilant-bassoon `6af0ffbb`** — two edits, both load-bearing:

1. `_TENNIS_DRAW_NO_BRACKET`: `/^(Davis Cup|Billie Jean King Cup( Group I)?)$/`
   → `/^(Davis Cup|Billie Jean King Cup Group I)$/`. The optional group is gone,
   so the name must now match in full.
2. `_TENNIS_DRAW_NAMED_RANK`: `'Billie Jean King Cup': 2` added. Rank 2 is the
   United Cup's, the same shape of event.

Both confirmed necessary by mutation (7/7 names, both edits caught when
reverted individually). A third mutation — dropping Group I from the regex —
**changes no output on any of the seven names**, because Group I has no rank
either and `rank == null` skips it one line later. Rather than leave a dead
mutation passing, the comment now records that both remaining regex arms are a
*second* lock and the first is `rank == null`; the regex's value is being a
named decision rather than a null-rank accident, which is what its original
comment already said.

The 2026-09-06 census in the comment block is **amended, not deleted.** It was
true when it was read.

`smoke.js` A-TDRAW-16 and A-TDRAW-17 both pinned the old literals and moved
with the change, each carrying why.

**field-relay-nba `e351a92`** — the probe's `CLIENT_ADMITS` / `CLIENT_EXCLUDES`
copies follow. Verified against the real committed reading, not a constructed
one: on `outbox/tennis-tier-ladders-2026-10-05T12-12-11-646Z.json` the old lists
produce exactly one drift line and the new lists produce none.

**jubilant-bassoon `8213bc50`** — `codemap.yml`'s bare `git push` joins the
repo's retry convention. See "What went wrong" below.

## Done condition — met on a real run

`tennis-tier-ladders.yml` run **9** (`workflow_dispatch`, `per_tier: 1`,
`e351a92`): **success**, artifact committed as `399cd5a`.

```
 "modelHeld": 14, "editionsRead": 14, "interiorHoles": [], "unread": [],
 "edgeRuleViolations": 0, "clientSplitDrift": []
withKnockout:    209 ATP Finals (3) | 509 Billie Jean King Cup (7) |
                 4 Next Gen Finals (3) | 391 United Cup (7) | 204 WTA Finals (3)
withoutKnockout: 508 Billie Jean King Cup Group I (0) | 446 Davis Cup (0)
```

First green since 2026-09-14. **Coverage: `perTier: 1`, so 14 editions of the
42 a `perTier: 5` run reads.** The split check lives entirely in the named-event
loop, which reads all 7 named events regardless of `perTier`, so the done
condition is fully covered — but the tier sampling is thinner than the weekly
run's and the artifact records `perTier: 1` where the result is read.

Deployment: `deploy-gate.yml` on `6af0ffbb` went green including step 26,
*"Confirm — assert the LIVE site actually serves this deploy."* That step is the
artifact that the live bundle carries this change; the gate's SW_VERSION is
asserted against the live page, not against the repo.

## What went wrong, and what caught it

**1. SW_VERSION in UTC instead of ET.** I set `2026-10-07a`; ET was
2026-10-06 21:07. `deploy-gate.yml`'s A190 auto-fix step re-dated it to
`2026-10-06a` across `sw.js`, `src/legacy/field.js` and `index.html` and pushed
`c90694a4`. No drift resulted — the auto-fix runs inside the deploy job, so the
bundle that shipped already carried the corrected value, and that is why its
commit carries the skip directive. Cost: zero.

**2. Edited index.html's SW_VERSION instead of field.js's.** `index.html`'s
script block is a copy; `src/legacy/field.js:23274` is the source. The sync step
restored the copy and `sync-source.mjs`'s divergence guard then refused to run
at all, correctly. *Is this the source, or a copy of the source* — asked and
answered by a guard rather than by me.

**3. The pre-commit hook was not installed in this clone.** `.git/hooks/pre-commit`
did not exist, so the first commit passed without smoke, units or lint. Installed
as a symlink to `scripts/pre-commit`; defects 1 and 2 were both found by running
it by hand, which is the only reason they were found before the push.

**4. `codemap.yml` went red on `6af0ffbb`, and it was not the code map.** Its
commit step ends in a bare `git push` — the only committing workflow in this
repo without the rebase-and-retry loop. The A190 auto-fix pushed 41 seconds
later, the push was rejected non-fast-forward, and the job failed having
generated `CODE_MAP.json` and thrown it away. Its 7 prior runs were green
because nothing else happened to push in that window; the auto-fix lands on
every deploy-triggering commit, so this was a race it would keep losing. Fixed
in `8213bc50` with the convention every sibling workflow uses, plus
deploy-gate.yml's `merge-base --is-ancestor` guard — a `for` loop whose body is
a failing `&&` list exits 0 under `bash -e -o pipefail`, so without that guard a
dropped artifact reports as a green step. Positive and negative controls both
run.

**5. The first attempt at control 4's harness pushed to a non-bare clone** and
reported FALSE ALARM on a guard that was working. Re-run against a bare remote:
the guard fires on an unlanded commit and stays quiet after a real push. A
harness that misreports is worse than no harness.

## Open, not done

- **`tennis-tier-ladders.yml`'s client lists are still literals copied from
  another repo**, and the comment now says so where they are declared. A client
  change nobody mirrors leaves this run red forever against a stale copy; a
  change made only here is invisible. Reading jubilant-bassoon's source — it is
  a public repo — is the fix and is deliberately not in these commits.
- **`chrome-inventory.yml` has failed on every run since 2026-09-13** (67 runs
  total, 8 most recent all red) and is not declared. The same check passes as
  step 22 *inside* `deploy-gate.yml`, so this is the standalone workflow, not
  the check. Untouched and uninvestigated here.
- **`tennis-tier-ladders.yml` is still undeclared** in
  `docs/declared-detectors.json`. It is green now, so there is nothing to
  declare — but the next real finding will read as a dead cron again for three
  weeks before anyone looks. Declaring a currently-green detector is the wrong
  shape; the dead-cron watch's grace window is the thing that let three weekly
  reds pass as newness.
- **`drift-sentinel.yml`** (field-laboratory) remains the other carried entry in
  the dead-cron watch, from 2026-10-06.
