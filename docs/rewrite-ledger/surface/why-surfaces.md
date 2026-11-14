# why-surfaces

- Kind: explanation. Reader: someone deciding whether to declare live state as a surface, who wants the design's reasons and its price.
- Rewritten from: `f50641c6a`
- Words: 819 → 1,536. The growth is the rationale received from `ref-surface-mcp` (seven passages), `ref-surface-cli` (one) and `ref-surface` (one), listed under Moved.
- Frontmatter: unchanged (the `description` is one sentence, 143 characters).

## Headings

| Old | New |
| --- | --- |
| (new) | What hand-wiring costs |
| One declaration, three derivations | What one declaration derives |
| Why four primitives, not one | Why four primitives, not one (frozen, verbatim) |
| (new) | Where the framework stops |
| The same shape, everywhere | Where the same declaration is used |
| (new) | Why each face spells a name its own way |
| (new) | Why a tool result is carried twice |
| (new) | Why the schema bridge belongs to the framework |
| (new) | Why a refusal names what failed |
| The cost, named honestly | What it costs you |

`.waterfall/anchors.md` lists one inbound link into this page, `#why-four-primitives-not-one` from `docs/atlas/src/content/atlas/surface-attention-101.mdx:29`. That heading is frozen and its text is unchanged, so no link needed updating. The two renamed headings had no inbound links anywhere (grep over `website/src`, `README.md`, `packages/`, `docs/atlas/`).

Outbound links added, each checked against the page it points at as it stands now: `/surface/ref-surface#kolusurfaceframe-chunking`, `/surface/ref-surface#composing-siblings`, `/surface/ref-surface-mcp#without-onclose`, `/surface/ref-surface-cli`.

## Moved

Received, and integrated. Nothing in the queue was a duplicate of an argument already on this page or on `reactive-honesty`, so all nine passages landed.

From `ref-surface-mcp` (`.waterfall/moved/why-surfaces/ref-surface-mcp.md`):

| Argument | Heading it now lives under |
| --- | --- |
| A sibling's tool word is relative to its row, and each face puts the row in front of it | Why each face spells a name its own way |
| A departed name is refused by name, never as a bare "unknown" (with the `juspay/olai#546` repro for the record's lifetime) | Why a refusal names what failed |
| The session lost in `kolu#2082` to a message that named the link and read as the server dying | Why a refusal names what failed |
| Both result arms are carried, at roughly double the frame of a large result (1.2 MB → 2.4 MB) | Why a tool result is carried twice |
| The image payload is a contract the caller keeps, not a check (the identity guard that `slice()` walked past) | Why a tool result is carried twice |
| The converter is bought and the glue is owned, because real hosts read the tool list's schema | Why the schema bridge belongs to the framework |
| `@kolu/surface-mcp/tools` is its own subpath so a tool table costs no transport | Why the schema bridge belongs to the framework |

From `ref-surface-cli` (`.waterfall/moved/why-surfaces/ref-surface-cli.md`):

| Argument | Heading it now lives under |
| --- | --- |
| A shell has a real hierarchy, so a sibling is a subcommand rather than an underscore prefix | Why each face spells a name its own way |

From `ref-surface` §`@kolu/surface/frame-chunking` (`.waterfall/moved/why-surfaces/ref-surface-10.md`):

| Argument | Heading it now lives under |
| --- | --- |
| The framework pays the wire arithmetic; a size cap, an allowed file type, a refusal's wording and where bytes land stay with the app | Where the framework stops |

Nothing moved off this page.

## Cut

| Fact | Tag |
| --- | --- |
| "The honest way to render it is…" | house rhetoric (the four moving parts it introduced are kept, as a list) |
| "so streams are read-only by construction" → "so a stream is read-only" | house rhetoric ("by construction" as a flourish) |
| "The payoff is a rule the codebase actually enforces" | house rhetoric (the two-file rule itself is kept) |
| "The surface is not trying to be the whole protocol; it is the typed, reactive slice of it." | house rhetoric ("not X but Y"; said plainly under "Where the framework stops") |
| "Daemons and multi-host are not a ladder" | house rhetoric (replaced by "independent of each other", with the same two examples) |
| "Either way the lesson is the same" | house rhetoric (the lesson, redeploy together, is kept) |
| Emphasis bold on `two-file change`, `versioned wire contract`, `wire format`, `both`, and the italics on `is` and `same` | written in plain words (rule 16) |
| "the imperative escape hatch for a plain request/response call" → "the escape hatch for a plain request and response call" | implementation wording |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## Review round 1

- Opening cut to 50 words (rule 4): 51 → 34. The sentence naming what the declaration derives moved into a second paragraph. No fact was cut.
- Checks: lint passes; `house-style.mjs` reports nothing on this page.
