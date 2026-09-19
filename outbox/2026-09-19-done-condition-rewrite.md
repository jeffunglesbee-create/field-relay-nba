# The done condition was satisfied by construction

**CC-CMD:** `docs/CC-CMD-2026-09-18-atomic-odds-counter.md`

## What was wrong with it

Both original conditions measured `used` against `by_site_sum`:

1. `odds-site-drift` reports `gap-did-not-grow` across 8+ same-day intervals
2. `odds-attribution-gap` reports `ok` on a closed day

After Task 2 those two numbers are written by the same batch over the same rows
and read from the same store. **They agree because the schema says so.** Waiting
three days for them to go green is waiting for a tautology, and pasting that
green into the Task 6 manifest would be publishing one as evidence.

This repo's Rule 90 says a check that has only ever passed proves nothing. The
sharper version: **Task 2 removed the way these two could fail.** It did not fix
the gap, it deleted the instrument that was measuring it.

| | before Task 2 | after Task 2 |
|---|---|---|
| counters | two, racing | one, written twice in a transaction |
| they disagree | something is wrong | cannot happen for the old reason |
| is the number *right*? | unknown | **still unknown, and nothing internal can now say** |

The CC-CMD names this in its own text and then writes a done condition away
from it:

> Everything measured so far is the difference between two of our own counters.
> Nothing has established which of them is RIGHT. Both could be wrong together.

## The replacement

**`odds-daily-vs-vendor` returning `tracks-the-bill` on three closed days.** It
is the only remaining check with an external referent, and therefore the only
one that can go red for a reason the code did not construct.
`odds-attribution-gap` is kept but demoted: passing says nothing new, failing
would say the batch is not atomic.

## The probe's meaning changed under it

`odds-site-drift` was to be deleted once the done condition held three days.
That is now wrong, and the reason is the useful part: **same code, same
arithmetic, different claim.**

    before Task 2   a green means: the two KV counters happen to agree
    after  Task 2   a green means: batch() really is one transaction

That second claim is the single unverified premise under Task 2. The local
mutations against `node:sqlite` are sequential — they prove the statements
correct *given* a transaction and say nothing about whether D1 supplies one
under concurrent isolates. This probe is the only instrument that can catch it.

Retiring it on the old schedule would have thrown away the one thing watching
the new risk, while the risk it was built for no longer exists.

## Implemented, not just noted

- Every sample carries `source` (`d1` / `kv` / `kv-d1-unreadable`), read from
  the `/budget/odds` field Task 2 added.
- **An interval straddling the KV→D1 cutover is REFUSED, not merged** — the same
  discipline already applied to cross-day pairs, for the same reason: the two
  ends measure different mechanisms, so their difference is the deploy rather
  than the system.
- The verdict prints which claim its green is making, beside the verdict, rather
  than leaving a 2026-09-20 reader to infer the 2026-09-18 meaning (Rule 91).

**The first interpretable day is 2026-09-20.** 09-19 straddles the cutover —
KV guard until 19:13Z, D1 batch after.

## Verification

| what | result |
|---|---|
| `watch-odds-site-drift --self-test` | 18/18 → **23/23** |
| `mutate-odds-site-drift` | 10/12 → **12/12** |
| all `deploy.yml` node gates | 67/67 |
| doc citations | PASS |

**The filter bug I introduced and then caught.** Adding `mixedStore` to `deltas`
without adding it to `usable` would have left a straddling interval counted
while looking handled. Caught by writing mutation D11 first — which is the whole
point of writing the mutation before trusting the change.

**Both new mutations initially reported `anchor matched 0 times — NOTHING
MUTATED`.** I had appended them as arrays to a harness that takes objects with
named keys, so `mut.anchor` was `undefined`. The harness refused to report a
verdict it had not produced, exactly as Rule 90's corollary requires. A looser
harness would have printed NOT CAUGHT and sent me looking for a bug in the
check.

## What has NOT moved

The `-410` and the 685 unexplained credits are untouched. Those were never the
daily-vs-site gap; they are the ledger-vs-vendor gap, and Task 2 did not go near
it. "Task 2 shipped, the gap closed" would be reading the wrong gap.
