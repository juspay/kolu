# serve-a-map

- Kind: how-to. Reader: someone serving many host surfaces of one shape as a single map.
- Rewritten from: `f50641c6a`
- Words: 541 → 517
- Frontmatter: `description` reworded off an em-dash into one sentence (97 characters). Keys unchanged.

## Headings

Unchanged: "1. Define the map", "2. Build one binding per host", "3. Bridge the bindings into a MapRegistry", "4. Serve the map". No inbound link targets an anchor on this page; links from `a-fleet-of-surfaces`, `ref-surface-map` and `ref-surface-remote` are page-level.

The 80-word warm-pool tip aside became prose plus a three-item list in step 2, so the page keeps one aside (the status-projection note, trimmed to under 50 words). Every code span of the aside survives.

## Moved

Nothing moved off this page. First use of "surface map" now links to [glossary](/surface/glossary); the status reasoning still links to `entry-contracts`, the client side to `the-client-half`, and the helpers to `ref-surface-remote`.

## Cut

| Fact | Tag |
| --- | --- |
| "never as a fleet-wide crash" (step 2) | rationale (the per-entry behaviour is kept) |
| "There is no second writer of membership" (step 3) | duplicate (the same sentence's "the one writer of membership" says it) |
| "Membership and status ship from one writer, so the two can never disagree" (status aside) | duplicate / rationale (`entry-contracts`, linked from the aside) |
| Bold emphasis on **by tag**, **`{ group, handlers }` pair**, **host map**, **demand-gated** | house style (rule 16) |

## Dropped code spans

`.waterfall/compare.mjs` against `f50641c6a`: 0 missing.

## Review round 1

- Opening cut to 50 words (rule 4): 64 → 34. The three steps this guide takes and drishti as the worked example moved into a second paragraph; the opening keeps what the page is.
- Checks: lint passes; `house-style.mjs` reports nothing on this page.
