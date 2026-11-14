# publish-content-addressed

- Kind: how-to. Reader: someone with a remote Surface daemon who wants any Linux host to take their build without Nix trust settings.
- Rewritten from: `f50641c6a`
- Words: 748 → 685
- Frontmatter: description 170 → 141 characters (the lint's 160 limit). Other keys unchanged.

## Headings

| Old | New |
| --- | --- |
| 1. Declare where your builds are published | unchanged |
| 2. Publish from CI | unchanged |
| How the cache is pushed | unchanged (frozen; `packages/surface-daemon/README.md:67` links to it) |
| 3. Dial as usual | unchanged |

No heading renamed, so no inbound link needed updating.

Shape work: the 130-word block under step 2 became a short paragraph plus a six-item numbered list of what the action does per attribute. The 160-word block under "How the cache is pushed" became a paragraph plus a three-item list (object-storage buckets, the `https://` requirement, verification). Both blocks keep every fact and every code span.

Links added: first use of **daemon** links to `/surface/glossary`. The link to `/surface/ref-surface-remote` (page level, no anchor) and `/surface/ref-surface-daemon` are unchanged.

## Moved

Nothing moved off this page.

## Cut

| Fact | Tag |
| --- | --- |
| "exactly as before" on the attic push, and "as before" on the trust route in the aside | history |
| "the declaration is byte-identical to one baked before the option existed" | history |
| "That is the whole of it: the substituter is the one address you give, and the cache states the rest." | rationale (house rhetoric; the mechanism is stated in the sentences around it) |
| "nothing unpinned" as a gloss on the npins pin (url and hash both are kept) | duplicate |

## Dropped code spans

`.waterfall/compare.mjs` reports 0 missing.
