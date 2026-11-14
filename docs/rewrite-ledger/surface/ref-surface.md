# ref-surface

- Kind: reference. Reader: someone looking up an `@kolu/surface` export.
- Rewritten from: `f50641c6a`
- Committed one `##` section at a time.

## Defining a surface

- Words (counted by `docs-lint`'s rules): 2,064 → 2,259. The growth is the index table and the new entry headings. Before: six `###` sections with multi-fact paragraphs. After: 12 index rows, 12 `###` entries and three `####` sections, every block inside the lint's limits, no asides.
- New entries for things that were only prose or a type bound: `WireSchema<T>` (the `Schema.Codec<T, unknown, never, never>` bound and the two fixed key spellings, now a table), `Surface<S>`, `ProcedureSpec.error`, `probeSurfaceClockNow(client)` / `measureSurfaceClockOffset(client)` (with `probeSurfaceLive`, `probeSurfaceIdentity`, `ClockNowUnavailableError`), `mergeDisjointGroups({ <label>: group })` and `isStandaloneRoot(surface)` / `notStandaloneRootDetail(seam, what, tagPrefix, alternative)`, which were buried in the old "Composing siblings" section.
- The `arrayKey` entry's three long paragraphs became `#### Name a field the schema types required and non-nullable` and `#### Three things `arrayKey` is not`, with the collection-delivery and positional-merge facts kept as prose under the entry.
- The client-policy entry's registration paragraph became `#### Registering the interpreter`.

### Headings renamed

| Old | New | Inbound links |
| --- | --- | --- |
| The wire shape — one flat tag namespace | `Surface<S>` | none |
| Declared errors — tagged classes, narrowed by `_tag` | `ProcedureSpec.error` | none |

Kept verbatim because links point at them: `Declaring array identity — `arrayKey`` (same-page, old line 725), `Composing siblings` (`ref-surface-app.mdx:557`, `ref-surface-mcp.mdx:73`), `Declaring a client error policy — `defineSurfaceWithPolicy`` (`ref-surface-app.mdx:881`, `ref-surface-map.mdx:75`). `The three reserved members` is kept; the probe functions it named moved into their own entry below it.

No link needed updating: neither renamed heading had an inbound link in `.waterfall/anchors.md`.

### Moved

None. Every reason in this section is the short "because" that explains a constraint, which the model keeps in the entry.

### Cut

| Fact | Tag |
| --- | --- |
| "This replaces the oRPC-era `errors: ErrorMap` keyed by magic code string" — kept as the plain fact that there is no `errors: ErrorMap` keyed by a code string, without the era | history |
| "That is a type bound, not a convention" kept; "Two spellings are **laws**", "the one reading of the rooted-root law", "*It takes the erasure on itself*", "That union is what makes the narrowing honest in both directions" — house rhetoric around facts that are kept verbatim beside them | rationale |
| Emphasis capitals: `REQUIRED`, `POSITION`, `THUNK`-style bolding and `**no**`/`**laws**`/`**proves**` emphasis | implementation (presentation only; the facts stay) |

### Dropped code spans

None (`.waterfall/compare.mjs --old-lines 15-275`: 0 missing).
