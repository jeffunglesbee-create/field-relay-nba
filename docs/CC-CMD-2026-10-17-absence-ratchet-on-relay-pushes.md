# Claude Code Command — run the absence-collapse ratchet on relay pushes

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba
**Confidence gate:** >= 95 before any commit
**Filed:** 2026-10-17 by CC, as the second CC-CMD Rule 87.4 requires, from
jubilant-bassoon `docs/CC-CMD-2026-10-16-absence-collapse-ratchet.md`
**Status:** NOT STARTED — not dispatched.

## Why

jubilant-bassoon `758447c6` made `scripts/check-absence-collapse.mjs` a ratchet
over BOTH repos, with one baseline per repo in jubilant-bassoon
`docs/absence-collapse-baseline.json` (field-relay-nba: flagged 332,
suppressed 18, at `0dcd504`). It runs in jubilant-bassoon's CI only.

So a relay commit that adds a collapse is NOT red at the relay commit. It turns
jubilant-bassoon's next push red, in a repo the relay author was not working
in. The ratchet catches it, at the wrong place and the wrong time.

## The decision this needs (owner)

Whether a relay push should be gated by a baseline that lives in another
repo. Two options, both without copying the script:

1. **Relay `guards.yml` clones jubilant-bassoon at `main`** and runs its script
   with both roots and its baseline. A relay rise is red at the relay commit;
   the fix is still a bump in jubilant-bassoon's baseline (cross-repo).
2. **Move the relay's half of the baseline into this repo** and teach the
   script to take one baseline per root. A relay rise is red here and bumped
   here. This changes the script's interface, so it needs jubilant-bassoon's
   deploy-gate and smoke-static updated in the same session (Rule 70).

## Probe first

```
git -C ../jubilant-bassoon log --oneline -3 -- scripts/check-absence-collapse.mjs docs/absence-collapse-baseline.json
node ../jubilant-bassoon/scripts/check-absence-collapse.mjs ../jubilant-bassoon "$PWD" \
  --require=src/legacy/field.js --require=field-relay-nba/src/index.js \
  --baseline=../jubilant-bassoon/docs/absence-collapse-baseline.json
```

The relay root must be passed as an absolute or named path whose basename is
`field-relay-nba`. Passing `.` labels sites `./src/...`, and the
`field-relay-nba/src/index.js` require then misses.

## Done condition

A relay push that adds `await res.json() || []` to a new file under `src/` is
red in a relay workflow run, with `RATCHET FAILED: field-relay-nba flagged
[|| []]` in its log; with the file removed, the same workflow is green.
Run ids recorded in `outbox/`.
