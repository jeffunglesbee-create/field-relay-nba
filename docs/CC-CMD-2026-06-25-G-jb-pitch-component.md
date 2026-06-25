# CC-CMD G: jubilant-bassoon — BSD Live Pitch Component
**Date:** 2026-06-25 · **Repo:** jubilant-bassoon (NOT field-relay-nba) · **Sequence:** After field-relay-nba CC-CMDs A→F + `/bsd/contract` shipped (HEAD `e49debf`). · **Rule 87:** Self-completing.

---

## WHAT THIS ADDS

A pitch SVG overlay on WC game views that renders:
- **Live ball position** (animated dot, ~5s tick from BSD WebSocket via AmbientDO SSE)
- **Shotmap** (per-shot xG circles, post-game or in-running)
- **Average player positions** (player labels at avg coords)

Activation gate: `game.bsdEventId` is set (relay's `handleV2Games` populates it
when BSD has the fixture in its live pool — CC-CMD-F).

All data flows are already shipped relay-side:
- REST: `/bsd/events/:id/shotmap`, `/bsd/events/:id/average-positions`
- SSE: `/live/ambient` emits `bsd:ball` and `bsd:stats` events
- Subscribe: `POST /ambient/bsd/subscribe { event_id }`
- Unsubscribe: `POST /ambient/bsd/unsubscribe { event_id }`
- **Coord contract:** `GET /bsd/contract` (single source of truth — fetch once on app load, cache 5min)

---

## CONTRACT (read from `/bsd/contract`, do NOT hardcode)

```json
{
  "coordinateSystem": {
    "space": "normalized-pitch",
    "xRange": [0, 100],
    "yRange": [0, 100],
    "origin": "home-team-defending-goal-line, bottom-left corner",
    "axes": { "x": "0 = home goal, 100 = away goal", "y": "0 = bottom touchline, 100 = top" }
  },
  "transformReference": {
    "toScreenSVG": "cx = x * width / 100; cy = (100 - y) * height / 100",
    "mirrorForAwayPerspective": "x = 100 - x; y = 100 - y"
  }
}
```

Status field on contract is `provisional` — first live game tonight may
require an axis flip. Build the transform util on top of the contract so
swapping is a one-line patch.

---

## PROBE BLOCK

```bash
# 1. Confirm relay contract endpoint is live
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/contract | jq '.coordinateSystem'
# Expected: {space, xRange, yRange, origin, axes, sampleRate}

# 2. Confirm AmbientDO subscribe endpoint is live (POST-only — expect 400 on GET)
curl -X POST https://field-relay-nba.jeffunglesbee.workers.dev/ambient/bsd/subscribe \
  -H 'Content-Type: application/json' -d '{"event_id":"test"}'
# Expected: {ok:true, subscribed:"test"} (sandbox-side will get 503 if no BSD token,
#   but the route itself must exist)

# 3. Find the WC game view component
grep -rn "bsdEventId\|wc26" src --include='*.{ts,tsx,js,jsx}' | head -10

# 4. Confirm SSE listener exists (AmbientDO ambient channel)
grep -rn "/live/ambient\|EventSource" src --include='*.{ts,tsx,js,jsx}' | head -5
```

---

## TASK 1 — Coord transform util + contract fetch

Create `src/lib/bsd-pitch.js` (or .ts):

```javascript
// BSD pitch coordinate transform. Reads the live contract from the relay
// on first use, then memoizes. If the relay's contract `status` flips from
// `provisional` to `verified` (or the axes change), reload the page —
// the contract is fetched once per session.

let _contractCache = null;
async function getBSDContract() {
    if (_contractCache) return _contractCache;
    try {
        const r = await fetch('https://field-relay-nba.jeffunglesbee.workers.dev/bsd/contract');
        if (r.ok) _contractCache = await r.json();
    } catch (_) {}
    // Fallback contract — matches the relay default. Keep in sync if
    // the relay default changes (it shouldn't, since the relay IS the source).
    return _contractCache || {
        coordinateSystem: { xRange: [0,100], yRange: [0,100] },
        transformReference: { toScreenSVG: 'cx = x * w / 100; cy = (100 - y) * h / 100' },
    };
}

// Transform BSD pitch coords (0-100, 0-100) → SVG cx/cy.
// width/height are the SVG viewBox dimensions in pixels (or viewBox units).
// awayPerspective: when true, mirrors so the rendering team always attacks
// left-to-right (useful for showing both sides from "their" view).
function bsdToScreen({ x, y }, { width, height, awayPerspective = false } = {}) {
    let px = x, py = y;
    if (awayPerspective) { px = 100 - px; py = 100 - py; }
    return {
        cx: (px * width) / 100,
        cy: ((100 - py) * height) / 100,
    };
}

export { getBSDContract, bsdToScreen };
```

---

## TASK 2 — Pitch SVG component

Create `src/components/BSDPitch.jsx` (or .tsx):

```jsx
import { useEffect, useState, useRef } from 'react';
import { bsdToScreen } from '../lib/bsd-pitch';

// width/height in viewBox units. Pitch is 105×68 meters in real life;
// we use 100×100 normalized so coords map 1:1 to viewBox.
const W = 100, H = 100;

export function BSDPitch({ bsdEventId, ballFrame, shots = [], avgPositions = [] }) {
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="bsd-pitch">
            {/* Background */}
            <rect x="0" y="0" width={W} height={H} fill="#0d4d2a" />
            {/* Halfway line */}
            <line x1={W/2} y1="0" x2={W/2} y2={H} stroke="#fff" strokeWidth="0.4" />
            {/* Center circle */}
            <circle cx={W/2} cy={H/2} r="9.15" fill="none" stroke="#fff" strokeWidth="0.4" />
            {/* Penalty boxes */}
            <rect x="0" y="21" width="16" height="58" fill="none" stroke="#fff" strokeWidth="0.4" />
            <rect x={W-16} y="21" width="16" height="58" fill="none" stroke="#fff" strokeWidth="0.4" />

            {/* Average positions */}
            {avgPositions.map((p, i) => {
                const { cx, cy } = bsdToScreen({ x: p.x, y: p.y }, { width: W, height: H });
                return (
                    <g key={`avg-${i}`}>
                        <circle cx={cx} cy={cy} r="2" fill="rgba(255,255,255,0.4)" />
                        <text x={cx} y={cy - 3} fontSize="2" fill="#fff" textAnchor="middle">
                            {p.player?.split(' ').pop()}
                        </text>
                    </g>
                );
            })}

            {/* Shots */}
            {shots.map((s, i) => {
                const { cx, cy } = bsdToScreen({ x: s.x, y: s.y }, { width: W, height: H });
                const r = 1 + (s.xg ?? 0.1) * 5;        // size by xG
                const fill = s.result === 'goal' ? '#fb923c' : 'rgba(251,146,60,0.3)';
                return <circle key={`shot-${i}`} cx={cx} cy={cy} r={r} fill={fill}
                               stroke="#fff" strokeWidth="0.2" />;
            })}

            {/* Live ball */}
            {ballFrame?.coords && (() => {
                const { cx, cy } = bsdToScreen(ballFrame.coords, { width: W, height: H });
                return (
                    <circle cx={cx} cy={cy} r="1.4" fill="#facc15"
                            stroke="#fff" strokeWidth="0.3">
                        <animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite" />
                    </circle>
                );
            })()}
        </svg>
    );
}
```

CSS (or styled-component):
```css
.bsd-pitch {
    width: 100%;
    max-width: 600px;
    aspect-ratio: 1;            /* viewBox is square */
    border-radius: 8px;
    background: #0d4d2a;
}
```

---

## TASK 3 — Live ball subscription hook

Create `src/lib/use-bsd-live.js`:

```javascript
import { useEffect, useState, useRef } from 'react';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';

// Subscribe to live BSD ball/stats frames for a given event_id.
// Manages: POST /ambient/bsd/subscribe on mount, SSE filter on event_id,
// POST /ambient/bsd/unsubscribe on unmount. Returns latest ball + stats frames.
export function useBSDLive(bsdEventId) {
    const [ballFrame, setBallFrame] = useState(null);
    const [statsFrame, setStatsFrame] = useState(null);
    const esRef = useRef(null);

    useEffect(() => {
        if (!bsdEventId) return;
        let cancelled = false;

        // 1. Subscribe relay-side
        fetch(`${RELAY}/ambient/bsd/subscribe`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id: bsdEventId }),
        }).catch(() => {});

        // 2. Open SSE if not already open
        if (!esRef.current) {
            esRef.current = new EventSource(`${RELAY}/live/ambient`);
        }
        const es = esRef.current;
        const onBall = (e) => {
            if (cancelled) return;
            try {
                const d = JSON.parse(e.data);
                if (String(d.id) === String(bsdEventId)) setBallFrame(d);
            } catch (_) {}
        };
        const onStats = (e) => {
            if (cancelled) return;
            try {
                const d = JSON.parse(e.data);
                if (String(d.id) === String(bsdEventId)) setStatsFrame(d);
            } catch (_) {}
        };
        es.addEventListener('bsd:ball', onBall);
        es.addEventListener('bsd:stats', onStats);

        return () => {
            cancelled = true;
            es.removeEventListener('bsd:ball', onBall);
            es.removeEventListener('bsd:stats', onStats);
            // Unsubscribe relay-side (others may still subscribe to other games on same SSE)
            fetch(`${RELAY}/ambient/bsd/unsubscribe`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event_id: bsdEventId }),
            }).catch(() => {});
        };
    }, [bsdEventId]);

    return { ballFrame, statsFrame };
}
```

---

## TASK 4 — Wire into WC game view

Find the existing WC game view component (the one that consumes
`/v2/games?sport=wc26`). Add a "Live Pitch" tab visible only when
`game.bsdEventId` is set.

```jsx
import { BSDPitch } from './components/BSDPitch';
import { useBSDLive } from './lib/use-bsd-live';

function WCGameView({ game }) {
    const { ballFrame, statsFrame } = useBSDLive(game.bsdEventId);
    const [shots, setShots] = useState([]);
    const [avgPos, setAvgPos] = useState([]);

    useEffect(() => {
        if (!game.bsdEventId) return;
        fetch(`https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/${game.bsdEventId}/shotmap`)
            .then(r => r.ok ? r.json() : null)
            .then(d => setShots(d?.shots || d?.results || []))
            .catch(() => {});
        fetch(`https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/${game.bsdEventId}/average-positions`)
            .then(r => r.ok ? r.json() : null)
            .then(d => setAvgPos(d?.average_positions || d?.results || []))
            .catch(() => {});
    }, [game.bsdEventId]);

    if (!game.bsdEventId) {
        return <div className="muted">Live pitch unavailable for this match.</div>;
    }

    return (
        <section>
            <BSDPitch bsdEventId={game.bsdEventId}
                      ballFrame={ballFrame}
                      shots={shots}
                      avgPositions={avgPos} />
            {statsFrame?.stats && (
                <div className="bsd-stats">
                    xG: {statsFrame.stats.home_xg?.toFixed(2)} – {statsFrame.stats.away_xg?.toFixed(2)}
                    {' · '}Pos: {Math.round((statsFrame.stats.possession_home ?? 0) * 100)}%
                </div>
            )}
        </section>
    );
}
```

---

## TASK 5 — Smoke

Manual verification when Ecuador @ Germany (20:00 UTC tonight) goes live:
- `/v2/games?sport=wc26` includes `bsdEventId` on the Ecuador/Germany game
- Opening the WC game view in browser subscribes (network tab: POST `/ambient/bsd/subscribe`)
- SSE stream shows `bsd:ball` events flowing
- Ball dot animates on the pitch
- xG stats update every ~30s

If the dot appears on the wrong side, the axes need flipping. Two-line fix in
`bsd-pitch.js`: set `awayPerspective: true` by default OR change the relay's
`/bsd/contract` to swap the axis description (then bump `revision`).

---

## DONE CONDITIONS

- [ ] `src/lib/bsd-pitch.js` exists with `getBSDContract` + `bsdToScreen`
- [ ] `src/components/BSDPitch.jsx` exists
- [ ] `src/lib/use-bsd-live.js` exists with `useBSDLive` hook
- [ ] WC game view conditionally renders `<BSDPitch>` when `game.bsdEventId`
      is set
- [ ] Subscribe POST fires on mount, unsubscribe POST fires on unmount
      (network tab confirmation)
- [ ] No console errors when `game.bsdEventId` is undefined (defensive guard)
- [ ] Hardcoded coord transforms grep zero hits — all goes through `bsdToScreen`

## COMMIT (in jubilant-bassoon)

```bash
git add src/lib/bsd-pitch.js src/lib/use-bsd-live.js src/components/BSDPitch.jsx \
        <WC game view file>
git commit -m "feat(wc): BSD live pitch — ball tracking + shotmap + avg positions"
git push origin main
```

---

## CROSS-REPO NOTE (Rule 70)

This CC-CMD assumes field-relay-nba HEAD ≥ `e49debf` (the commit that ships
`/bsd/contract`). All other relay infrastructure (events/shotmap/momentum
routes, AmbientDO subscribe routes, bsdEventId enrichment) shipped earlier
this session — verified live via probe_relay_route. If any relay endpoint
returns 404 to the client, check the relay deploy is current via
`/deploy/verify`.
