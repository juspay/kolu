# bake-an-identity

- Kind: how-to. Reader: someone building a Surface daemon who needs it to say which build it is running.
- Rewritten from: `f50641c6a`
- Words: 1,026 → 971
- Frontmatter: description 149 → 146 characters, one sentence, no paired dashes. Other keys unchanged.

## Headings

| Old | New |
| --- | --- |
| 1. Bake the pair with Nix | 1. Bake the pair with Nix |
| 2. Derive the fileset — don't list it | 2. Derive the fileset — don't list it (frozen; text verbatim) |
| — | 2 split into `### Walk the workspace closure`, `### Declare which members are pinned`, `### What fails at eval time`, `### The alternative: hash a narrowed derivation` |
| 3. Read it back at runtime | 3. Read it back at runtime |
| 4. Decide what the build id hashes | 4. Decide what the build id hashes |

Step 2 held 631 words of running text under one heading. The four `###` sub-steps bring every heading under the 300-word limit; no `##` heading was renamed, so no inbound link moved. The only inbound anchor (`packages/surface-daemon/README.md:65` → `#2-derive-the-fileset--dont-list-it`) still resolves.

Aside title: "Off-nix reads nothing — on purpose" → "Outside Nix it reads nothing" (the old title argued the design). One aside on the page.

Links added: first use of **daemon** links to `/surface/glossary`.

## Moved

Nothing moved off this page.

## Cut

| Fact | Tag |
| --- | --- |
| "It shows nothing rather than inventing an identity — the fail-fast rule" (the named rule as the reason for empty strings) | rationale (the behaviour and the instruction not to add a fallback stay) |
| "rather than presenting a build whose source cannot be named" | rationale |
| "the two env values are one fact" as a restatement of "set both or neither" | duplicate |
| "it is equally sanctioned" (about the narrowed-derivation pattern) | rationale |
| "pure policy rather than bookkeeping", "over-firing is expensive" as a second statement of the same trade | duplicate |
| "meaningful" in the closing sentence (identity is "stable and meaningful") | rationale |

All API facts, every eval-time failure, both env variables, the `nix` block, the snippet and the per-system id map are kept.

## Dropped code spans

`.waterfall/compare.mjs` reports 0 missing.
