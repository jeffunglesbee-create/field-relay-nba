# Claude Code Command — BSD group_name + weather enrichment

`git pull && cat CLAUDE.md`

Write findings to `outbox/cc-bsd-group-weather-2026-06-26.md`.

---

## CONTEXT

Two low-urgency improvements from the BSD deep-analysis session (June 26 2026).

BSD `/api/v2/events/?date={date}&league_id=27` returns two fields per WC event
that FIELD doesn't use yet:

1. `group_name: "Group I"` — the exact group letter, already resolved.
   `extractWCGroup()` currently parses a round string that doesn't exist in the
   ESPN adapter (`round: ''`) and falls to the `_WC_TEAM_GROUP` name-lookup
   fallback. Using BSD's `group_name` directly as `game.round` makes
   `writeWCResult` use the primary (regex) path instead of the fallback.

2. `weather: {code, description, wind_speed, temperature_c}` — per-game
   conditions already on the BSD event. WC games are outdoor; weather affects
   play. Injecting it into the post-match journalism prompt gives the LLM
   factual context it currently lacks ("played in rain, 19°C").

Both come from the same BSD by-date fetch added in the ESPN branch. Zero new
API keys, zero new dependencies.

---

## PRE-BUILD PROBES

```bash
# 1. Confirm adaptESPNWCSoccer sets round: '' (primary extraction misses)
grep -n "round:" src/index.js | grep -i "espn\|wc\|''" | head -5

# 2. Confirm BSD by-date returns group_name and weather
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/by-date?date=$(date -u +%Y-%m-%d)&league_id=27" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
e=d.get('results',[])[0] if d.get('results') else {}
print('group_name:', e.get('group_name'))
print('weather:', e.get('weather'))
print('home_team:', e.get('home_team'))
print('event_date:', e.get('event_date'))
"

# 3. Confirm ESPN branch location and games = espnGames line
grep -n 'espnGames = (espnData.events' src/index.js

# 4. Confirm writeWCResult prompt array location
grep -n 'eventsContext,' src/index.js | head -5
```

---

## TASK 1 — Enrich ESPN games with BSD group_name and weather

In `src/index.js`, find the ESPN early-return block. After:
```js
        const games = espnGames;
```

Insert the following BSD enrichment block (before the existing BSD enrichment
that injects `bsdEventId`):

```js
        // ── BSD group_name + weather enrichment ──────────────────────────────
        // Fetches today's WC events from BSD by-date (league_id=27) and
        // matches to ESPN games by home team name. Injects:
        //   game.round    — "Group I" → extractWCGroup() uses regex path, not fallback
        //   game.weather  — {description, wind_speed, temperature_c} for journalism context
        // Non-blocking — failure leaves round='' and weather undefined; both degrade gracefully.
        if (env.BSD_API_TOKEN) {
            try {
                const _bsdDate = date; // YYYY-MM-DD
                const _bsdByDate = await fetch(
                    `https://sports.bzzoiro.com/api/v2/events/?date=${_bsdDate}&league_id=27`,
                    {
                        headers: {
                            'Authorization': `Token ${env.BSD_API_TOKEN}`,
                            'User-Agent': 'FIELD/1.0',
                            'Accept': 'application/json',
                        },
                        signal: AbortSignal.timeout(4000),
                    }
                );
                if (_bsdByDate.ok) {
                    const _bsdData   = await _bsdByDate.json();
                    const _bsdEvents = _bsdData.results || [];
                    const _normName  = s => String(s || '').toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]/g, '').slice(0, 8);
                    for (const _g of games) {
                        const _hNorm = _normName(_g.home?.name || '');
                        const _hit   = _bsdEvents.find(be =>
                            _normName(String(be.home_team || '')) === _hNorm ||
                            _normName(String(be.away_team || '')) === _hNorm
                        );
                        if (_hit) {
                            // group_name: "Group I" → round: "Group I" for extractWCGroup regex
                            if (_hit.group_name) _g.round = _hit.group_name;
                            // weather: {code, description, wind_speed, temperature_c}
                            if (_hit.weather)    _g.weather = _hit.weather;
                        }
                    }
                }
            } catch (_) {} // non-blocking — round/weather degrade gracefully
        }
```

---

## TASK 2 — Add weather to writeWCResult journalism prompt

In `src/index.js`, find `writeWCResult`'s prompt array (approx L1948):
```js
        const prompt = [
            FIELD_VOICE_REGISTER,
            `Write a 2-3 sentence post-match brief for this World Cup 2026 result.`,
            `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.`,
            `Include: key goalscorers with minutes, standout performances, what this means for the group.`,
            `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
            ``,
            `RESULT: ${homeName} ${homeScore} - ${awayScore} ${awayName}`,
            `Group: ${groupId}`,
            `Date: ${matchDate}`,
            matchupContext,
            standingsContext,
            eventsContext,
            ``,
            `SPORT BOUNDARY: This is a World Cup 2026 (soccer) match. Write ONLY soccer content. Do not reference players, stats, or terminology from any other sport. If context is empty, write from the score and date only.`,
            `Write the brief as a single paragraph. No headers, no bullet points.`,
        ].join('\n');
```

Replace with:
```js
        // Weather context from BSD event (injected by handleV2GamesESPNWC enrichment).
        // Only included when meaningful (rain / extreme wind / heat) — clear skies skipped.
        const weatherContext = (() => {
            const wx = game.weather;
            if (!wx) return '';
            const parts = [];
            if (wx.description && wx.description !== 'clear') parts.push(wx.description);
            if (wx.temperature_c != null && (wx.temperature_c >= 32 || wx.temperature_c <= 5))
                parts.push(`${Math.round(wx.temperature_c)}°C`);
            if (wx.wind_speed != null && wx.wind_speed >= 25)
                parts.push(`${Math.round(wx.wind_speed)} km/h wind`);
            return parts.length ? `Conditions: ${parts.join(', ')}` : '';
        })();

        const prompt = [
            FIELD_VOICE_REGISTER,
            `Write a 2-3 sentence post-match brief for this World Cup 2026 result.`,
            `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.`,
            `Include: key goalscorers with minutes, standout performances, what this means for the group.`,
            `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
            ``,
            `RESULT: ${homeName} ${homeScore} - ${awayScore} ${awayName}`,
            `Group: ${groupId}`,
            `Date: ${matchDate}`,
            matchupContext,
            standingsContext,
            eventsContext,
            weatherContext,
            ``,
            `SPORT BOUNDARY: This is a World Cup 2026 (soccer) match. Write ONLY soccer content. Do not reference players, stats, or terminology from any other sport. If context is empty, write from the score and date only.`,
            `Write the brief as a single paragraph. No headers, no bullet points.`,
        ].join('\n');
```

---

## TASK 3 — node --check + commit + deploy

```bash
node --check src/index.js

git add src/index.js
git commit -m "feat(wc): BSD group_name + weather enrichment in ESPN WC branch

TASK 1 — handleV2GamesESPNWC: parallel BSD by-date fetch (league_id=27)
  matches games by home team name (NFD-normalized, 8-char prefix).
  Injects game.round = BSD group_name ('Group I') so extractWCGroup()
  uses regex primary path instead of _WC_TEAM_GROUP name fallback.
  Injects game.weather = {description, wind_speed, temperature_c}
  for journalism context. Non-blocking; both fields degrade to existing
  behavior on failure.

TASK 2 — writeWCResult: weatherContext built from game.weather.
  Only surfaced when conditions are meaningful (non-clear sky, extreme
  temp, high wind). Appended after eventsContext in prompt array.
  Empty string when weather is absent or benign — no prompt noise.

Rule 7 (single-concern commit)."

wrangler deploy
```

---

## POST-DEPLOY VERIFICATION

```bash
BASE="https://field-relay-nba.jeffunglesbee.workers.dev"

# 1. Check a WC game has round populated from BSD group_name
curl -s "$BASE/v2/games?sport=wc26&date=$(date -u +%Y-%m-%d)" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for g in d.get('games',[]):
    print(f'{g[\"home\"][\"name\"]} vs {g[\"away\"][\"name\"]} round={g.get(\"round\",\"MISSING\")} weather={g.get(\"weather\",\"none\")}')
"

# 2. Verify extractWCGroup now hits regex path (round='Group I') not fallback
# (Can only verify indirectly — if D1 wc_results writes correctly for new games)

# 3. Check for weather in R2-captured brief context after next game finalises
```

---

## SCOPE BOUNDARY

DO:
- `src/index.js` only
- Two changes: ESPN branch enrichment block + writeWCResult prompt weather

DO NOT:
- Modify `adaptESPNWCSoccer` (round set at adapt time; enrichment runs after)
- Modify `extractWCGroup` or `_WC_TEAM_GROUP` (fallback still needed for non-BSD games)
- Modify `runBSDEndgameCapture` (already fixed in 4b9ea318)
- Touch client (jubilant-bassoon)
- Add weather to the Drama scoring system (that's client-side weatherDramaModifier)
