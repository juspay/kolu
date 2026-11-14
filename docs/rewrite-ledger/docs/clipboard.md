# clipboard

- Kind: how-to. Reader: someone handing an image or a file to the agent in a terminal.
- Rewritten from: `f50641c6a`
- Words: 251 → 235 (light pass, as planned)
- Frontmatter: description 182 → 132 characters. Other keys unchanged. Removed the unused `Card` and now-unused `Aside` imports.
- The inline SVG diagram is unchanged, with its `cb-flow-title` and `cb-arrow` ids and its `ax-d-*` classes.

## Headings

| Old | New |
| --- | --- |
| Paste an image | Paste an image |
| Drag and drop a file | Drag and drop a file |
| (the `<Aside type="tip" title="What the agent sees">`) | What the agent sees (now a `##` section) |

The aside ran to 58 words, over the 50-word limit for an aside, and was a
behaviour note rather than a caution. Its facts are now a section. No page links
into this page's headings.

## Moved

Nothing.

## Cut

| Fact | Tag |
| --- | --- |
| "kolu leans on exactly that" phrasing and "You never manage a temp file by hand" | rationale |
| "a screenshot straight into the conversation, no intermediate file" (kept in short form) | rationale |
| "bracketed-pastes its path into the PTY" (said as "pastes its path into the terminal"; the bracketed paste is stated once, in "What the agent sees") | duplicate |
| "rejected client-side" said twice | duplicate |
| "so drop and preview stay in lockstep" | rationale |

## Dropped code spans

`.waterfall/compare.mjs` reports 0 missing.
