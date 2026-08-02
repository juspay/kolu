# W6 — Surface docs for the Effect 4 surface

Scope: `website/` only (plus two package READMEs). No `packages/**` source was
touched; the sibling agent's in-flight edits under
`packages/surface-daemon-supervisor` and `packages/padi` were read, never written.

## Gates

- **Website build: GREEN.** `just website::build` (pnpm install + `astro build` +
  pagefind) — 71 pages indexed, no errors. Run before the first edit (baseline)
  and after the last.
- **`website/pnpm-lock.yaml` unchanged** — md5 `4bd465f36637ac3cca331f3bf94b4659`
  before and after. The root lockfile was never touched.
- **Formatting skipped**: every edited file is `.mdx` or `.md`; biome does not
  lint MDX.

## Pages touched

### The seven Reference pages (the rule's table)

| Page | What moved |
| --- | --- |
| `ref-surface.mdx` | Largest rewrite. Effect Schema + the two spelling laws (`optionalKey` / `withDecodingDefaultKey`); a new **"The wire shape — one flat tag namespace"** section (`Surface<S>` = `{ group, tagPrefix, spec, descriptors }`, the claim-walk + size assertion, the `/`-in-a-name refusal, why `group` is `Rpc.Any`-erased); **"Declared errors"** rewritten for `ProcedureSpec.error` + `Schema.TaggedErrorClass` + `isDefinedError`/`safe`/`SafeResult` and `Effect.die` for the undeclared arm; the three reserved members restated as `surface/system/{live,identity,clockNow}` tags; `composeSurfaceContracts` → `{ group, siblings }` and why it prefixes rather than merges. `implementSurface` now returns `{ group, handlers, ctx, done, close }` + `opts.identity`, with the route-set-identity boot assertion; dep shapes updated (Effect `Stream` sources, Effect-returning procedures, `Effect.promise` vs `tryPromise`); `inMemoryPublisher` added to the adapter table and `publisherChannel` de-oRPC'd. `extendSurface`'s `ServedSurface` is `{ surface, handlers, done, close }`. Solid section: `surfaceClient(surface, transport)`, `.procedures.<ns>.<verb>(input)` returning `ProcedureResult<O,E>` (no `{signal}` arg — the bound type takes input only), the Encoded-vs-decoded input rule, `.rpc` as the structural `SurfaceFace`, `surfaceClients(transport, map)` + `surfaceClientsHealth`. New **"The dispatch seam — `@kolu/surface/link`"** section (`SurfaceDispatch`, `WireStatus`, `WatchableWire`, `WireTransport`, the two brands, the no-synchronous-end invariant). Links table rebuilt (`directDispatch(served)`, every wire link async, `{ group, … }` in, `{ dispatch, dispose }` out, `createLoopbackPair` named as *not* a link). `serveOverStdio({ group, handlers })`. Retry section replaced by **"The face and its retry fence"** (`buildSurfaceFace`, `isTransportError`, `shouldRetryStreamError`, `STREAM_RETRY`, `fenceStream`, `unenrolledStreamCall`) and a new **tagged-error vocabulary** section for `@kolu/surface/errors` (the six classes, `SurfaceErrorSchema`, the five guards). Transport-loss recognition and the cross-cutting invariants updated (incl. the `unenrolledStreamCall` captured-input hazard). |
| `ref-surface-app.mdx` | `serveSurfaceSocket({ group, handlers, socket, services? })` added as the browser serve half (replacing `RPCHandler.upgrade`), with `services` as the per-connection `Layer` seam; `heartbeatSweep` / `rejectStaleProcess` / `STALE_PROCESS_CLOSE_CODE` / `SERVER_PROCESS_ID_PARAM` added. `connectSurface` / `connectSurfaces` documented as **async**, taking the surface (never a group), with their full return shapes incl. `transport: LiveSignalHandle` and the "no `heartbeat: false`" rule. `createServerLifecycle` now takes `{ wire, probe }` over a `WatchableWire`, gains `livenessProbe` / `onProbeError`, and **loses `onStaleRestart` / `restartCloseCode`** (the link owns the close classifier). `defineBuildInfo`'s cell is `verbs: ["get"]` with an Effect `WireSchema`. `SurfaceAppProvider`'s source union is `{ wire, probe }`. |
| `ref-surface-mcp.mdx` | zod → Effect Schema throughout. New **"The schema bridge"** section: `Schema.toJsonSchemaDocument` is bought, the adapter glue is owned — reopen every object, normalize `Schema.Number`'s Infinity/NaN union, special-case `Void`/`Undefined` — plus the two authoring laws (`Schema.Finite`/`Schema.Int`; `default` annotation on the encoded-side node inside `optionalKey`). Serve-fresh shape is now `buildSurfaceFace(surface, directDispatch(runtime))`; bespoke-tool input is `Schema.Struct` with the scalar/array/union `value`-wrapping rule; the one-tool-namespace collision check added; `ToolInputSchema` / `SurfaceClientCallable` added. |
| `ref-surface-daemon.mdx` | Frozen fragment now named at its real wire tags (`surface/control/core/{hello,drain}`) and its Effect-Schema shape (`optionalKey` on the `commit`/`buildId` pair); the not-drainable refusal restated as a **defect** (no declared error schema ⇒ `Effect.promise`), superseding the oRPC `PRECONDITION_FAILED` code; `ControlCoreFragment` added to the export table. The epoch paragraph was already correct against `controlCore.ts` and was left as the source of truth says it. |
| `ref-surface-supervisor.mdx` | `readControlCoreHello` / `ControlCoreProbeClient` / `dialSocket` / `scrubDaemonNodeOptions` added. **The `unspeakable-protocol` section rewritten for TWO triggers** (`undecodable-frame` and `silence`), with `UnspeakableEvidence` / `unspeakableClause` / `UNSPEAKABLE_SILENCE_MS` documented and the 5 s-pong / ~10 s-kill band that pins the 8 s bound; the `UnconvergedCause` `unspeakable-protocol` arm's carried fields (`socketPath`/`gatePath`/`pid`) named. |
| `ref-surface-remote.mdx` | `sshConnector` / `dialAgentOnce` take the **`surface` as a value** (the group builds the client, the spec re-nests the face); `reServeSurface` returns `{ surface, group, handlers, done, close }`; the relay's retryable end is `SurfaceRelayTransportLost` from `@kolu/surface/errors` (no `ORPCError`, no code string), with the "both ends built from one class" reason; the `/evidence` leaf is "schema-only"; the intro's stale "reactive cell for the link's lifecycle" corrected (SR9 removed that cell — the page already said so lower down). |
| `ref-surface-map.mdx` | `SurfaceMap` now carries `{ keySchema, entry, group, tagPrefix, name?, entriesSpec, codec }` — `contract`/`surfaceContract` are gone; `serveSurfaceMap` returns `{ group, handlers, dispose }`; `MapRegistry` shown with its real generics and `EntrySession` carrying a **`dispatch`** (not a `link`); the map's declared rejection vocabulary (`MapRejectionSchema` = `MapKeyNonCanonical | MapKeyUnknown | MapEntryFailed`, homed in `@kolu/surface/errors`, declared on every folded member); `MAP_KEY_UNKNOWN` → `MapKeyUnknown`; the fold envelope's void rule restated in Effect terms plus the "wrap, not spread; decoded on both legs" note; `connectSurfaceMap`'s scoping described as a **tag rewrite** (brand can no longer be stripped); `MembershipIdSchema` shown as `Schema.String.check(isMinLength(1)).pipe(Schema.brand(...))` with `decodeMembershipId` as the one mint; `ZodType` → `WireSchema`, `z.discriminatedUnion` → `Schema.Union` of structs, `keySchema.parse` → a decode. |

### Explanation / invariants

- **`surface-daemon-invariants.mdx`** — the epoch-scoped `controlCore` doctrine expanded (payload vs framing, "a value inside the frame cannot describe a break in the frame", `controlCore.ts` named as the source of truth). Four new rows: *A route set is one set*; *A refusal the wire did not declare is a defect*; *An unspeakable peer is a third observation, not a skew* (both triggers); *An observation may only act on a daemon proven ours*; *The disposition is the contract-skew policy* (kaval recycles, padi refuses, with the anomaly's carried data).
- **`why-surfaces.mdx`** — "the contract is an oRPC router" → "the wire shape is a flat Effect RPC group"; `surfaceClient(surface, transport)`; "what stays raw oRPC" → "what stays a hand-written `Rpc` in the host's own group", with the `surface/` root as the reason the two merge safely.
- **`entry-contracts.mdx`** — the void-input rationale de-zod'd, and turned into evidence: the rule survived zod → Effect Schema without a byte changing, which is the test it was written for.

### Out-of-table pages fixed (they contradicted the code their own `<Snippet>`s now show)

`glossary.mdx` (`directLink` → `directDispatch`; **Contract** → **Group**; new **Dispatch** entry), `choose-a-link.mdx` (link table + serve-side matches + async/`{group}` rules + loopback), `test-a-surface.mdx` (`directDispatch` + `buildSurfaceFace`, the structural-face "name each member once" rule, `Stream.runHead` as the one-shot read, `Stream.takeUntil` as the native break), `your-first-surface.mdx`, `make-it-a-daemon.mdx`, `mirror-over-ssh.mdx`, `serve-a-map.mdx`, `across-the-hosts.mdx`, `expose-to-agents.mdx`, `a-fleet-of-surfaces.mdx`.

### Changelog

`website/src/content/changelog/unreleased.mdx` — appended a `### [Surface](/surface)`
section (merge=union friendly: pure append at EOF) with two `<Change>` notes:

1. *changed* — the wire was rebuilt on Effect (Effect RPC for transport, Effect
   Schema for types); what it buys is a typed failure that survives the two hops
   that used to flatten it, and cancellation as a property of the call; every
   payload byte-pinned before the swap.
2. *heads-up* — the flag day. Why a cross-epoch handshake is impossible, the two
   ways an old daemon betrays itself (speaks first in an unreadable framing, or
   accepts and says nothing for 8 s), the two attestations before kolu acts, and
   the per-daemon dispositions (kaval restarted, padi left standing and reported
   with socket/gate/pid). Contract versions **7.0** (kaval) and **5.0** (padi),
   with the "the major digit names the epoch" reason.

### READMEs

- `packages/surface/README.md` — the snippet was oRPC + `z.object`; now real
  Effect Schema + a note that `surface.group` is the derived flat group. ~15-line
  identity + install + one snippet shape kept.
- `packages/surface-map/README.md` — `z.string()` → `Schema.String`, a real
  `failure` schema, and `serveSurfaceMap` returning `{ group, handlers, dispose }`
  instead of a "finalized, servable router".

The other five package READMEs already described the Effect surface correctly
(surface-mcp names the Effect Schema bridge; surface-daemon shows `group`/`handlers`
and the epoch-scoped freeze; surface-app, surface-remote and surface-daemon-supervisor
carry no stale snippet).

## `<Snippet>` reference verification

Every `<Snippet src=… region=…>` in `website/src/content/` was enumerated and
checked against the rewritten example tree: **all 43 file+region pairs resolve**,
region names were preserved through the examples rewrite as the examples report
claimed, and the two argument-less `<Snippet src=…>` embeds (fleet-top whole
files) exist. This is also enforced structurally: `Snippet.astro` throws at build
time on a missing file or an unclosed/absent region, so the green
`just website::build` above is itself the proof. No reference needed fixing.

## Where the code contradicted the reports

1. **"RpcTest-style in-process testing"** (in the W6 brief) has **no shipped
   counterpart** — `RpcTest` appears nowhere in the repo, nor in any W2 report.
   The real in-process test path is `directDispatch(runtime)` +
   `buildSurfaceFace(surface, dispatch)`, which is what `test-a-surface.ts` and
   `test-a-surface.mdx` now document. Nothing was invented to fit the phrase.
2. **`unspeakable-protocol` has grown a second trigger** since the W2 reports were
   written. The reports (and the pre-existing supervisor page) describe it as
   raised at an explicit first-frame decode failure only; the shipped
   `convergence/unspeakable.ts` now models `UnspeakableEvidence` as a two-arm
   union — `undecodable-frame` **and** `silence` (8 s, `UNSPEAKABLE_SILENCE_MS`),
   the latter being what the real previous release actually does. The docs follow
   the code. **Caveat:** the sibling agent is mid-edit in this package; a stale
   one-trigger sentence still sits in `convergence/anomaly.ts`'s docstring for the
   `unspeakable-protocol` cause. That is a source comment, not an export, and is
   the sibling's to reconcile — flagged, not touched.
3. **`createServerLifecycle` lost two options** the page still documented
   (`onStaleRestart`, `restartCloseCode`) and gained two (`livenessProbe`,
   `onProbeError`). The link's own terminal-close classifier subsumed both losses.
4. **`BoundProcedure` takes input only** — the page documented
   `.procedures.<ns>.<verb>(input, { signal? })`; the shipped bound type has no
   options bag. Cancellation is fiber interruption on the streaming side and a
   plain `Promise` on the unary side.
5. **`@kolu/surface-remote`'s intro claimed a "reactive cell for the link's own
   lifecycle"** while the same page's SR9 section says that cell was removed.
   Corrected to "the observable state of the link's own lifecycle".
6. **`firstFrameOrThrow` no longer applies to a member read** — it takes an
   `AsyncIterable`, and streaming members now return an Effect `Stream`. The
   how-to's "use `firstFrameOrThrow`" instruction was replaced with
   `Stream.runHead` + an explicit throw-on-empty helper (the same policy), with
   `firstFrameOrThrow` mentioned as the async-iterable twin.

## Not done (deliberately, out of scope)

- The `docs/atlas` notes and the blog posts were left untouched. Blog posts are
  historical records of what was true when written (`orpc-over-ssh.mdx`,
  `odu.mdx`, `surface-framework.mdx`); rewriting them would falsify the archive.
- No `packages/**` source edits, per the sibling-agent boundary.
