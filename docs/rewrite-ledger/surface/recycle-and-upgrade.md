# recycle-and-upgrade

- Kind: how-to. Reader: someone shipping a new daemon build to clients that are already connected.
- Rewritten from: `f50641c6a`
- Words: 436 → 444
- Frontmatter: description 146 → 155 characters, one sentence, no paired dashes. Other keys unchanged.

## Headings

| Old | New |
| --- | --- |
| 1. Declare a policy | 1. Declare a policy |
| 2. Converge before you connect | 2. Converge before you connect |
| 3. What the live recycle does underneath | 3. What a recycle does |

No inbound link pointed at any of these anchors (`.waterfall/anchors.md` lists none for this page); `glossary`, `make-it-a-daemon`, `ref-surface-daemon` and `ref-surface-supervisor` link to the page, not to a heading.

Aside title: "Gate on the contract version, never a string ==" → "Compare contract versions, not strings".

Shape work: `converge`'s three steps became a numbered list; the recycle sequence keeps its numbered list with one fact per item. Links added: first use of **daemon** links to `/surface/glossary`. The link to `/surface/surface-daemon-invariants` is page level, so the reference restructure in this wave does not affect it.

## Moved

Nothing moved off this page.

## Cut

| Fact | Tag |
| --- | --- |
| "the consumer's entire convergence surface" as a claim about the type | rationale (replaced by what the type holds) |
| "so a cross-supervisor fight terminates as `cross-supervisor`, not a livelock" → kept, with "livelock" written as "looping" | — |
| "never turns a lost link into honest daemon absence" → "into daemon absence" ("honest" was house vocabulary) | rationale |
| "A newer build with a compatible contract must be recognised as compatible, not \"different\"" → stated once, positively | rationale |

## Dropped code spans

`.waterfall/compare.mjs` reports 0 missing.
