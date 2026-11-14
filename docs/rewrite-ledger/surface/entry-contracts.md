# entry-contracts

- Kind: explanation. Reader: someone building on `@kolu/surface-map` who wants to know why an entry's status and frames are shaped as they are.
- Rewritten from: `f50641c6a`
- Words: 1,955 → 1,529
- Frontmatter: description reworded (150 → 132 characters).

## Headings

| Old | New |
| --- | --- |
| The fourth arm is about you, not the host (941 words) | Why there is a fourth arm on your side, with `###` The bug it prevents · Why an arm and not a flag · What it carries |
| (inside the same section) | Why a failure carries its evidence, with `###` Where `warming` ends and `failed` begins |
| Aside: "The domain owns its failures; the framework owns the discriminant and one co-product" | `###` The domain owns its failures |

No inbound links pointed at any heading of this page.

## Moved

None.

## Cut

| Fact | Tag |
| --- | --- |
| "for a year the retained output tail rode that payload, so a slept laptop woke to a reason whose evidence had silently vanished" | history (kept as the reason, in the conditional) |
| "a schema library that tightens… would break every void-input call… and one did" | history (kept as the reason, without "and one did") |
| "it survived the move from zod to Effect Schema without a byte changing" | history |
| "The floor has always demoted…" (the word "always") | history |
| "Misroute-by-collision isn't unlikely; it is unconstructible" | duplicate (the sentence before says it cannot collide) |
| "A generic parameter would buy a domain no expressiveness it lacks and cost every map an argument that has one correct answer" | duplicate (the paragraph already says evidence is not domain volatility) |

The incident in `kolu#2129` was the first pass's one history passage, with its PR link. The second pass adds one more (below).

## Second pass (rationale received from the reference pages)

Words: 1,529 → 1,773. Lint passes; `.waterfall/compare.mjs`: 0 missing. No frontmatter or heading change; the first pass's headings are untouched.

### Moved (received from)

| Fact | From | Now at |
| --- | --- | --- |
| Why a sibling is declared as a whole `Surface` rather than more members on the entry spec: a different program's contract, its own release cadence and version, so one spec two daemons must agree about and a skew each carries for the other | `ref-surface-map` (old lines 126–131) | `## Why a sibling is a whole surface` |
| The fine `connection` payload is the one authority the coarse `kind` and the fine word both derive from, one projection of one `SessionState` frame, read off the same entry value; with the drishti#102 divergence as the incident | `ref-surface-map` (old line 277) | `### Why the connection word and the dot have one source` |

### Cut from the received passages

| Fact | Tag |
| --- | --- |
| "its own clock" in the sibling argument | A sibling face carries no clock of its own: `ref-surface-map`'s "What a sibling face carries" says `state` and `clock` stay the entry's, and the code agrees (`packages/surface-map`). Kept as release cadence and version only. |
| "has no construction path" / "by construction" phrasing of the connection argument | rationale kept, house phrasing dropped per the standard |

The page now carries two incident passages, each one short paragraph with its link: [kolu#2129](https://github.com/juspay/kolu/pull/2129) for the fourth arm, and [srid/drishti#102](https://github.com/srid/drishti/issues/102) for the connection authority. The drishti link is the issue ("Connection state: green dot + permanent 'connecting' — two authorities for one fact never reconcile"); the code comments cite it only as `drishti#102`.

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
