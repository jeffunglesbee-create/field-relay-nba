# WC Brief "Goals" Grammar — Investigation Update 2026-06-18 (round 2)

## CC's investigation claim vs. reality

CC (jubilant-bassoon commit 0bda7a1) claimed the offending template lives at:
- `src/index.js:11932` in the `/wc/brief/tournament` handler
- `src/index.js:16447` in a `/wc/brief/<id>` handler

**Reality** (verified via direct read of repo HEAD `02396ef`):

| Claim | Truth |
|---|---|
| `src/index.js` has line 11932 | File is 7669 lines total |
| `src/index.js` has line 16447 | File is 7669 lines total |
| `/wc/brief/<id>` handler exists | Does not exist. Only `/wc/brief/tournament` |
| Template pattern `${gf} Goals` lives in src/ | grep across entire src/ tree returns ZERO matches |

CC's investigation report appears to be fabricated. There is no
`${gf} Goals` template anywhere in the relay. The line numbers do not
exist in any file in this repo (largest file = 7669 lines).

## Real root cause (re-confirmed from yesterday's session)

The phrases "1 Goals" / "0 Goals" / "X Goals this season" are **LLM
hallucination** by the Claude proxy call that writes `wc:brief:movers`.

The prompt at `buildMoversBriefPrompt()` (`src/wc-tournament-projections.js:1056`)
carries probability deltas (`pFinal`, `pChamp`), narrative-note prose, and
bracket-trap stats. It does NOT include goal counts in any field. The LLM
is inventing the goal counts entirely.

## Fixes in place

### Layer 1 — Post-process sanitizer (yesterday's commit `87494ac`)

Still wired at `src/index.js:3051`. Helper at `src/index.js:3438`:

```js
function sanitizeGoalsGrammar(s) {
  if (!s) return s;
  const NUMBER_WORDS = '(?:no|zero|one|two|three|four|five|six|seven|eight|nine|ten)';
  return s
    .replace(/(\d+\s+)Goals\b/g, '$1goals')
    .replace(new RegExp(`(\\b${NUMBER_WORDS}\\s+)Goals\\b`, 'gi'), '$1goals')
    .replace(/(^|[^\d])1\s+goals\b/g, '$11 goal');
}
```

### Layer 2 — Prompt-level prevention (today's commit `02396ef`)

Two new rules added to `buildMoversBriefPrompt` in
`src/wc-tournament-projections.js:1078`:

```diff
   '- DO NOT INVENT results. Only reference data provided below.',
+  '- DO NOT INVENT goal counts, scorelines, or player statistics. No goal counts appear in the data below, so do not mention any. Refer to results in prose ("won", "drew", "lost") without inventing scorelines.',
+  '- If you do mention goals from a verified historical fact in the narrative notes, use lowercase "goal"/"goals" (singular when count is exactly 1; plural otherwise).',
```

Defense in depth: prompt-level prevention is the proper root-cause fix;
the post-process sanitizer remains because LLMs sometimes ignore prompt
rules and the user-facing grammar must stay clean even when the LLM does.

## Before / after

### Sanitizer behaviour (yesterday's regex still in place)

| Input | Output |
|---|---|
| `after each scored 1 Goals this season` | `after each scored 1 goal this season` |
| `following Qatar's 0 Goals this season` | `following Qatar's 0 goals this season` |
| `Mexico tallied 3 Goals in the opener` | `Mexico tallied 3 goals in the opener` |
| `Goals were scarce in Group F` | `Goals were scarce in Group F` (sentence-initial preserved) |

### Prompt change (today)

| Input prompt (excerpt) | LLM behaviour change |
|---|---|
| Old: "DO NOT INVENT results. Only reference data provided below." | LLM still felt free to invent goal counts in narrative prose |
| New: "DO NOT INVENT goal counts, scorelines, or player statistics. … Refer to results in prose ('won', 'drew', 'lost') without inventing scorelines." | LLM should now avoid inventing the "X Goals this season" pattern entirely |

## End-to-end verification (Rule 61)

- **Probe of `/wc/brief/tournament`**: returns `{"ok":true,"brief":null}`.
  The cached brief KV is currently empty — either the 24h TTL expired or
  no significant movers have triggered a new brief since the last cycle.
  The next projections cron tick that triggers a movers-brief write will
  flow through both the new prompt rule and the existing sanitizer.

- **Cannot verify against live brief text right now** because there is
  no current brief in KV. This is documented per Rule 61 ("If the session
  cannot verify, document as STAGED with exact curl + expected shape").

## STAGED probe (to run after next significant-movers cycle)

```bash
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/wc/brief/tournament \
  | python3 -c "import sys,json; d=json.load(sys.stdin); b=d.get('brief'); print((b or {}).get('text','<null>'))"
```

Expected: no occurrences of capitalized "Goals" mid-sentence, no
"1 Goals" (must be "1 goal" if present), no invented goal counts at all
under the new prompt rule.

## What was NOT changed

- Did not modify a template at the cited line numbers (they do not exist).
- Did not touch jubilant-bassoon or any stat repo.
- Did not change `computeMovers`, `WC_TEAM_CONTEXT`, drama scoring,
  or any non-prompt code.
- Did not add a `/wc/brief/<id>` handler (one was not present and not
  required).

## Commits

| SHA | Description |
|---|---|
| `87494ac` (yesterday) | `sanitizeGoalsGrammar` post-process at KV-put site |
| `02396ef` (today) | Prompt rules added to `buildMoversBriefPrompt` (defense in depth) |
