# CC session — 2026-10-17 — absence-collapse ratchet gates relay pushes

CC-CMD: `docs/CC-CMD-2026-10-17-absence-ratchet-on-relay-pushes.md`, option 2.
Decision: owner, 2026-10-17, "go with Claude's best recommendations".
**HEAD:** `5914511` → `fea794c` (relay) · jubilant-bassoon `426d3f0e` → `e544e1e9` · Branch: main

## Why option 2

Option 1 left every relay rise to be bumped in jubilant-bassoon, a repo the
relay author is not working in. Option 2 puts each repo's baseline in that
repo: a relay rise is red at the relay commit and bumped here. jubilant-bassoon
still scans both repos in one invocation and reads this repo's baseline out of
the clone it already makes, so there is never a cross-repo bump.

## Commits, in deploy order (Rule 70)

| repo | commit | what |
|---|---|---|
| jubilant-bassoon | `d6ffa1f7` | `--baseline` repeatable; files merged; a repo in two files refused. Backward compatible. Ratchet self-test 12/12. |
| field-relay-nba | `fea794c` | `docs/absence-collapse-baseline.json` (332/18 at `5caec06`, identical to the relay half it replaces); `scripts/absence-collapse-ratchet.sh` clones jubilant-bassoon at main and runs its script (not a copy), mutation first; `deploy.yml` and `guards.yml` call it. |
| jubilant-bassoon | `e544e1e9` | its baseline now holds jubilant-bassoon only (98/0); both gates pass the relay's file from the clone; harness passes both. |

## Done condition — met in CI, without a bad commit on main

The CC-CMD asked for a relay push that adds a collapse to go red, then green
with it removed. The runner does exactly that inside every run instead: it
writes `src/__absence_mutation__.js` into the CI checkout, requires the
ratchet to fail naming it, deletes it, then runs for real. No defect is
committed to main to prove the gate.

guards.yml run 38995577172 and deploy.yml run 38995581387 (dispatched; same
code redeployed), both green:

```
check-absence-collapse.mjs from jubilant-bassoon d6ffa1f
mutation caught: RATCHET FAILED: field-relay-nba flagged [|| []] 205 > baseline 204. New site(s):
  field-relay-nba: flagged 332, suppressed 18
require OK: field-relay-nba/src/index.js flagged as || [] (field-relay-nba/src/index.js:2576)
ratchet OK: no op in field-relay-nba rose above /home/runner/work/field-relay-nba/field-relay-nba/docs/absence-collapse-baseline.json, flagged or suppressed
```

jubilant-bassoon smoke-and-verify run 38995908718 on `e544e1e9`: the ratchet
step green with both baselines; the harness's 7 mutations all caught locally
on the same tree (M1r = a relay rise against the relay's own file).

## To accept a genuine new site here

```
node <jubilant-bassoon>/scripts/check-absence-collapse.mjs "$PWD" \
  --require=field-relay-nba/src/index.js \
  --write-baseline=docs/absence-collapse-baseline.json
```

Run from a checkout directory named `field-relay-nba`, with the absolute path,
so sites are labelled `field-relay-nba/...` like the baseline keys.

## Known dependency

Both relay workflows clone jubilant-bassoon at main. A change to that script
is live here on the next relay run; a clone failure is red, with no fallback.

## Carry-forwards

None.
