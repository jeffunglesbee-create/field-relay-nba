# Claude Code Command — a second WebSocket sample, from a league the relay tracks

(The file name says "top-flight" from the first draft. Categoría Primera A, the first sample's league, is Colombia's top division, so the word named nothing. The selector is the league id list below.)

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba executes it (the BSD token is an Actions secret); the artifact is read by field-laboratory
**Filed:** 2026-10-28, by CC, from `docs/CC-CMD-2026-10-16-bsd-ws-frame-shape.md` (field-laboratory)
**Status:** FILED. An automated wake is set for 2026-10-28T11:20Z (see Task 1); nothing waits on a person.

---

## Related, read before building (BUILD-ON-A)

Searched 2026-10-28 by content (`websocket_plus`, `coordinates`, `league_ids`, `ws-frame`)
across `docs/CC-CMD-*.md` and `outbox/*.md` in both repos.

- `docs/CC-CMD-2026-10-16-bsd-ws-frame-shape.md` (field-laboratory): DONE on one
  match. Its done condition was met by the recorder and analyzer in
  `scripts/bsd-ws-capture.mjs`; its own verdict says "this match on this tier, not
  every match". This command is the second match it names. It undoes nothing.
- `docs/CC-CMD-2026-10-15-empowerment-metrics.md` Task 0.2 holds the owner's lock:
  "REJECTED for soccer ... Do not revisit for soccer without a new data source."
  This command does NOT reopen it. It records whether the one unread surface is a
  new source, which is the question the lock itself asks.

## Why a second sample

The first sample (event 602466, Categoría Primera A, `websocket_plus: true`) had
`coordinates: []` on all 14 of its livedata frames, and those frames were commentary
incidents. Categoría Primera A is outside the leagues this relay tracks (V2_LEAGUES
ids 1, 3, 4, 5, 7, 8). Whether a match in a tracked league carries ball or player
coordinates is not established by it. The league filter (`--league-ids`, workflow
input `league_ids`) exists so the next sample is not another untracked league.

## Probe block (run first, against HEAD)

```bash
git log --oneline -5
node scripts/bsd-ws-capture.mjs --self-test | tail -2
gh workflow view bsd-ws-capture.yml | head -5
```

## Task 1 — capture (automated; executed inside the wake, not by a person)

At the wake (2026-10-28T11:20Z), and again after each run that ends
`no-qualifying-event`, until a capture lands or 2026-10-29T00:00Z passes:

```bash
gh workflow run bsd-ws-capture.yml -f wait_minutes=340 -f duration_minutes=10 -f league_ids=1,3,4,5,7,8
```

League ids from `src/index.js` V2_LEAGUES: 1 EPL, 3 La Liga, 4 Serie A, 5 Bundesliga,
7 Champions League, 8 Europa/Conference. The run commits
`outbox/bsd-ws-frame-shape-latest.json` and `outbox/bsd-ws-frames-<event>-<time>.jsonl`
through `scripts/probe-commit-retry.sh`.

## Task 2 — record the result

Read the committed artifact. Before the new `latest.json` replaces the first sample's,
the first sample's artifact is preserved by its raw file
(`outbox/bsd-ws-frames-602466-*.jsonl`); copy its `analysis` block into
`outbox/bsd-ws-frame-shape-602466.json` first if it is still the file at
`bsd-ws-frame-shape-latest.json`.

The artifact must state, in its own printed `coverage` line, the event, league, frame
count and seconds. Then add one dated paragraph to
`field-laboratory/docs/CC-CMD-2026-10-16-bsd-ws-frame-shape.md` under "Second sample":
verdict, `coordinates` length distribution, identifier keys seen, `situation` values.

## Task 3 — settle the ball field (runs only on the result of Task 2)

Owner of the client mismatch recorded in `CONTRACTS.md` ("bsd:ball", Known mismatch) and
in `docs/CC-CMD-2026-10-28-bsd-ws-fanout-field-names.md` Task 3: jubilant-bassoon
`_bsdOnSSEFrame` stores the whole payload as `_bsdBallPos` and `_bsdRepaint` reads
`_bsdBallPos.x` / `.y`, while the relay sends `coords` (nested).

Read `analysis.coordinates.maxElements` in the new artifact:

- **above 0:** a coordinate element has been recorded. Declare its keys (copy them
  verbatim from `analysis.elementKeys`) in `/bsd/contract` `frameShapes.livedata` and in
  `CONTRACTS.md`, then align producer and reader in ONE change, relay first (Rule 70):
  the relay carries what the client reads, or the client reads `data.coords`. Edit
  `src/legacy/field.js` only, never `index.html`'s script block. Verify with
  `node scripts/check-bsd-ws-fanout.mjs` and a Playwright run per jubilant-bassoon
  Rule 90.
- **0:** record "the ball renderer stays dormant: no coordinate element in N livedata
  frames across M matches" in the artifact's session doc, and leave the mismatch STAGED
  with this CC-CMD's date. Do not edit the client.

## Done conditions

1. `outbox/bsd-ws-frame-shape-latest.json` has `state: captured`, `event.league_id`
   in `[1,3,4,5,7,8]`, and `analysis.verdict` set: assertion
   `node -e "const a=require('./outbox/bsd-ws-frame-shape-latest.json');console.assert(a.state==='captured'&&[1,3,4,5,7,8].includes(a.event.league_id)&&a.analysis.verdict)"`
   prints nothing and exits 0.
2. The first sample's analysis is preserved in `outbox/bsd-ws-frame-shape-602466.json`.
3. Task 3 is carried out in the branch Task 2's artifact selects, and the choice is
   written in the session doc.
4. If no listed-league match with `websocket_plus` is live before 2026-10-29T00:00Z, the
   artifact says `no-qualifying-event` with its poll count, and a fresh wake is set for
   the next day's first kickoff window. That is a genuine residual (the vendor has no
   such match), not deferred work.
