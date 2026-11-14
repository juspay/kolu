# ref-surface-mcp

- Kind: reference. Reader: someone wiring `@kolu/surface-mcp` who needs to look up an export, an option or a rule.
- Rewritten from: `f50641c6a`
- Words (counted by `docs-lint`'s rules): 3,797 → 3,758. Before: 13 over-long blocks, 5 essay table cells, a 651-word section, 3 asides. After: six `##` groups, three index tables, 43 headings, every block, cell and heading section inside the lint's limits, one aside.
- Frontmatter: unchanged (`description` already one sentence, 143 characters).
- Comparison (`.waterfall/compare.mjs`): 0 missing.

## Headings renamed

| Old | New |
| --- | --- |
| `## \`serveSurfaceAsMcp\`` | `## The server` (group) with `### \`serveSurfaceAsMcp\`` under it |
| `## Composing by prefix, never by merge` | `### Sibling prefixes` (under `## The projection`) |
| `## \`reroster\` — the roster follows in place` | `### \`served.reroster(surfaces)\`` |
| `## \`OwnedSurfaceConnection\` — surviving a restart of the served daemon` | `### \`OwnedSurfaceConnection\`` |
| `## Two shapes` | `#### The \`client\` factory` (the two shapes are its closing list) |
| `## Tool results — the same answer twice` | `## Tool results` |

Inbound links: the only link into this page's headings was the same-page one from the `instructions?` option row to `#reroster--the-roster-follows-in-place` (`.waterfall/anchors.md` § ref-surface-mcp). It now points at `#servedrerostersurfaces`, in this same change. No other file links into this page's anchors, so no link elsewhere needs updating.

Links out of this page (`/surface/ref-surface#…`, `/surface/ref-surface-app#…`, `/surface/ref-surface-cli`, `/surface/expose-to-agents`) are unchanged, as instructed; the integrator fixes them if those pages rename a heading.

## New entries for exports previously only in prose or in an essay cell

`instructions` (the string and function arms, SDK pin), the `client` factory, `tools:`, `projectSurface`, `ToolFailure`, `okImage` (as "When the answer is a picture"), `toInputSchema(schema?)`, `resolveExpose`, `resolveBundle`, `scopedToolName`, `McpCore<S>` · `McpSibling<S>` · `McpBundle<C, M>`, `SiblingKey`, `messageOf(error)`, `BespokeTool`, `ToolInputSchema`, the re-exported client types, and the `@kolu/surface-mcp/tools` subpath.

Two of the three asides became entry sections: "A tool name is not reversible to its origin" → facts in `Sibling prefixes`; "structuredContent and outputSchema are coupled" → `#### \`outputSchema\` is coupled to \`structuredContent\``. The "Without `onClose`, a restart costs one request" aside became `#### Without \`onClose\``. The `mutates defaults to true` caution stays as the page's one aside, trimmed to 44 words.

## Moved

| Fact | Where |
| --- | --- |
| Why a sibling's tool word is row-relative ("putting the row in front of it is what composition is for") | `why-surfaces` (pending: queued in `.waterfall/moved/why-surfaces/ref-surface-mcp.md`) |
| Why a departed name is refused by name rather than "unknown" ("unknown tells it to doubt itself") | `why-surfaces` (pending, same file) |
| The `kolu#2082` session lost to a misread transport message | `why-surfaces` (pending, same file) |
| Why both result arms are carried despite doubling a large frame | `why-surfaces` (pending, same file) |
| Why the image payload is a documented contract rather than a check | `why-surfaces` (pending, same file) |
| Why the schema glue is load-bearing (the converter is bought, the glue is owned) | `why-surfaces` (pending, same file) |
| Why `@kolu/surface-mcp/tools` is its own subpath ("an agent's tool table must not cost the transport") | `why-surfaces` (pending, same file) |

The behaviour each passage argues for stays on this page: the prefix rule, the by-name refusal and the tombstone's lifetime, the two ways a dead connection is found, both result arms with their 1.2 MB → 2.4 MB measurement, the `detail` contract with its `detail.data = image.data.slice()` example, the three `toInputSchema` normalizations and their host readers, and the subpath's zero-SDK-import guarantee.

## Cut

| Fact | Tag |
| --- | --- |
| "every name it mints is the bare one this face has **always** minted" | history |
| "`title` and `description` are bespoke-only **today**" | history (the constraint itself is kept) |
| The `juspay/olai#546` repro: a row unloading in two steps had its tombstones deleted by the middle move | history |
| "The guard that used to sit there compared each `detail` value against the base64 by identity" | history (the example span is kept as the hole the contract leaves) |
| "changing the shape of every success this adapter **has ever emitted**" → "emits" | history |
| "Two siblings … are disjoint *by construction* rather than because a merge happened to keep both" | rationale (plain fact kept: they are disjoint, not merged) |
| "A **refusal is an answer**" framing, "the trade is deliberate", "that is not a bundle", "keep the space honest" | rationale |
| "`kolu mcp --host` … the same shape of omission as #2082" | history (the `AgentDial` gap itself is kept) |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
