# `surface/ref-surface-map`

Kind: reference. Reader: a developer calling `@kolu/surface-map` — declaring a map, serving one, or consuming one in a client.

Rewritten from: f50641c6a

Words: 4,867 → 4,950 (`.waterfall/words.mjs`). A reference page is exempt from the page-length limit; the growth is index tables and per-export headings replacing 28 long prose blocks.

Comparison: `node .waterfall/compare.mjs website/src/content/surface/ref-surface-map.mdx` — 0 missing. Lint: passes.

## Frontmatter

Unchanged.

## Headings

The page was six `##` prose sections; it is now five `##` groups, each opening with an index table, and one `###` entry per export.

| Old heading | New heading |
| --- | --- |
| `## The three halves` | `## Declaring, serving and connecting a map` (entries: `defineSurfaceMap(…)`, `SurfaceMap`, `serveSurfaceMap(map, registry)`, `connectSurfaceMap(map, transport, opts?)`, `ConnectSurfaceMapOptions<Key>`, `testMembershipId()`, the `/evidence` vocabulary) |
| `## Nested siblings` | kept (sub-entries: the sibling tag grammar, what a sibling face carries, sibling names that are refused) |
| `## The client` | kept (entries: `entries`, `live`, `entry(key)`, `useEntry(keyAccessor)`, `dispose()`, the four `Entry` members, `scopedByEntry`, `watchByEntry`) |
| `## \`scopedByEntry\` — per-key state retained by membership` | `### \`scopedByEntry(client, active, build)\`` |
| `## \`watchByEntry\` — per-member attention, watched eagerly` | `### \`watchByEntry(client, cell, items, onRaise)\`` |
| `## \`EntryStatus<Failure, Conn>\` — the projected per-entry status` | `## Entry status`, with entries `EntryStatus<Failure, Conn>`, `MembershipId`, `EntryState` and `ObservedEntryStatus`, `UnobservableEntry`, `FailureRecord<Failure>`, `isSettling(state)` |
| `## \`MapRegistry<K>\` — the server seam` | `## The server seam`, with entries `MapRegistry<K>`, `EntrySession` / `EntryFault`, `MapRejectionSchema` |
| `## The fold envelope` | kept |
| `## \`KeyCodec<K>\`` | kept |
| `## Typed sub ends and the clock seam` | split into the entries `entry(key).procedures`, `entry(key).rpc` and `entry(key).clock.toLocal(remoteMs)` under `## The client` |

Inbound links: the only recorded link into this page's headings is same-page, `#nested-siblings` (`.waterfall/anchors.md`), and that heading is kept. The page's outbound link to `/surface/ref-surface#declaring-a-client-error-policy--definesurfacewithpolicy` is unchanged. No other page needs an update.

## Moved

| Fact | Where |
| --- | --- |
| "Why a sibling rather than more members on the entry surface?" (its own release cadence and version; one spec two daemons must agree about) | `entry-contracts`, "Why a sibling is a whole surface". The reference keeps the short clause. The passage's third item, "its own clock", is not on the explanation page: a sibling face has no clock of its own (this page's "What a sibling face carries" says the clock stays the entry's). |
| The drishti#102 "dot connected, word connecting" divergence as the argument for one connection authority | `entry-contracts`, "Why the connection word and the dot have one source". The reference keeps the facts. |

## Cut

| Fact | Tag |
| --- | --- |
| "a sibling-free map is byte-identical to one defined before siblings existed" | history |
| "Scoping is **now** a tag rewrite… so there is no step **left** that could strip the half-open brand" (the fact is kept, the history framing is not) | history |
| `ConnectionInfoSchema.log` "**now** is `EvidenceLineSchema` rather than a re-declared twin" (the identity is kept as a plain fact) | history |
| "Undeclared, they were encoded against a union that does not contain them and reached the caller as an opaque string defect carrying only the parse prose — the exact flattening the declaration exists to kill" (the behaviour it buys, telling a respawning daemon from a terminal fault, is kept) | history |
| "'the two drifted' has no spelling rather than a pin that watches for it" | rationale (the identity of `LogEntry`/`EvidenceLine` is kept) |
| Why there is no `absent` arm, why `failed` is not floored, why evidence pairs with its reason, why the envelope omits void, why keys are codecs, why the clock is per entry — argued at length | duplicate (`entry-contracts`, which already argues each; the constraints themselves are kept in the entries) |
| "by construction", "the one place", "That is the whole point"-style flourishes; emphasis capitals (`ONE`, `NOT`, `SAME`, `THUNK`, `CLIENT`, `FACE`) | rationale / style, per the brief |

## Dropped code spans

None. The comparison script reports 0 missing: every code block, `<Snippet>` tag, inline code span and table first-column entry of the old page is on the new one. Two spans that the old page escaped for a table cell (`ObservedEntryStatus \| { kind: "not-a-member" }`, `number \| null`) now sit in prose with a plain `|`, and the escaped form is kept where it is still inside a cell.
