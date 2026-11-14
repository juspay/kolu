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

## Serving a surface

- Old lines 276–568 at `f50641c6a`. Words (`.waterfall/words.mjs`): 3,306 → 3,183.
- Structure: one short opening, then the group's index table (15 rows), then one `###` per export, with `####` sections where an entry passed the 300-word section limit. The old shape was one 1,100-word bullet block under `## Serving a surface` plus three `###`s and one `<Aside>`. No `<Aside>` in the draft.
- New entries for exports and dependency shapes that were only named in prose or in a bullet: `SurfaceRuntimeHandle` (with `#### What settles done`, `#### Nothing you hand the engine may throw`, `#### close()`), `cells` / `collections` / `streams` / `procedures` dependencies, `mirrorRemoteSurface`, `Stores and channels`, `implementSurfaces(surfaces, base, deps)`, `implementSurfacesOnPublisher(surfaces, base, deps)`, `siblingDroppedDetail(key)`, `superviseTerminalSource(runtime, terminal)`.
- The `<Aside type="caution" title="Which serve door re-reads them">` became the entry section `#### Which serve door re-reads group and handlers`.

### Headings renamed

| Old | New | Inbound links |
| --- | --- | --- |
| `### On a shared publisher — a distinct constructor, not a flag` (`#on-a-shared-publisher--a-distinct-constructor-not-a-flag`) | `### `implementSurfaceOnPublisher(surface, deps, channel)`` (`#implementsurfaceonpublishersurface-deps-channel`) | none |
| `### A rooted bundle whose siblings move — `implementRootedSurfaces`` (`#a-rooted-bundle-whose-siblings-move--implementrootedsurfaces`) | `### `implementRootedSurfaces(core, base, deps)`` (`#implementrootedsurfacescore-base-deps`) | `website/src/content/surface/ref-surface-app.mdx:55`, `:772` (other rewriter); `website/src/content/surface/ref-surface.mdx:1324` (draft 08's range); `:343` fixed inside this draft |
| `### Composing a local runtime onto a re-served one` | `### `extendSurface(base, ext)`` (`#extendsurfacebase-ext`) | none |

Links out of this draft that other drafters own: `#per-face-expose-kolusurfaceexpose` (frozen heading, used twice) and `#what-settles-done` (same-draft). Cross-page links to `ref-surface-app` anchors are unchanged from the old text.

### Moved

None. No passage was long-form argument once the rhetoric was removed; every reason that explains a constraint stayed in its entry.

### Cut

| Fact | Tag |
| --- | --- |
| "That is safe because every fallible *periodic* thing is deliberately off this channel" → "Every fallible periodic thing is deliberately off this channel" (the "that is safe because" flourish) | rationale |
| "**Composition is incremental, and that is the whole point.**" → the heading `Composition is incremental` | rationale |
| "the shape a consumer reaches for when the framework has no door" (aside on re-implementing the whole map) | rationale |
| "Deliberate: a source nobody drives is damage" → "a source nobody drives is damage" | rationale |
| "Said out loud because forgetting it fails *silently*" → "Forgetting it fails silently" | rationale |
| "the app's job, for now" in the heading "How a client learns the roster moved" | history |
| "`reServeSurface` used to hand-roll" → "the framework home for the terminal-source teardown" | history |
| "by construction" in the `CellConnector` interruption sentence | rationale |
| Emphasis capitals: `WIRING`, `MUST`, `CONSUME`, `REJECTS`, `ERROR`, `MUTE`, `CONTAINED`, `FIBER`, `PAIR`, `MOVES`, `THUNK`-style `OPENS`/`LET GO`/`HOLDS`/`ACTS`/`ANYWHERE`/`REPORTS`/`CALL`/`NOTICES`, `ROOT`, `ONE`, `OWNS` | implementation |

### Dropped code spans

None (`.waterfall/compare.mjs … --old-lines 276-568`: 0 missing).

## The reactor (reactive bridge)

- Words: 1,857 → 2,084 (`wc -w` over the old lines 569–648 at `f50641c6a` and over the draft). The growth is the index table and 15 entry headings; the prose shrank.
- Structure before: one intro paragraph, one 15-row table whose cells ran to 160 words, three trailing essays (the `$` face, the `derived.cell` guarantees, `scan`'s stop-hold law) and two bullet opt-ins. After: a short intro, an index table (`Export | Subpath | What it is`), one `###` per export, and `####` sections where an entry exceeded the 300-word limit (`The loop guard`, `The stop-hold error law`, `The $ sibling-read face`, `What a derived cell guarantees`, `CollectionSpec.equals?`, `CollectionImplDeps.materializeSiblingView?`).
- `derived.cell(node)` and `derived.cell(($) => …)` share one entry, as the old page paired them; both index rows link to `#derivedcellnode--derivedcell--`.
- Headings renamed with inbound links: none. The `##` heading text is unchanged; every `###`/`####` is new. No inbound link (`.waterfall/anchors.md`) pointed into these lines.
- Code and the old page did not disagree anywhere in this range.

### Moved

| Fact | Where |
| --- | --- |
| The argument for `label` being required ("a rule held by memory… fires anonymously on exactly the source nobody expected to loop") | `reactive-honesty` (pending; queued in `.waterfall/moved/reactive-honesty/ref-surface-03.md`). The entry keeps the facts: required, diagnostics only, no field can silence the guard. |

### Cut

| Fact | Tag |
| --- | --- |
| "the one home for the fuse, previously re-spelled as app-local twins" (`everyMsOr`) | history |
| "(SR9)" on `reactiveFamily` and `derived.registry` | implementation |
| "The split of the old `registryFromFamily`…" rephrased as a plain statement of the split; the "old" framing | history |
| "by construction" as a flourish on the lint ban and on the wire-read-only guarantee (the facts stay) | rationale |
| Capitals for emphasis: `PUSH`, `POLL`, `TRACKED`, `HELD`, `STOP`, `REQUIRED`, `ANNOUNCES`, `UNDER`, `ONE`, `OTHER`, `SIBLING`, `COLLECTION`, `SAFE ONLY`, `PURE`, `EXPENSIVE`, `JOIN`, `LAST`, `WHOLE` | — (style, no fact) |

The incident behind the loop guard stays as one clause ("One such cycle froze a
kolu process (HTTP dead, `SIGTERM` ignored)"), because it is the constraint's
short reason and carries the `SIGTERM` span.

### Dropped code spans

None (`.waterfall/compare.mjs --old-lines 569-648`: 0 missing).

## Consuming in SolidJS

- Words: 2,975 → 3,118 (`wc -w` over the old lines 649–897 at `f50641c6a` and over the draft). The growth is the index table, the entry headings and the aside turned into a section.
- Structure before: prose for `surfaceClient`, one hook table with 120-word cells, seven essay paragraphs (procedures, `.rpc`, push reconciliation, the bundle, `reroster`, `Subscription`, `.updated`/`.changed`), one `<Aside>` and the frame-socket subsection. After: an index table (`Export | Subpath | What it is`), one `###` per export, and `####` sections where an entry exceeded the limits.
- The `<Aside type="caution" title="Wire links must carry a watchdog">` became the entry section `#### Wire links must carry a watchdog` under `surfaceClient`, keeping every fact (the brand, `directDispatch`, the three wire link factories).
- Long table cells became short cells plus a list of facts, as the model does: the hook table, the `surfaceClients` bundle table, the `Subscription` placement table and the `fold` behaviour table all keep their first-column entries and all their code spans.
- New entries for exports the old page only named in prose: `Subscription<T>`, `surfaceClientsHealth(clients)`, `.streams.X.useCollection(input, descriptor)`, `useCollectionDeltas`.
- Code and the old page did not disagree anywhere in this range.

### Headings renamed

| Old | New | Inbound links |
| --- | --- | --- |
| `### The frame socket — \`fold\` on a \`deltas\` collection` (`#the-frame-socket--fold-on-a-deltas-collection`) | `### \`fold\` on a \`deltas\` collection` (`#fold-on-a-deltas-collection`) | One, same-page (old line 669, the collection hook row). Updated in this draft; the index row and the `Subscription` collection row link to the new anchor. No cross-page link exists. |

The `##` heading text is unchanged, so `#consuming-in-solidjs` (linked from
`ref-surface-app.mdx:664` and from the page's own line 57) still resolves.

### Links left for the integrator

- `[`arrayKey`](#declaring-array-identity--arraykey)` keeps the old anchor. The heading lives in the "Defining a surface" section (`01-defining.mdx`), whose rewriter may rename it.
- `[the wire's frame cap](#the-wires-frame-cap-kolusurfaceframe-limit)` replaces the old page's bare "under the wire's frame budget above". The heading is `### The wire's frame cap (\`@kolu/surface/frame-limit\`)` in `10-transport-loss.mdx`, which keeps that anchor.

### Moved

None. The one long argument (the `.rpc` union-budget split) stays as a one-clause
reason inside the `.rpc` entry, since it explains the constraint the reader meets
(`unknown` per leaf).

### Cut

| Fact | Tag |
| --- | --- |
| "exactly where zod's `.parse` used to run" → "where zod's `.parse` runs" | history |
| "That is what lets the call be part of a program rather than the whole of one" (the "not X but Y" set piece; the combinator facts stay) | rationale |
| "a signal a *reader* owns is a rule kept by convention, and the second reader is silently blind rather than broken" (bundle notification) | rationale |
| Capitals for emphasis: `DECLARED`, `IDENTITY`, `RECYCLES`, `REPEATS`, `MOVES`, `NAMES`, `PER-KEY`, `WHOLE`, `ONLY`, `NO`, `DIRECTLY`, `BOUNDED`, `RE-INITIALIZES`, `SYNCHRONOUSLY`, `VERBATIM`, `MUST`, `CLIENT STORE's`, `VALUE-diffed`, `REPLACEMENT`, `INVALIDATES`, `THROWS`, `NARROWED`, `reserved` | — (style, no fact) |

### Dropped code spans

None (`.waterfall/compare.mjs --old-lines 649-897`: 0 missing).

## The dispatch seam — `@kolu/surface/link`

- Words (counted by `docs-lint`'s rules): 236 → 325. Growth is the index table and six entry headings. Before: two prose paragraphs and one `| Export | Role |` table with cells up to 60 words. After: index table plus one `###` per export, every block and cell inside the lint's limits.
- Structure: intro (2 sentences) · index table · `SurfaceDispatch` (the `interface` code block verbatim, plus the two rules as a list) · `WireStatus` (the four values as a table) · `WatchableWire` · `WireTransport` · `brandHalfOpenDispatch` · `isHalfOpenDispatch` · `brandDirectDispatch` · `isDirectDispatch`.
- `##` heading kept verbatim. No inbound links point into this section.
- Headings renamed: none. New `###` headings only.
- Capitals removed: "PROTOCOL" → protocol.

### Moved

None.

### Cut

| Fact | Tag |
| --- | --- |
| "erased" as a word for the value in the opening sentence ("one erased, transport-neutral value" → "one transport-neutral value"); the erasure is still stated in the `SurfaceDispatch` entry and the index row | duplicate |
| "its constant-`true` liveness is honest by construction" rewritten as "reports constant `true` liveness, because there is no wire to lose" | rationale |

### Dropped code spans

None (`.waterfall/compare.mjs --old-lines 898-929`: 0 missing).

## Links

- Words (counted by `docs-lint`'s rules): 2,606 → 2,632. Before: the link table plus ten prose blocks, several over 80 words, with the API facts inside running argument. After: an index table and 15 entries, each a sentence of what it is, a members or options table and a list of facts.
- Structure: intro (kept, with the [How to choose a link](/surface/choose-a-link) link) · index table (`Link | Import | What it is`, the six old first-column entries verbatim as link text, plus rows for the other entries) · `Every wire link` (the shared `group`/async/`WireLink` facts) · `websocketLink` · `websocketLink().diagnostics` · `stdioLink` · `socketDuplexLink` · `unixSocketLink` · `directDispatch` · `Stream delivery on a wire link` · `The keep-alive numbers — @kolu/surface/keepAlive` · `Failure and re-subscription across re-dials` · `followingWire` (with `####` for `adopt` and `dispose`, a call in flight, and `establishments()`) · `createLoopbackPair() · greetLoopback · stallLoopback` · `The stdio readiness gate — @kolu/surface/links/readiness` (with `####` for the `death` field and who writes the banner) · `serveOverUnixSocket` · `isPrivateOwnedDir(dir): boolean`.
- New entries for exports that were only named in prose: `createLoopbackPair()` / `greetLoopback` / `stallLoopback`, `isPrivateOwnedDir(dir): boolean`, and the three keep-alive constants as a table (`RPC_PING_INTERVAL_MS`, `RPC_PING_TIMEOUT_MS`, `RPC_PING_FATAL_SILENCE_MS`).
- The four `classification` verdicts and the two `death` unions became tables instead of sentences.

### Headings renamed

| Old | New | Inbound links |
| --- | --- | --- |
| `### A stalled stream consumer holds up only its own stream` (`#a-stalled-stream-consumer-holds-up-only-its-own-stream`) | `### Stream delivery on a wire link` (`#stream-delivery-on-a-wire-link`) | none |
| `### The keep-alive is a backstop, not the liveness verdict` (`#the-keep-alive-is-a-backstop-not-the-liveness-verdict`) | `### The keep-alive numbers — @kolu/surface/keepAlive` (`#the-keep-alive-numbers--kolusurfacekeepalive`) | none |
| `### A wire that follows its generations — followingWire` (`#a-wire-that-follows-its-generations--followingwire`) | `` ### `followingWire` `` (`#followingwire`) | `website/src/content/surface/ref-surface-app.mdx:683` (cross) and the same page's Liveness section (`ref-surface.mdx:1825` at `f50641c6a`). Both are owned by other rewriters in this wave and still need the link updated. |

Kept verbatim because they are plain names with inbound links: `### Failure and re-subscription across re-dials`, `### websocketLink().diagnostics`, `### The stdio readiness gate — @kolu/surface/links/readiness`.

### Moved

| Fact | Where |
| --- | --- |
| The argument for why a following wire exists ("without somewhere for that fact to stop, it reaches all the way up… the page rebuilds its tree") and "the law every link in this family is held to" | `the-client-half` (pending; queued in `.waterfall/moved/the-client-half/ref-surface-06.md`) |
| "The gate makes that blind attach unrepresentable rather than merely discouraged" | `the-client-half` (pending; same queue file). The cause it argues from is kept in the entry. |

### Cut

| Fact | Tag |
| --- | --- |
| "silence is what the incident behind this seam was made of: a daemon whose listening socket went comatose after a suspend/resume wrote not one error line for the rest of its life" (the `log` option keeps "required, because the alternative default is silence") | history |
| "That last row is the reason the field exists… before this nothing anywhere recorded that it happened" on `"ended-without-open"`; the behaviour (swallowed, publishes no status, never reaches the server) is kept | history |
| "It is honest when the thing underneath is a socket the link itself re-dials", "which is the whole claim a roster move makes — the wire never went anywhere", "which is the whole point of this wire" | rationale |
| "is shaped differently on purpose" on `directDispatch`; the shape itself is kept | rationale |
| Capitals for emphasis: `PROTOCOL`, `CONNECTIONS`, `LOCAL`, `BOTH`, `BIND-TIME`, `FIRST`, `OWNS` | — (style, no fact) |

### Dropped code spans

None (`.waterfall/compare.mjs --old-lines 930-1213`: 0 missing).
