# Claude Code Command — Wire Goalscorer Names to Real BSD Shot xG

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write findings to outbox/cc-goalscorer-xg-2026-07-02.md.

## CONTEXT

`src/index.js` (~line 1305) already extracts real, named goalscorers
into journalism-consumed data, live today:
```js
const matchEvents = (comp.details || [])
    .filter(d => d.type?.id)
    .map(d => ({
        type: d.type?.text || d.type?.id,
        players: (d.athletesInvolved || []).map(a => a.displayName),
        scoringPlay: d.scoringPlay || false,
        ...
    }));
```
This feeds journalism text (`"Include: key goalscorers with minutes,
standout performances..."`, ~line 1886).

Separately, BSD's shotmap (proxied via `/bsd/events/{id}/shotmap`, same
relay) carries real shot-level data for the same real matches, including
actual goals:
```json
{"type": "goal", "xg": 0.456, "xgot": 0.4714, "player_id": 4218, "min": 90, ...}
```
Confirmed live 2026-07-02 — a real `type: 'goal'` entry exists with a
real `xg` value in WC26 event 8346's shotmap.

**The gap:** `resolveEntity('soccer_player', name)` (shipped 2026-07-02)
takes an ESPN-sourced name like `"Kevin De Bruyne"` and returns a
normalized **string** key (e.g. `"de bruyne"`). BSD's shotmap is keyed
by **numeric `player_id`**, not by name string at all. A normalized
name key cannot look up a shotmap entry — the resolver currently has no
path from an ESPN goalscorer name to a BSD `player_id`.

**What already exists that solves this, unused:** every entry added to
`CANONICAL_PLAYER_SOCCER` this session was sourced from
`scripts/soccer-player-crosscheck.js`'s real output, which **already
carries `bsdPlayerId`** for every candidate (confirmed:
`{'bsdName': 'B. A. Yılmaz', 'bsdPlayerId': 3734, ...}`, real field,
present in every candidate record). That data exists in the detector's
output artifact but was never carried into `identity-resolver.js` —
only the normalized name pair was.

## PRE-BUILD PROBE (Rule 87)

```bash
sed -n '440,495p' src/identity-resolver.js   # confirm current CANONICAL_PLAYER_SOCCER shape, exact line numbers
sed -n '1295,1330p' src/index.js             # confirm matchEvents shape, exact line numbers
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/8346/shotmap | python3 -c "import json,sys; d=json.load(sys.stdin); print([s for s in d['shotmap'] if s.get('type')=='goal'])"
```
Confirmed real `bsdPlayerId` for all 9 candidates, checked directly
from `outbox/soccer-player-crosscheck.json` (jubilant-bassoon) before
writing this doc — do not re-derive from memory, but these are the real
values as of 2026-07-02:
`{Yılmaz: 3734, Çakır: 3724, Yıldız: 2184, Aydın: 3412, Elmalı: 4217,
Bardakcı: 3727, Pulišić: 3820, Macià: 5143, Purić: 5154}`. Re-verify
against the live artifact if it has been regenerated since this doc was
written — do not assume these are still current without checking.

## TASK 1: Extend `CANONICAL_PLAYER_SOCCER` entries to carry `bsdPlayerId`

Change the pair structure from `[variant, canonical]` (string only) to
carry the ID:
```js
const pairs = [
    ['Baris Alper Yilmaz', 'Yılmaz', 3734],
    ['Ugurcan Çakir', 'Çakır', 3724],
    ['Kenan Yildiz', 'Yıldız', 2184],
    ['Oguz Aydin', 'Aydın', 3412],
    ['Eren Elmali', 'Elmalı', 4217],
    ['Abdülkerim Bardakçi', 'Bardakcı', 3727],
    ['Christian Pulisic', 'Pulišić', 3820],
    ['Carlos Macià', 'Macia', 5143],
    ['Aleksa Puric', 'Purić', 5154],
];
const out = {};
const idOut = {};
for (const [variant, canonical, playerId] of pairs) {
    const key = _stripPlayerSoccer(variant);
    out[key] = _stripPlayerSoccer(canonical);
    if (playerId != null) idOut[key] = playerId;
}
```
Export a new small lookup (e.g. `SOCCER_PLAYER_ID_BY_KEY`) alongside
`resolveEntity`/`resolveTeamKey` — do not overload `resolveEntity`'s
return type (it returns a string key everywhere else; adding an object
return here would break every existing caller's assumption, verify
this by checking all real usages of `resolveEntity` before changing its
signature — currently zero real callers exist per this session's own
finding, but do not treat "zero callers" as license to skip checking,
confirm it directly).

## TASK 2: Wire goalscorer names to real shot xG

In `index.js`, extend the `matchEvents` mapping (or a new function
consuming it) so that for entries where `scoringPlay === true`, attempt:
```js
const playerId = SOCCER_PLAYER_ID_BY_KEY[resolveEntity('soccer_player', playerName)];
if (playerId && game.bsdEventId) {
    // look up the real goal's xg from the BSD shotmap for this event,
    // matching by player_id AND type === 'goal' (a player can have
    // multiple shots; only the actual goal entry has the real xg for
    // THIS scoring play)
}
```
This requires the BSD shotmap to already be fetched for events with a
`bsdEventId` (confirm whether this is already fetched elsewhere in the
journalism pipeline for other purposes — e.g. `buildBSDMomentumContext`
per this session's earlier findings — and reuse that fetch rather than
adding a second one, per the same budget-conscious pattern used
elsewhere in this codebase).

**Real limitation to document, not solve here:** this only works for
BSD-tracked competitions with a real `bsdEventId` (WC26 confirmed; the
6 competitions with real fallback-rescued rosters per this session's
work). Matches without a `bsdEventId` simply don't get the enrichment
— fall back to the existing plain-text goalscorer mention, don't error.

## TASK 3: Verification

```bash
node -c src/identity-resolver.js
node -c src/index.js
```
Inline test before relying on a live match: using the confirmed real
WC26 goal (event 8346, `player_id: 4218`, `xg: 0.456`) — resolve
whichever of the 9 canonical entries corresponds to `player_id: 4218`
(check this against the real candidate data, do not assume it matches
any specific name without checking) and confirm the lookup chain
(name → resolveEntity → SOCCER_PLAYER_ID_BY_KEY → shotmap entry →
xg: 0.456) produces the right value end to end, in code, before
considering this done.

**Chat-side follow-up (not checkable by CC):** confirm against a real
live WC26 (or other BSD-tracked) match that a goal gets enriched with
its real xG value in journalism output.

## TASK 4: Outbox manifest (last task)

State explicitly: which of the two unconfirmed `bsdPlayerId` values
(Macià, Purić) were resolved and how, whether the BSD shotmap fetch was
reused from an existing call or newly added (and if new, the budget
impact), and confirm the inline xg-lookup test passed against the real
`player_id: 4218` / `xg: 0.456` case before considering Task 2 done.
