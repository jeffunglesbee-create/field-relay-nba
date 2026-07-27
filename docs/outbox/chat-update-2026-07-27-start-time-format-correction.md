# chat-update-2026-07-27-start-time-format-correction

**From:** chat (claude.ai)
**Corrects:** `outbox/cc-session-2026-07-25-start-time-persistence.md`, section "start_time format per sport"
**Severity:** documentation inaccuracy, not a code defect
**Status:** verified by direct query

---

## The claim

That doc states:

> ESPN's `competition.date` field is a UTC ISO 8601 string in the format
> `YYYY-MM-DDTHH:MM:SSZ` (e.g., `2026-07-25T19:00:00Z`). This format is
> consistent across all ESPN-sourced sports [...] The client can parse
> this as a standard UTC datetime string directly — no normalization
> needed.

## What's actually stored

Direct D1 query against `field-archive`, grouped across every populated
row:

```sql
SELECT start_time, COUNT(*) FROM regular_season_games
WHERE start_time IS NOT NULL GROUP BY start_time
```

```
2026-07-25T20:05Z   ×2
2026-07-25T20:10Z   ×2
2026-07-25T22:05Z   ×1
2026-07-25T22:10Z   ×1
2026-07-25T22:30Z   ×1
2026-07-25T22:40Z   ×1
```

**No seconds component. Every value is `YYYY-MM-DDTHH:MMZ`.**

---

## Why it happened

The doc reasoned from the *upstream source* — ESPN's `competition.date`
format — rather than checking what actually landed in the column. That's
a defensible inference, and it's stated with real specificity, which is
what makes it convincing. It's also wrong, because something between
ESPN and the D1 write drops the seconds.

Same failure family as three other findings in this session: a
conclusion reached by reasoning about a system instead of probing it.
The others were `/journalism/brief` "never existed" (it does),
Open-Meteo "returns no CORS header" (it returns `*`), and chat's own
claim that `cycleId`/`proseScore` were invented mock fields (they're
real, with real values). In every case the reasoning was plausible and
the probe was cheap.

**Not identified:** where exactly the seconds are dropped — the ESPN
parse, the `/archive/game` POST body, or the INSERT bind. Worth one grep
if anyone touches this path, but it isn't affecting correctness today,
and guessing at it here would repeat the same mistake this note exists
to correct.

---

## Does it break anything?

**No.** Both forms parse identically in JS:

```js
new Date("2026-07-25T20:05Z").toISOString()
// -> "2026-07-25T20:05:00.000Z"
```

Confirmed against the real stored values, and field-playground's
`Countdown` renders correctly from them (`2h 13m`, soon-threshold
behaving).

---

## Why correct it anyway

The doc's final line is *"no normalization needed"* — an instruction to
future client authors. Someone building a display formatter, a strict
parser, or an equality comparison against a generated `:SSZ` string
would be working from a false premise. Specifically at risk:

- string equality between a stored value and a client-generated timestamp
- any regex validating `\d{2}:\d{2}:\d{2}Z`
- round-tripping through a formatter that re-emits seconds, then
  comparing against the original

The parse advice is right. The format string is wrong. Correcting only
the format string.

---

## Correct wording

> `gm.startTime` is sourced from `comp?.date` (ESPN CDN competition
> object). **As stored, values are `YYYY-MM-DDTHH:MMZ` — UTC, minute
> precision, no seconds component** (verified by direct D1 query across
> all populated rows, 2026-07-27). This parses directly as a standard
> UTC datetime string in JS with no normalization; note only that the
> stored string does **not** round-trip byte-identically through a
> formatter that emits seconds.
