# CC-CMD D: BSD WebSocket → AmbientDO Live Soccer Tracking
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Sequence:** After CC-CMD-A deployed + verified. · **Rule 87:** Self-completing.

## WHAT THIS ADDS

AmbientDO opens a persistent WebSocket to BSD for live soccer games.
BSD WS endpoint: wss://sports.bzzoiro.com/ws/live/?token=BSD_API_TOKEN
- Subscribe to live game event IDs
- Receive livedata frames (ball x/y every ~5s) and event frames (xG, possession, score every ~30s)
- Fan-out distilled momentum/ball-position updates to FIELD clients via existing AmbientDO SSE

This enables live visual features: Momentum Dial, Build-Up Cinema (from WOW list).
Cost: $3/month WebSocket subscription (already active).

Per Rule 47: AmbientDO fans out raw BSD frames. No editorial processing at relay.
Per ADR-002: The relay is dumb. Client interprets momentum, renders the pitch map.

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba

# 1. Confirm CC-CMD-A deployed (BSD REST live)
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live | jq '{count, events: [.events[]?.id] | .[:3]}'
# Expected: {count: N, events: [...]}

# 2. Find AmbientDO class
grep -n 'class AmbientDO\|export class AmbientDO' src/index.js
# Note line number

# 3. Find AmbientDO WebSocket handling
grep -n 'acceptWebSocket\|handleWebSocket\|webSocketMessage' src/index.js | head -10

# 4. Confirm NO BSD WS refs yet
grep -c 'bzzoiro.com/ws\|BSD.*WebSocket\|bsdWS\|_bsdSocket' src/index.js
# Expected: 0

# 5. Confirm BSdEventId is being tracked somewhere
grep -n 'bsdEventId\|bsdId' src/index.js | head -5
# Expected: 0 (first integration)
```

## TASK 1 — Add BSD WebSocket manager to AmbientDO

Find the AmbientDO class. Add these methods:

```javascript
// ── BSD WebSocket integration ─────────────────────────────────────────────────
// Opens a persistent WS connection to BSD for live soccer tracking.
// Subscription model: one socket, subscribe/unsubscribe per live game event_id.
// BSD sends: livedata (ball x/y ~5s), event (stats ~30s), odds (on change).
// We fan out only livedata + event frames — odds are handled by /bsd/events/:id/odds REST.

_bsdSocket = null;
_bsdSubscribed = new Set();
_bsdReconnectTimer = null;
_bsdToken = null;

async _bsdConnect(token) {
    if (this._bsdSocket?.readyState === 1) return; // already OPEN
    this._bsdToken = token;
    try {
        const [client, server] = Object.values(new WebSocketPair());
        // BSD uses outbound WS — Cloudflare DO can open outbound WebSockets
        this._bsdSocket = new WebSocket(`wss://sports.bzzoiro.com/ws/live/?token=${token}`);
        this._bsdSocket.addEventListener('open', () => {
            console.log('[AmbientDO] BSD WS connected');
            // Re-subscribe all known live game IDs
            for (const id of this._bsdSubscribed) {
                this._bsdSocket.send(JSON.stringify({ action: 'subscribe', event_id: Number(id) }));
            }
        });
        this._bsdSocket.addEventListener('message', (evt) => {
            this._bsdOnFrame(evt.data);
        });
        this._bsdSocket.addEventListener('close', () => {
            console.log('[AmbientDO] BSD WS closed — reconnecting in 15s');
            this._bsdSocket = null;
            this._bsdReconnectTimer = setTimeout(() => this._bsdConnect(this._bsdToken), 15_000);
        });
        this._bsdSocket.addEventListener('error', (e) => {
            console.error('[AmbientDO] BSD WS error', e.message);
        });
    } catch (e) {
        console.error('[AmbientDO] BSD WS connect failed:', e.message);
    }
}

_bsdOnFrame(rawData) {
    try {
        const frame = JSON.parse(rawData);
        if (!frame?.type) return;
        // Only fan out livedata (ball position) and event (stats) frames
        if (frame.type !== 'livedata' && frame.type !== 'event') return;
        const eventId = String(frame.event_id || '');
        if (!eventId) return;
        // Distill to minimal payload — clients don't need full frame
        const payload = frame.type === 'livedata'
            ? { type: 'bsd:ball', id: eventId, uts: frame.uts,
                coords: frame.coordinates?.slice(-1)[0] || null,
                situation: frame.situation }
            : { type: 'bsd:stats', id: eventId, minute: frame.minute,
                period: frame.period, score: frame.score, stats: frame.stats };
        // Fan out to all SSE clients watching this game
        const msg = `data: ${JSON.stringify(payload)}\n\n`;
        for (const [, session] of this._sessions || new Map()) {
            if (session.gameId === eventId || session.bsdId === eventId) {
                try { session.controller.enqueue(msg); } catch (_) {}
            }
        }
    } catch (_) {}
}

async _bsdSubscribe(eventId) {
    this._bsdSubscribed.add(String(eventId));
    if (this._bsdSocket?.readyState === 1) {
        this._bsdSocket.send(JSON.stringify({ action: 'subscribe', event_id: Number(eventId) }));
    }
}

async _bsdUnsubscribe(eventId) {
    this._bsdSubscribed.delete(String(eventId));
    if (this._bsdSocket?.readyState === 1) {
        this._bsdSocket.send(JSON.stringify({ action: 'unsubscribe', event_id: Number(eventId) }));
    }
    // Close socket if no more subscriptions
    if (this._bsdSubscribed.size === 0 && this._bsdSocket) {
        this._bsdSocket.close();
        this._bsdSocket = null;
    }
}
```

## TASK 2 — Add /ambient/bsd/subscribe endpoint

In the AmbientDO fetch handler, add a route for clients to request BSD subscription:

```javascript
// POST /ambient/bsd/subscribe { event_id: "12345", token: "..." }
if (url.pathname === '/ambient/bsd/subscribe') {
    const { event_id } = await req.json().catch(() => ({}));
    if (!event_id) return new Response('event_id required', { status: 400 });
    const token = env.BSD_API_TOKEN;
    if (!token) return new Response('BSD not configured', { status: 503 });
    await this._bsdConnect(token);
    await this._bsdSubscribe(event_id);
    return new Response(JSON.stringify({ ok: true, subscribed: event_id }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// POST /ambient/bsd/unsubscribe { event_id: "12345" }
if (url.pathname === '/ambient/bsd/unsubscribe') {
    const { event_id } = await req.json().catch(() => ({}));
    if (event_id) await this._bsdUnsubscribe(event_id);
    return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
```

## TASK 3 — Smoke assertions

```javascript
assert('AmbientDO BSD WS methods', src.includes('_bsdConnect') && src.includes('_bsdOnFrame') && src.includes('_bsdSubscribe'));
assert('AmbientDO BSD subscribe route', src.includes('/ambient/bsd/subscribe'));
assert('BSD WS URL', src.includes('wss://sports.bzzoiro.com/ws/live/'));
assert('BSD frame fan-out', src.includes("'bsd:ball'") || src.includes('"bsd:ball"'));
```

## DONE CONDITIONS

```bash
# 1. Smoke passes
node smoke.js 2>&1 | tail -3

# 2. BSD WS methods present
grep -c '_bsdConnect\|_bsdOnFrame\|_bsdSubscribe\|_bsdUnsubscribe' src/index.js
# Expected: ≥ 4

# 3. Subscribe route present
grep -c '/ambient/bsd/subscribe' src/index.js
# Expected: ≥ 2 (two routes: subscribe + unsubscribe)

# 4. diff check
git diff --stat
# Expected: src/index.js only
```

## COMMIT

```bash
git add src/index.js
git commit -m "feat(ambient): BSD WebSocket → AmbientDO live ball tracking fan-out"
git push origin main
```

## NOTE ON CLOUDFLARE WS OUTBOUND

Cloudflare DOs can open OUTBOUND WebSockets to external services.
The `new WebSocket(url)` syntax is available in CF Workers runtime.
AmbientDO already has `ctx.acceptWebSocket` for inbound — this is
separate outbound infrastructure. Hibernation will close the outbound
socket if AmbientDO hibernates; reconnect logic handles this.
