# across-the-hosts

- Kind: tutorial. Reader: a developer who has fleet-top working locally and wants it mirrored from another box over ssh.
- Rewritten from: `f50641c6a`
- Words: 634 → 620
- Sentence-level work only. The 80-word opening became a 24-word opening plus a second paragraph. Three two-em-dash sentences (the ephemeral agent, the three hops, the connection-state note) became sentences with commas or parentheses. The 97-word prerequisites paragraph with its 49-word sentence became a numbered list under its own heading, and the 48-word step-2 sentence became two. Every command, code block and `<Snippet>` is unchanged, so the tutorial runs exactly as before.
- First use of "mirror" links to the glossary.
- Asides: three → one. The page kept the part-3 code note (trimmed to under 50 words); the other two became running text and a section.

## Frontmatter

Unchanged.

## Headings

| Old | New |
| --- | --- |
| `## The agent — what runs on the far box` | `## What runs on the far box` |
| — | `## Before you run it` (new heading over the prerequisites, which were an aside) |

`.waterfall/anchors.md` lists no inbound link to any heading on this page, and a repo grep for `across-the-hosts#` found none, so no link needed updating.

## Moved

None.

## Cut

| Fact | Tag |
| --- | --- |
| "One box's trouble becomes exactly one honest chip" wording | house rhetoric; the isolation fact is kept plainly |
| "the daemon stratum" / "we continue from the `top` surface you already know" in the code note | duplicate of the surrounding text |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
