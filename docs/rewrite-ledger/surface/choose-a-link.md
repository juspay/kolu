# choose-a-link

- Kind: how-to. Reader: someone wiring a client to a served surface and picking a transport.
- Rewritten from: `f50641c6a`
- Words: 510 → 443
- Frontmatter: unchanged.
- Sentence-level work. Six sentences with paired dashes became sentences with parentheses, commas or colons; the 42-word opening sentence and the 47-word "serve side" sentence were split. First use of "link" links to the glossary. Every code block, `<Snippet>` tag and the `<LinkMatrix />` diagram are unchanged.

## Headings

Unchanged. No inbound link points at a heading on this page.

## Moved

None. The serve-side prose that ran to 87 words under "Pick by where the server is" became a fourth column ("Serve side") of the table already on the page, which also brought that heading under the 300-word limit.

## Cut

| Fact | Tag |
| --- | --- |
| The watchdog refusal "is by brand, stamped by the link factory itself, so a new wire link inherits it" | implementation |
| `directDispatch` may be passed bare "because its transport is honestly always-live" | rationale (the aside already says a wire link can half-open) |
| `group` makes the client/wire agreement true "by construction rather than by review" | rationale (house rhetoric; the fact itself stays) |
| "That is the point of the link abstraction" | rationale |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
