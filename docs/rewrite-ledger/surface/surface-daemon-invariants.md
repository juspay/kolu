# surface-daemon-invariants

- Kind: reference (Surface, `Daemons · Reference`). Reader: someone writing or supervising a surface daemon who needs the rule that binds a case in front of them.
- Rewritten from: `f50641c6a`
- Words (counted by `.waterfall/words.mjs`): 1,503 → 1,849. The growth is the index tables and 27 entry headings; no fact was added.
- Frontmatter: `description` 163 → 151 characters ("The rules a surface daemon holds: single-instance, teardown order, a version-agnostic control core, and ordered contracts with match-only builds."). All other keys unchanged.
- Shape: three `##` groups, each a short line plus an index table (`Rule` · `What it says`), then one `###` entry per rule. Before: three tables whose 12 longest cells ran to 118 words. After: every cell one line, every rule an entry, no asides on the page.
- Comparison (`.waterfall/compare.mjs`): 0 missing.

## Headings

| Old | New |
| --- | --- |
| The three make-illegal pins | Mistakes the kit makes impossible |

The 27 invariant names are kept verbatim, as the index rows' link text and as
the `###` headings, because the name of an invariant is what a reader searches
for and what the Atlas notes cite. `Boundary`, `Lifecycle` and
`Identity and versioning` are unchanged.

No inbound link points at any heading of this page (`.waterfall/anchors.md`
lists none). The page itself is linked, without an anchor, from
`website/src/content/surface/glossary.mdx:40`,
`website/src/content/surface/recycle-and-upgrade.mdx:65` and
`website/src/content/surface/ref-surface-supervisor.mdx`; those links still
resolve.

## Moved

| Fact | Where |
| --- | --- |
| "The Effect-4 framing change (oRPC base64+newline → Effect RPC ndjson) was a declared flag day, not a negotiation — negotiation happens inside the protocol being replaced, so a previous-epoch peer cannot be asked anything at all." | `the-daemon-spine` (pending): queued verbatim in `.waterfall/moved/the-daemon-spine/surface-daemon-invariants.md` |

## Cut

No API fact is cut. What went:

| Fact | Tag |
| --- | --- |
| "They are facts about the machinery, not advice" (the opening's claim about itself) | rationale |
| "From this epoch forward the frozen contract holds again, unchanged." | history |
| "The rationale is testability, and the partition preserves it completely"; "Process ownership is a different thing and now says so" (the facts stay: the value core is drivable in-process, ownership lives in `daemonProcessMain` and nowhere else) | rationale |
| "a shutting-down daemon no longer leaves still-connected clients being served by a 'closed' socket" → stated as the present fact | history |
| "a `git worktree remove` can no longer strand a daemon forever" → "cannot strand a daemon forever" | history |
| "the untouched `SocketSquatterForeignError` path" → the path, without "untouched" | history |
| "which is the point" (after the `core.drain` defect rule) | rationale |
| Capitals for emphasis: `ONE` carve-out, `NOT` | duplicate (the word in lower case) |

## Dropped code spans

None. `.waterfall/compare.mjs` reports 0 missing: every code span, every table
first-column entry and every rule name of `f50641c6a` is on the page.
