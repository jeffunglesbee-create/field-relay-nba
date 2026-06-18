# WC brief "Goals" grammar fix — 2026-06-18

Bug report:
- "after each scored 1 Goals this season" (capitalized + wrong plural)
- "following Qatar's 0 Goals this season" (capitalized + awkward 0)

## Root cause (not a template)

User's premise — "the template lives in the relay" — was incorrect. A thorough
grep proved there is NO "Goals" template anywhere in the relay source for the
WC tournament brief path:

- `buildMoversBriefPrompt()` in `src/wc-tournament-projections.js:1056` does NOT
  include any goal counts in the prompt. It carries only probability deltas
  (`pFinal`, `pChamp`) and narrative-note prose from `WC_TEAM_CONTEXT`.
- `computeMovers()` returns only probability deltas — no goal stats.
- No `narrativeNote` or `guardrail` in `wc-team-context.js` produces the
  phrasing "X Goals this season".

The phrases are **LLM hallucination**: Claude/Gemini is inventing the goal
counts (0 and 1) and capitalizing "Goals" mid-sentence on its own. The brief
output lands in KV `wc:brief:movers` and is served verbatim by
`/wc/brief/tournament`.

## Fix

A focused post-process `sanitizeGoalsGrammar(s)` applied to the LLM brief text
immediately before `KV.put('wc:brief:movers', …)` at `src/index.js:3028`.

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

Three rules:
1. `\d+ Goals` → `\d+ goals` (lowercase after a digit count)
2. word-number `Goals` → word-number `goals` (`no`/`zero`/`one`..`ten`)
3. `1 goals` → `1 goal` (singular when count is exactly 1)

`0 goals` is left lowercase — both `0 goals` and `no goals` are acceptable
per the bug spec, and rewriting to `no goals` mangles possessive context
(e.g. "Qatar's 0 goals" → "Qatar's no goals" reads worse).
Sentence-initial `Goals` (e.g. "Goals were scarce in Group F") is preserved.

## Before / after

Verified against the exact bug strings + edge cases via `node -e`:

| Input | Output |
|---|---|
| `after each scored 1 Goals this season` | `after each scored 1 goal this season` |
| `following Qatar's 0 Goals this season` | `following Qatar's 0 goals this season` |
| `Mexico tallied 3 Goals in the opener` | `Mexico tallied 3 goals in the opener` |
| `with no Goals in three games` | `with no goals in three games` |
| `Two Goals from Kane sealed it` | `Two goals from Kane sealed it` |
| `Goals were scarce in Group F` | `Goals were scarce in Group F` (preserved — sentence-initial) |
| `France 2 goals, Argentina 1 goals` | `France 2 goals, Argentina 1 goal` |
| `Iran scored 1 goals tonight` | `Iran scored 1 goal tonight` |

## End-to-end verification (Rule 61)

- **Commit**: `87494ac` (rebased onto current main).
- **Deploy**: workflow run `27795112320` in progress at probe time.
- **Live probe of `/wc/brief/tournament` at fix time**: returns
  `{"ok":true,"brief":null}` — the cached brief KV is currently empty
  (expired or no significant movers since last regeneration). The next
  projections cron tick that triggers a movers-brief write will produce
  output through the sanitizer.

The fix will apply automatically once any new brief is written. No KV
backfill needed because expired/null briefs don't carry the bug.

## Scope

- Single-concern commit (Rule 7) — one helper + one call site.
- Field-relay-nba only (per spec — no jubilant-bassoon, no stat repo).
- Does not modify prompt text, `buildMoversBriefPrompt`, `computeMovers`,
  or anything in `wc-team-context.js`.
- No drama scoring, interest computation, or ADR-002 boundary crossed.

## Future hardening (not in scope)

If "Goals" hallucination recurs frequently, consider:
- Adding an explicit prompt rule: `Use lowercase "goal"/"goals". Use singular "goal" when count is 1. Do not invent goal counts not present in the data.`
- The current fix is reactive (regex post-process); a prompt-level rule
  would be proactive but less reliable on its own. Combining both is
  defense-in-depth.
