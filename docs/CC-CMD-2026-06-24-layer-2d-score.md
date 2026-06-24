# CC-CMD: Layer 2d-score — Score Contradiction Check
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Rule 87:** Self-completing. All probes, edits, verification, and outbox manifest run inside this session.

---

## CONTEXT

The Colombia 1-0 Congo DR brief scored 258/300 but contained "2-3 result" — a
score that contradicts the actual result in the prompt. Layer 2d (stat
verification) only checks for **omissions**: stats from the prompt that are
missing from the text. It does not check for **contradictions**: scores in the
text that conflict with the known result. Layer 2d-score closes that gap.

Root cause confirmed: the brief opens with "Colombia's 1-0 win" (correct) so
2d passed — "1-0" was present in the text. The "2-3" appeared later as a
hallucinated stat. Score contradiction = different check than omission.

---

## PROBE BLOCK — read before writing anything

1. Read `src/journalism-quality.js`. Find the `runQualityChain` function.
   Locate the `// 2d: stat verification` block (around line 640). Confirm:
   - It ends with `layers_fired.push('2d')`
   - The next block is `// 2e: cross-sport hallucination`
   - There is NO `2d-score` block between them yet

2. Confirm `runQualityChain` receives `opts` and that `opts.game` is
   destructured or accessible. Check the function signature and how `game`
   is accessed inside the function (e.g., `const { sport, game, matchupNote,
   scoreThreshold, maxRetries } = opts` or direct `opts.game`).

3. Confirm `opts.game` shape: `{ home, away, homeScore, awayScore }`.
   Check one existing call site (e.g., the queue consumer at line ~11138)
   to confirm `homeScore`/`awayScore` field names (not `home_score`).

---

## TASK 1 — Add `2d-score` block to `runQualityChain`

Find the exact boundary between `2d` and `2e`. It will look like:

```javascript
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2d'); }
  }

  // 2e: cross-sport hallucination
```

Insert the new `2d-score` block in that gap:

```javascript
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2d'); }
  }

  // 2d-score: score contradiction — verifies no score in the text contradicts
  // opts.game's known result. Distinct from 2d (which catches omissions):
  // 2d fires when a stat from the prompt is absent; 2d-score fires when a
  // DIFFERENT score appears in the text. Both orientations (home-away and
  // away-home) are valid. Requires opts.game with homeScore + awayScore.
  // Active for any relay-scored brief where the game object is known
  // (WC queue consumer, MLB brief, Night Owl, Stakes Brief, J2 Series).
  if (game?.homeScore !== undefined && game?.awayScore !== undefined
      && retries < maxRetries) {
    const hs = game.homeScore, as_ = game.awayScore;
    const valid = new Set([
      `${hs}-${as_}`, `${as_}-${hs}`,   // hyphen
      `${hs}\u2013${as_}`, `${as_}\u2013${hs}`, // en-dash
    ]);
    const scoreMatches = [...text.matchAll(/\b(\d{1,2})[\u2013-](\d{1,2})\b/g)];
    const contradictions = scoreMatches
      .map(m => `${m[1]}-${m[2]}`)
      .filter(s => !valid.has(s) && !valid.has(s.split('-').reverse().join('-')));
    if (contradictions.length) {
      const correct = `${hs}-${as_}`;
      const retryPrompt = prompt +
        `\n\nSCORE CONTRADICTION: Your draft contains "${contradictions[0]}" but ` +
        `the actual result is ${game.home ?? 'home team'} ${correct} ` +
        `${game.away ?? 'away team'}. Remove all incorrect scores. Use only ` +
        `the real result in your rewrite.`;
      const retried = await callProxy(retryPrompt);
      if (retried && retried.length > 30) {
        text = retried.trim(); retries++; layers_fired.push('2d-score');
      }
    }
  }

  // 2e: cross-sport hallucination
```

**Notes for CC:**
- Use `as_` (with underscore) to avoid the reserved word `as` in JavaScript.
- The `\u2013` is the en-dash character — write it as a unicode escape in the
  source, or as the literal `–` character, whichever is already consistent with
  the surrounding code style in this file.
- If `game` is accessed via `opts.game` rather than a destructured `game`
  variable, use `opts.game?.homeScore` etc. to match the existing pattern.
  Read the actual destructuring at the top of `runQualityChain` to confirm.

---

## TASK 2 — `node --check` verification

```
node --check src/journalism-quality.js
```

Must pass with no errors.

Also grep:
```
grep "2d-score" src/journalism-quality.js
```
Must return exactly 2 matches: the comment and the `layers_fired.push('2d-score')` line.

---

## TASK 3 — Unit-level proof

Add an inline proof immediately after the block as a comment — do not add
a runtime test, just document the expected behavior for the next reader:

```javascript
  // PROOF (Colombia 1-0 Congo DR brief, Jun 24 2026):
  // Text contained "2-3 result". valid = {"1-0","0-1","1–0","0–1"}.
  // "2-3" ∉ valid → contradiction fired → retry with SCORE CONTRADICTION.
  // Without this layer: 2d passed (text had "1-0" in opening line),
  // 258/300 score shipped with fabricated score mid-brief.
```

Place this comment directly after the closing `}` of the 2d-score block,
before the `// 2e:` line.

---

## TASK 4 — Commit + deploy

```
fix: Layer 2d-score — score contradiction check in runQualityChain

Catches briefs that state the correct score in one sentence but contradict
it elsewhere with a hallucinated result. Distinct from Layer 2d (missing
stats): 2d catches omissions, 2d-score catches contradictions.

Fires only when opts.game carries homeScore + awayScore (set by WC queue
consumer and client brief callers after JQ game-context fix). Validates
both hyphen and en-dash score forms; accepts both home-away and away-home
orientations as valid.

Root cause: Colombia 1-0 Congo DR brief (Jun 24) scored 258/300 but
contained "2-3 result". Opening line had correct "1-0" so 2d passed.
2d-score would have caught the contradiction and retried.
```

Push. Deploy must succeed.

---

## TASK 5 — Outbox manifest

Write `outbox/cc-layer-2d-score-2026-06-24.md` with:
- What Layer 2d does vs what 2d-score adds (omission vs contradiction)
- The Colombia brief as the root-cause example
- Where in the chain it fires (between 2d and 2e)
- The `valid` set logic (both orientations, both dash types)
- Why `as_` not `as` (reserved word)
- When it's active (requires opts.game.homeScore/awayScore)
- Commit hash + deploy status
- grep output confirming 2 matches for `2d-score`

Commit `[skip ci]` and push.

---

## DONE CONDITIONS

- [ ] `2d-score` block present between `2d` and `2e` in `runQualityChain`
- [ ] `layers_fired.push('2d-score')` present
- [ ] `node --check src/journalism-quality.js` passes
- [ ] grep `2d-score` → exactly 2 matches (comment + layers_fired)
- [ ] PROOF comment present after the block
- [ ] Deploy green
- [ ] Outbox manifest committed [skip ci]
