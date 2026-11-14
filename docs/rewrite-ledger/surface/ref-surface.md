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
| The argument for why a following wire exists ("without somewhere for that fact to stop, it reaches all the way up… the page rebuilds its tree") and "the law every link in this family is held to" | `the-client-half`, "Why a roster move does not rebuild your page" |
| "The gate makes that blind attach unrepresentable rather than merely discouraged" | `the-server-half`, "Why a dial waits for the peer to greet". It argues about the dial to a remote peer, which that page owns; `the-client-half` is about the browser facing a fleet. The cause it argues from is kept in the entry. |

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

## Server-side subpaths (old: `Per-face expose`, `surfaceRpcServerLayer`, `serveOverStdio` lifetime)

- Old lines 1214–1401. Words (`wc -w`): 2,336 → 2,423. The growth is the index table and the entry headings; before, the group was two 100-word table cells, one 190-word cell, three long paragraphs and two `<Aside>`s.
- Structure: a new `##` group with an 11-row index table, then `### Per-face \`expose\` (\`@kolu/surface/expose\`)` (frozen, verbatim) holding one `####` entry per export, then `### \`surfaceRpcServerLayer(group, handlers)\``, `### \`serveOverUnixSocket\` teardown` and `### \`serveOverStdio\` lifetime`.
- The two `<Aside>`s became entry sections: "A hand-built serve path gates itself" and "A gated face over a LIVE bundle is rebuilt when the roster moves" → `A gated face over a live bundle`.
- The nine long cells of the old `| Export | Role |` table became `####` entries, one per export; the old first-column texts are kept verbatim as the index table's link text. The `| Key | Grants |` table stays, with its cells cut to the limit and the detail moved to the list under `What a key grants`.
- The `serveOverUnixSocket` `close()` paragraph sat inside the `surfaceRpcServerLayer` entry and documents neither of that entry's exports; it is now its own `### \`serveOverUnixSocket\` teardown` entry, facts unchanged.

### Headings renamed

| Old | New | Inbound links |
| --- | --- | --- |
| `surfaceRpcServerLayer` — a member's defect is not the wire's | `surfaceRpcServerLayer(group, handlers)` | none |
| `serveOverStdio` lifetime — selected by construction | `serveOverStdio` lifetime | none |

`### Per-face \`expose\` (\`@kolu/surface/expose\`)` is unchanged (frozen; many inbound links).

### Moved

None. The `disableFatalDefects` reason, the `exposeRootedFaces` disjointness reason and the `exposureMutates` safety-default reason are short "because" clauses attached to their constraints, and stay in their entries.

### Cut

| Fact | Tag |
| --- | --- |
| "which is what every face did before this existed" (on omitting `expose`) | history |
| "The resolved value itself did change: a benign write death used to read `"error"` here and now reads `"end"`" | history |
| "as before", on who owns the process lifetime under an explicit `transport` | history |
| "which is what makes 'the same key means the same thing on every face' true rather than aspirational" — the fact is stated plainly | rationale |
| "the ONE home for it", "and the middle one is the point", "selected by construction", "a member's defect is not the wire's" | rationale |
| "but there is no listener worth having on the far side of a gate that never took effect" | rationale |
| Capitals for emphasis: `ONE`, `OWN`, `EXIST`, `LIVE`, `MUTATING` | — (style, no fact) |

The code block's `TYPE` and `NAMESPACE` capitals stay: fenced blocks are copied byte-exact.

### Dropped code spans

None (`.waterfall/compare.mjs --old-lines 1214-1401`: 0 missing).

## Client-side subpaths (old: the nine `@kolu/surface/*` client entries under `Links`)

- Words (counted by `docs-lint`'s rules): 3,871 → 4,139. The growth is the new group index table, four new `####` entry sections and the export table each entry now opens with. Before: nine `###` blocks of running prose with tables buried inside them, eight table cells over 40 words, two sections over the 300-word limit, one `<Aside>`. After: nine entries, every block, cell and heading section inside the lint's limits, no asides.
- The nine old `###` headings became the entries of a new `## Client-side subpaths` group, opened by one paragraph and an index table (`Entry · Subpath · What it is`) whose first column links to each entry.
- New `####` sections, so no entry exceeds the 300-word section limit: `The face and its leaves`, `The shapes a projecting face holds`, `Rooted-bundle lookups`, `The retry fence`, `` `label` and `onRetry` `` (under `@kolu/surface/client`); `` `SurfaceUpstreamRefused` ``, `` `messageOf(error)` `` (under `@kolu/surface/errors`); `The bounded item read`, `Telling an empty open from a failure` (under `@kolu/surface/first-frame`); `The Schema to JSON-Schema bridge`, `Names that live on other subpaths` (under `@kolu/surface/verbs`).
- The one `<Aside>` ("The MCP adapter still exports the old names") became a fact in the `@kolu/surface/verbs` entry: `@kolu/surface-mcp` re-exports `SurfaceVerb` and `SurfaceVerbInputSchema` as `BespokeTool` and `ToolInputSchema`, and new code imports them from `@kolu/surface/verbs`.
- Every export that was only named in prose now has a row in its entry's export table: `SurfaceClientCallable`, `OwnedSurfaceConnection<Client>`, `SiblingKey`, `disposeQuietly(conn)`, `RootedSurfaceClients`, `clientAt(bundle, sibling)`, `declarationTarget(bundle, sibling)`, `rootedBundleEntries(core, siblings)`, `notABundleDetail(seam)`.

### Headings renamed

| Old anchor | New anchor | Inbound links |
| --- | --- | --- |
| `#the-effectcallback-edge-kolusurfacerun-stream` | `#running-a-stream-outside-effect-kolusurfacerun-stream` | None (`.waterfall/anchors.md` and a repo-wide grep). |
| `#the-bounded-wait-scaffold-kolusurfacewait` | `#bounded-waits-kolusurfacewait` | None. |
| `#pollonchange-kolusurfacepoll-on-change--the-client-pulse-then-requery-core` | `#pollonchange-kolusurfacepoll-on-change` | None. |

Kept verbatim, because they carry inbound links and are already plain names: "The face and its retry fence (`@kolu/surface/client`)", "Per-subscription liveness (`@kolu/surface/subscriptions`)", "The tagged-error vocabulary (`@kolu/surface/errors`)", "The classified failure ledger (`@kolu/surface/failure-ledger`)", "The projection vocabulary (`@kolu/surface/verbs`)". "One-shot snapshot reads (`@kolu/surface/first-frame`)" is kept too: it is already a plain name.

The two same-page links that read `#per-subscription-liveness` now read `#per-subscription-liveness-kolusurfacesubscriptions`, the anchor that heading actually has.

### Moved

None. What is left of each design argument is a short "because" clause inside its entry, so nothing was queued to an explanation page.

### Cut

| Fact | Tag |
| --- | --- |
| "Both faces held their own copy of that argument, in different signatures, until it moved beside the shape it is a property of" (`disposeQuietly`) | history |
| "`@kolu/surface-cli` did exactly that, and a member's declared refusal came back on the exit code that means 'nothing is serving here' … so one member gave two answers depending on a flag" | history |
| "a night of unreachable attempts spends the rejection budget, and the give-up line names a count that never happened" (the issue reference and both code spans are kept) | history |
| "shared by every consumer that hand-rolled it before" (the three named consumers are kept) | history |
| "so the Solid consumers that already import it there are unchanged" (the re-export from `@kolu/surface/solid` is kept) | history |
| "shipped from `@kolu/surface-mcp` as …, so existing consumers keep compiling" (the re-export itself is kept) | history |
| "until then", on the #2297 issue | history |
| "The empty open is TAGGED, and that is the whole point" (the fact is the entry's heading and its first two sentences) | rationale |
| "never — terminal by construction" → "Never." | rationale |
| "That single home is the requirement, not tidiness" → "The single home is the requirement." | rationale |
| "neither could import the other's without pointing a face at a face" (the reason survives as "so neither projecting face has to import the other's copy") | rationale |
| "The disease it makes unrepresentable: a bounded budget whose increment predicate differs from its ceiling predicate" → "The increment predicate and the ceiling predicate are one predicate here" | rationale |
| Capitals for emphasis: `DIRECTLY`, `BOUNDED`, `ITEM`, `UNCERTAIN`, `ONE`, `BOTH`, `RUN`, `EITHER`, `OR`, `CLIENT`, `PULSE`, `SAME`, `EMPTY`, `NOT`, `DATA`, `AFTER`, `UNBOUNDED`, `EVERY`, `SEPARATOR`, `NAMES` | — (style, no fact) |

### Dropped code spans

None (`.waterfall/compare.mjs --old-lines 1402-1787`: 0 missing).

## Liveness and health

- Words: 1,031 → 1,040. Before: six prose blocks, one of them 95 words, plus a five-row table and eight bullets under `### The readout`. After: an index table, six `###` entries, the readout table kept verbatim, and one `####` for the grace window.
- Heading `## Liveness and health` kept (inbound `#liveness-and-health`). `### The readout` kept (inbound from `ref-surface-app`).
- New entries for exports only named in prose: `probeSurfaceLive(client)` / `probeSurfaceIdentity(client)`, `surfaceProcessId()`, `monotonicNow()`, `createLiveSignal(transport, opts)`, `client.health()`. New `####`: `presentingDown` and the grace window.
- No headings renamed, so no inbound link needs an update.
- Capitals written out: `UPTIME`/`RESTART` axes, `DISTINCT`, `THUNK`, `GRACED`, `ONCE`, `IN`, `INSTANTLY`, `INSTANTANEOUS`, `IMMEDIATELY`, `NOT`.
- Code and the old page did not disagree.

### Moved

| Fact | Where |
| --- | --- |
| "the one verdict the framework does own, because it is the one an app kept getting wrong" | `reactive-honesty` (pending; queued in `.waterfall/moved/reactive-honesty/ref-surface-09.md`) |
| "that gap is where the green-light-over-an-empty-collection bug lives" | `reactive-honesty` (pending, same file) |
| Why `presentingDown` exists: apps flashing a full-screen alarm on every sub-second forced reconnect, and each smoothing it by hand | `reactive-honesty` (pending, same file) |

### Cut

| Fact | Tag |
| --- | --- |
| "Liveness is on by construction" as a claim | rationale |
| "It is a **thunk** … and that is not decoration" | rationale |
| "one door, two spellings" (the fact that both spellings mean the same is kept) | rationale |
| "There is deliberately no way to inject one" → "There is no way to inject one" | rationale |

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## Recognizing a transport-loss end (for reconnect retry)

- Words: 1,321 → 1,363. Before: one 110-word opener, two `###` with long prose blocks, two tables and a 220-word closing paragraph. After: an index table, three entries, seven `####` sections, both tables kept verbatim.
- Headings renamed:
  - `Recognizing a transport-loss end (for reconnect retry)` → `Transport loss and frame limits` (`#recognizing-a-transport-loss-end-for-reconnect-retry` → `#transport-loss-and-frame-limits`). No inbound links in `.waterfall/anchors.md`.
  - `Fitting under it (@kolu/surface/frame-chunking)` → `@kolu/surface/frame-chunking` (`#fitting-under-it-kolusurfaceframe-chunking` → `#kolusurfaceframe-chunking`). No inbound links.
  - `### The wire's frame cap (\`@kolu/surface/frame-limit\`)` kept verbatim (inbound from `ref-surface-app.mdx:85`).
- New entry for the two predicates that were only named in prose: `isSurfaceStdioTransportClosed(reason)` / `isSurfaceRelayTransportLost(reason)`. New `####`: a malformed frame ends the link; an oversized frame is a closed socket; what a member author owns; what the derivation turns on; what stays with the app; the framework's own stream frames.
- Capitals written out: `UNCHANGED`, `OUT`, `OUTBOUND STREAM`, `DRAIN`, `OWN`. `BETA-ASSUMPTION` kept (a literal marker).
- Code and the old page did not disagree.

### Moved

| Fact | Where |
| --- | --- |
| "Chunking is wire physics; what you'll accept is not." | `why-surfaces` (pending; queued in `.waterfall/moved/why-surfaces/ref-surface-10.md`) |

### Cut

| Fact | Tag |
| --- | --- |
| "The sender no longer lets a `deltas` frame scale with the set" → stated as what the sender does | history |
| "that arithmetic has more terms than it looks like it has" / "so nobody derives it a third time" kept as the module's purpose, without the flourish | rationale |
| "rather than rotting a comment" (the test fact is kept) | rationale |

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## Cross-cutting invariants

- Words: 312 → 416. Before: six bullets, one of them 150 words. After: an index table, five `###` entries, one `####` for the un-enrolled refs, and a three-row table for the raw refs.
- Heading `## Cross-cutting invariants` kept. No inbound links into this section.
- New headings, all from the bullets' own run-in bold: `Snapshot-then-deltas`, `` `patch` is a cross-runtime contract ``, `The group and the handlers are one route set`, `Raw streams join health`, `The 2-file invariant`, and `#### .use() is the default; the un-enrolled ref is the carve-out`.
- `.streams.X.unenrolled`, `.collections.X.unenrolledKeys` and `.collections.X.unenrolledDeltas` moved from the 150-word bullet into a table, each with its `iff` condition intact.
- Capitals written out: `AND`, `NOT`.
- Code and the old page did not disagree.

### Moved

None.

### Cut

| Fact | Tag |
| --- | --- |
| "a deliberate carve-out" → "the carve-out" | rationale |

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
