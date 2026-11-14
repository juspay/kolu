# make-it-a-daemon

- Kind: tutorial. Reader: a developer who finished `your-first-surface` and now wants fleet-top as a long-lived daemon.
- Rewritten from: `f50641c6a`
- Words: 733 → 715
- Sentence-level work only. The 46-word `daemonMain` sentence and the 83-word paragraph under "Wrap the engine in a daemon" were split into two paragraphs. The two-em-dash sentences (the `group`/`handlers` note, the supervisor paragraph, the "Watch the order" paragraph, the "What makes this safe" aside) became sentences with commas or parentheses. The steps, every command, every code block and every `<Snippet>` are unchanged, so the tutorial runs exactly as before.
- First use of "daemon" links to the glossary. `/surface/ref-surface-daemon#the-anchor-self-reap` was checked against the restructured reference page and still resolves.

## Frontmatter

Unchanged.

## Headings

Unchanged.

## Moved

None.

## Cut

| Fact | Tag |
| --- | --- |
| "The finale is the payoff" framing around the recycle sequence | house rhetoric; the sequence is stated plainly |
| The aside's "That frozen control core is the subject of…" phrasing, replaced by plain links to The daemon spine and Recycle and upgrade | rationale (lives on the explanation page) |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
