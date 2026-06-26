# CC-CMD: Post-Match Pitch Map STEP 2 (jubilant-bassoon client)
**Date:** 2026-06-26 · **Repo:** jubilant-bassoon · **Rule 87:** Self-completing.
**File:** `index.html`

> Parent CC-CMD: `docs/CC-CMD-2026-06-26-B-postmatch-pitch-map.md` (field-relay-nba).
> STEP 1 (relay) shipped in commit `a322a7c` + unblocker `6081d3d`. This is STEP 2.

---

## WHAT THIS DOES

When the user opens the bottom sheet for a **completed** WC game that has a
`bsd_event_id`, fetch its captured shotmap from R2 via the relay and render the
existing `bsd-pitch` SVG canvas with shot bubbles sized by xG. Live games are
already handled; this fills the post-game gap.

The relay route `/bsd/r2/read?key=bsd/wc26/{bsdEventId}/stats.json` is live:
returns the full BSD stats payload including `shotmap[]` array (verified
against bsdEventId=8346 → 25 shots, each with `xg`, `pos:{x,y}`, `gm:{x,y,z}`,
`body`, `type`, `home`, `min`).

---

## PRE-BUILD PROBES

```bash
cd /home/claude/jubilant-bassoon && git pull

# 1. Confirm relay /bsd/r2/read is live (run from a network-enabled box)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/bsd/r2/read?key=bsd/wc26/8346/stats.json" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('shotmap entries:', len(d.get('shotmap', [])))"
# Expected: shotmap entries: 25

# 2. Find bottom sheet open handler / pitch rendering
grep -n 'openBottomSheet\|bsd-pitch\|_bsdRepaint\|_bsdShotData' index.html | head -30

# 3. Confirm there's already a `g.state === 'live'` branch that renders the pitch
grep -n -B1 -A3 'bsdEventId' index.html | head -40

# 4. Confirm V2_RELAY_BASE or equivalent base URL constant
grep -n 'V2_RELAY_BASE\|RELAY_BASE' index.html | head -5
```

Expected: probe 1 must succeed (relay STEP 1 is live). If it fails, STOP — STEP 1
needs to be redeployed. Probes 2-4 inform the exact insertion point.

---

## TASK — Add post-game shot map fetch in bottom sheet

Find `openBottomSheet()` (or equivalent function that renders the WC game card
in the bottom sheet). Locate the live-game pitch branch (one that uses
`_bsdShotData` / `_bsdBallPos` / `_bsdRepaint`).

After the live-game branch, add a post-game branch:

```js
// Post-game shot map from R2: completed WC game with bsd_event_id has its
// shotmap captured to R2 (bsd/wc26/{id}/stats.json) by runBSDEndgameCapture.
// Fetch via relay /bsd/r2/read and render the same bsd-pitch SVG canvas the
// live branch uses (no extra DOM scaffolding needed).
if ((g.state === 'post' || g.state === 'final') && g.bsdEventId) {
  const _r2Key = `bsd/wc26/${g.bsdEventId}/stats.json`;
  const _relay = (typeof V2_RELAY_BASE !== 'undefined') ? V2_RELAY_BASE : '';
  fetch(`${_relay}/bsd/r2/read?key=${encodeURIComponent(_r2Key)}`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d?.shotmap?.length) return;
      _bsdShotData = d.shotmap;
      _bsdBallPos  = null; // no live ball post-game
      _bsdRepaint();
    })
    .catch(() => {});
}
```

If the existing live-game branch HIDES the `bsd-pitch` div behind a check like
`if (isLive)` / `if (g.state === 'live')`, lift the div render out of that
conditional so it's always present for WC games — both live and post.

---

## DONE CONDITION

- [ ] `node smoke.js` or whatever the client smoke is — count unchanged
- [ ] Open bottom sheet for a completed WC game that has `bsdEventId` set
      (e.g. recent Ecuador@Germany, Iceland@Curaçao, or one of the June 26 finals)
- [ ] `bsd-pitch` SVG canvas renders with shot bubbles (size proportional to xG,
      home/away color-coded)
- [ ] No JS console errors
- [ ] No regression on live games (existing live-branch still updates pitch)

---

## SCOPE BOUNDARY

DO:
- `index.html` only
- One commit: `feat(bsd): post-game pitch map from R2 in bottom sheet`

DO NOT:
- Modify `_bsdRepaint()` internals (it already handles the data it's given)
- Modify any relay code (STEP 1 already shipped)
- Add new dependencies or build steps
- Compute editorial commentary on the shotmap (Rule 47 — that's client analytic,
  display only)

---

## NOTES

- Relay R2 key suffix is **`.json`** (verified via `/bsd/r2/list`). The parent
  CC-CMD's `?key=bsd/wc26/8346/stats` example was missing the suffix — use
  `${g.bsdEventId}/stats.json` here.
- R2 cache TTL on the route is 1 hour (`Cache-Control: public, max-age=3600`).
  Post-game data is immutable, so the cache is safe.
- If a completed game has no `bsdEventId` (BSD enrichment missed it), the fetch
  is silently skipped — the bottom sheet still renders without the pitch.
- For pre-June 25 completed games, R2 may not have stats — those games
  pre-date `runBSDEndgameCapture` (4b9ea318). Test on a post-June-25 final.
