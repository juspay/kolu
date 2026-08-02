# W2 fanout — `@kolu/surface-map` on the Effect surface core

Scope: the whole package. `define.ts`, `server.ts`, `client.ts`, `scoped.ts`,
`evidence.ts`, `envelope.ts`, `testing.ts`, `index.ts`, plus every test. Zero
`zod` / `@orpc/*` imports remain anywhere in `src/`.

Built against the committed core: S1 (`Surface {group, tagPrefix, spec}`, the tag
algebra, `@kolu/surface/errors`), S2 (`SurfaceRuntime {group, handlers}`,
`collectionHandlers` returning `Stream`/`Effect`), S3 (`SurfaceDispatch`,
`buildSurfaceClient(surface, dispatch, live, onClientError?)`, `runStreamScoped`),
S4 (`stdioLink`/`serveOverStdio` on `{group, handlers}`).

---

## 1. The shapes that changed

### 1.1 `SurfaceMap`

```ts
interface SurfaceMap<KS extends WireSchemaAny, ES, Failure, Conn> {
  readonly keySchema: KS;
  readonly entry: Surface<ES>;
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;   // NEW — replaces `contract`
  readonly tagPrefix: string;                   // NEW — "surface/" | "surface/<name>/"
  readonly name?: string;                       // unchanged
  readonly entriesSpec: CollectionSpec<string, EntryStatus<Failure, Conn>>;
  readonly codec: KeyCodec<KS["Type"]>;
}
```

`contract` and `surfaceContract` are **gone**. The oRPC value had to be two fields
because a host spliced the `.surface` FRAGMENT under a sibling name while the client
re-wrapped the LINK with `scopeSibling(link, name)` — two moves, two authorities for
one fact. On a flat tag namespace both collapse into `tagPrefix`, decided ONCE in
`defineSurfaceMap` from `map.name`:

- the server binds handlers at `<tagPrefix><member>/<verb>`, so a mounted map's
  handler record needs **no re-prefixing at the mount site** — a host merges
  `{group, handlers}` exactly as it merges `implementSurface`'s;
- the client re-tags the STANDALONE entry face onto the same prefix inside the
  key-injecting dispatch, so the face never learns it is mounted.

`KS extends z.ZodType` → `KS extends WireSchemaAny`; `z.infer<KS>` → `KS["Type"]`
everywhere (`Key<M>`, `MapRegistry<K>`, `SurfaceMapClient`, `scopedByEntry`,
`watchByEntry`).

### 1.2 `keyInjectingLink` → `keyInjectingDispatch` (PLAN D2)

```ts
function keyInjectingDispatch(
  dispatch: SurfaceDispatch, mapKey: string, retag: (tag: string) => string,
): SurfaceDispatch {
  return {
    unary:  (tag, payload) => dispatch.unary(retag(tag),  fold(mapKey, payload)),
    stream: (tag, payload) => dispatch.stream(retag(tag), fold(mapKey, payload)),
  };
}
```

The recon dossier called the old `keyInjectingLink` "the deepest structural
dependency on oRPC's client shape in the codebase" — a Proxy-of-Proxy that
lazily materialised `link.surface.<member>.<verb>` and intercepted every leaf
call. There is no tree to walk on a flat wire, so it is four lines over the erased
seam. `retag` is `mapRetag(map)`: identity for a root-served map,
`scopeSiblingTag(tag, name)` for a mounted one — S1's tag-algebra dual of the
deleted `scopeSibling`.

**A side effect worth naming**: scoping no longer RE-WRAPS the transport, so the
brand-stripping hazard that forced `connectSurfaceMap` to refuse a "pre-sliced
link" (#1580) has no construction path left. The guard is kept (it still refuses a
bare unbranded dispatch — #1564), but it now sees the very value the caller passed.
Pinned in `siblingMount.test.ts`.

### 1.3 `leafAt` → tag concatenation; `EntrySession.link` → `.dispatch`

`leafAt(link, [member, verb])` (an arbitrary-depth string walk over an opaque
client) becomes `surfaceTag(map.entry.tagPrefix, member, verb)` over
`session.dispatch`. `EntrySession.link: unknown` is now
`EntrySession.dispatch: SurfaceDispatch` — a typed field where the old one was
`unknown`, and read off `map.entry.tagPrefix` so a scoped entry surface would
forward at its own tags without the walk knowing.

### 1.4 `serveSurfaceMap` returns `{ group, handlers, dispose }`

`ServeSurfaceMapResult.router` is **gone**. `group` is `map.group` by identity
(one value pair a host merges — there is no second fragment to keep in step, and
`mapGroup.test.ts` asserts the identity). `handlers` is a null-prototype
`SurfaceHandlers` keyed by full wire tag, so `directDispatch(served)` works
directly and a wire serve path takes `{group, handlers}` verbatim.

Route-set identity is **asserted at boot** in both directions
(`assertHandlersMatchMapGroup`), the map's twin of `implementSurface`'s check.

### 1.5 Typed rejections (D4)

`ORPCError("MAP_KEY_NON_CANONICAL" | "MAP_KEY_UNKNOWN" | "MAP_ENTRY_FAILED")` →
`MapKeyNonCanonical` / `MapKeyUnknown` / `MapEntryFailed` from
`@kolu/surface/errors` (S1 landed them there — one schema union across tiers).
`MapRejectionSchema` (exported) is that union, and `foldedError(entryError?)`
declares it on **every** folded member — streaming ones included, because a
non-canonical wire key is a real rejection on any verb and an undeclared one would
flatten into a defect at the relay hop. An entry's OWN declared procedure error is
unioned in alongside (SK6), which is what keeps the incident-hop pin green.

`MapEntryFailed.failure` is the RENDERED fault (`JSON.stringify`) — the fault's
shape is app-owned and must not leak into the framework's closed wire union.

### 1.6 Membership loss mid-stream is still a TYPED END

`forwardStream` is now a `Stream`:

- the registry watcher is an `Effect.acquireRelease`d **scoped resource of the
  stream**, acquired BEFORE the upstream is subscribed — so a removal landing while
  the upstream is opening is observed (the old "install the watcher before the dial
  await" rule, structurally);
- `Stream.interruptWhen(removedSignal)` ends the stream (a typed completion
  downstream), never fails it;
- `Stream.catch(upstream, e => latch.removed ? Stream.empty : Stream.fail(e))` — an
  upstream failure while removed is the captured session's destroy fallout, ended
  typed; a genuine failure propagates;
- every guard tests the **latch**, not the live `has()`, so a remove+re-add flap
  cannot un-orphan a forward bound to the captured session.

Both original pins survive (`mapHarness.test.ts` (8) and (11)), re-expressed
against a stubbed `SurfaceDispatch` whose stream parks/fails on demand.

---

## 2. zod → Effect Schema

| site | before | after |
|---|---|---|
| `MembershipIdSchema` | `z.string().min(1).brand("MembershipId")` | `Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("MembershipId"))` |
| `MembershipIdSchema.parse` | — | **new export `decodeMembershipId`** (`Schema.decodeUnknownSync`), the ONE decode site |
| `entryStatusSchema` | `z.discriminatedUnion("kind", […])` | `Schema.Union([Struct, Struct, Struct])` — **not** `TaggedUnion` (the discriminant is `kind`, not `_tag`, and the bytes are frozen) |
| `connection?` | `.optional()` | **`Schema.optionalKey`** (#17 law) |
| `evidence.ts` | `z.enum` / `z.object` / `z.array().readonly()` | `Schema.Literals` / `Schema.Struct` / `Schema.Array` (already readonly on the Type side) |
| the `z.ZodType<T>` annotations | `z.ZodType<EvidenceLine>` etc. | `WireSchema<T>` — the same "a narrower schema annotated as the wider type still compiles" intent, on the framework's context-free `Codec` bound |
| `isVoidInput`'s `.def.type` probe | `"void" \| "undefined"` | `schema.ast._tag === "Void" \| "Undefined"` |
| key decode | `keySchema.parse(codec.decode(wire))` | `Schema.decodeUnknownSync(keySchema)(codec.decode(wire))` |

**No `.default()` idiom exists in this package**, so `withDecodingDefaultKey` has no
call site; the law is stated in `define.ts`'s header for future spec authors.

### The byte-compat hit-list items

Two formats in this package cross the ssh/relay hop between kolu and drishti, and
both now have **byte-level fixture tests asserting the encoded JSON string**:

1. **the fold envelope `{mapKey, input}`** — `foldEnvelope.test.ts` serves a real map
   over a real stdio wire (`serveOverStdio` + `stdioLink`, ndjson), records every
   client→server byte, and asserts the request frame's payload is literally
   `{"mapKey":"a"}` for a void member and `{"mapKey":"a","input":{"text":"hi"}}` for
   an input-bearing one — for a UNARY and a STREAMING member. That replaces the old
   `StandardRPCSerializer` round-trip (the single most oRPC-specific test in the
   tree) with the same assertion made one layer lower: on the bytes the socket
   emitted, not on a serializer's in-memory output. It also asserts the capture is
   ndjson (no control byte but `\n`).
2. **`EntryStatus`** — `failureEvidence.test.ts` pins each arm's encoded string
   literally, including `clockOffset: null` staying a real `null` and an ABSENT
   optional `connection` staying absent rather than becoming `null` (the
   `optionalKey`-vs-`optional` divergence #17 names).

### The void-member rule, re-proved on Effect's semantics

The rule ("a void member's schema declares NO `input` field") is unchanged, and its
justification got *stronger*: zod ≥4.3.7 rejects a MISSING key for `z.void()`;
Effect Schema's `Schema.Struct({ input: Schema.Void })` demands the key on EVERY
version. `foldEnvelope.test.ts` shows the fragile shape failing and the real one
decoding, with `Schema.Void`/`Schema.Undefined` inners collapsing onto the same
no-input schema.

### The brand is a COMPILE error, tested

**`membershipId.test-d.ts` (new)** — six `@ts-expect-error` / assignment pins that a
bare `string`, a `""`, and an arbitrary runtime string are all NOT a `MembershipId`,
that the two sanctioned producers hand back one, that it still widens TO `string`,
and that a status literal cannot be assembled with a fabricated id. The runtime half
(`isMinLength(1)` refusing `""`) is pinned in `failureEvidence.test.ts`.

---

## 3. #16 / D1 — group assembly

`assembleMapGroup` (exported) claims every tag into a flat map, **throws** on a
duplicate, then asserts `group.requests.size === claimed.size` after
`RpcGroup.make`. Both halves are load-bearing (the claim catches what the walk can
see; the size assertion catches what it cannot). Sibling composition never calls
`RpcGroup.merge`: a mounted map re-walks at the sibling prefix, exactly as
`composeSurfaceContracts` does.

**`mapGroup.test.ts` (new)** is the replacement for the deleted `StandardRPCMatcher`
path tests:

- the standalone key set spelled LITERALLY over an entry surface exercising every
  primitive (14 folded tags + 2 `entries` tags), and the mounted set under
  `surface/hosts/`;
- `Object.keys(served.handlers)` equals `map.group.requests` keys, both directions;
- the `entries` tags equal the ones `defineSurface({collections:{entries:
  map.entriesSpec}})` mints — the surface `connectSurfaceMap` builds the membership
  face from, so a drift would 404 membership while everything else stayed green;
- the map advertises **no** `system/*` tag (see §5.1);
- an entry member named `entries` still throws.

---

## 4. Public API breaks (drishti / odu follow-up list)

1. `SurfaceMap.contract` and `SurfaceMap.surfaceContract` → **`SurfaceMap.group`**
   (`RpcGroup<Rpc.Any>`) + **`SurfaceMap.tagPrefix`**.
2. `SurfaceMap`'s `KS` constraint: `z.ZodType` → **`WireSchemaAny`**
   (`@kolu/surface/define`). Same for `SurfaceMapClient`, `connectSurfaceMap`,
   `serveSurfaceMap`, `scopedByEntry`, `watchByEntry`, `Key<M>`.
3. `ServeSurfaceMapResult.router` → **`{ group, handlers }`**. Every mount site
   changes: a host merges the pair instead of splicing `.router.surface` under a
   name (the name is already in the tags).
4. `EntrySession.link: unknown` → **`EntrySession.dispatch: SurfaceDispatch`**.
   Every `MapRegistry` implementation (`serveHostMap`, kolu's padi registry) resolves
   a dispatch, not a nested client.
5. `entryStatusSchema(failureSchema, connectionSchema?)` takes **`WireSchema<T>`**
   and returns **`WireSchema<EntryStatus<…>>`**.
6. `MembershipIdSchema` is an Effect Schema; **`MembershipIdSchema.parse` is gone** —
   new export **`decodeMembershipId`**.
7. `EvidenceLineSchema` / `FailureEvidenceSchema` are Effect Schemas typed
   `WireSchema<…>`. `@kolu/surface-remote/connection`'s `ConnectionInfoSchema.log`
   consumes `EvidenceLineSchema` and must move with it.
8. `foldInput(inner?)` takes and returns **`WireSchemaAny`**.
9. **New exports**: `decodeMembershipId`, `ENTRIES_MEMBER`, `MapRejectionSchema`,
   `MapRejection`, `assembleMapGroup`, `SurfaceMap.tagPrefix`, `SurfaceMap.group`.
10. `connectSurfaceMap`'s transport guard now names **`directDispatch`** (was
    `directLink`) in its message; the accepted values are a `LiveSignalHandle` or a
    direct-branded `SurfaceDispatch`.
11. The map's typed rejections are **tagged errors**, not `ORPCError` codes: a
    consumer narrows on `_tag === "MapKeyUnknown"` etc., importing the classes from
    `@kolu/surface/errors`. `error.code === "MAP_KEY_UNKNOWN"` breaks.
12. `@kolu/surface-map/testing`'s `testMembershipId` is unchanged in signature but
    now decodes through the Effect schema.

---

## 5. Deviations / deliberate non-changes, with reasons

### 5.1 The map still does NOT fold the three reserved `system/*` members

The oRPC-era `foldedMembers` walked the entry SPEC only, so `system.live` /
`system.identity` / `system.clockNow` were never in the map's contract and
`serveSurfaceMap` never bound them. Preserved verbatim — folding them now would be a
new wire surface, not a port — and `Entry.rpc`'s docstring says so explicitly
(previously it claimed the opposite, which was already false). Per-entry liveness
rides the `entries` membership authority. Pinned in `mapGroup.test.ts`.

### 5.2 A key the SCHEMA rejects stays a DEFECT; only NON-CANONICAL is declared

`decodeCanonicalWireKey` decodes with `Schema.decodeUnknownSync` (which throws) and
FAILS typed only for the canonical mismatch. That matches the zod original exactly
(`keySchema.parse` threw into the oRPC internal-error channel): a smuggled foreign
string is a caller bug, not a condition a client branches on. The canonical
mismatch, by contrast, is a codec contract violation a caller can act on, so it is
declared.

### 5.3 `entries/get` gates the canonical check ABOVE `collectionHandlers`

`collectionHandlers` is reused verbatim (reuse the existing source of truth), but its
`readOne` snapshot runs inside the stream, where a throw is a defect. So the bound
handler pre-gates the wire key through the typed `decodeCanonicalWireKey` and only
then delegates. `readOne` keeps a throwing decode as a belt; reaching it means the
gate was bypassed, which would be a framework bug.

### 5.4 The "accumulate, don't reset" merge is DELETED, not ported

The oRPC build had to merge a member emitted twice (padi's `session` is a cell AND a
procedure namespace) or the second pass dropped the first's verbs — a 404 on
`session/get` at every boot. On a flat namespace each verb owns its own tag, so
there is no per-member object to reset and the hazard is unspellable. The
`mapHarness.test.ts` pin survives, re-aimed at the property the merge existed to
give (both verbs served) plus the group key set.

### 5.5 `MembershipIdSchema` uses `Schema.brand`, which adds no runtime check

Effect's `brand` is type-level only; the runtime guard is the separate
`.check(isMinLength(1))` applied before it. That is the same split zod had
(`.min(1)` runtime + `.brand()` compile-time), stated in the docstring.

### 5.6 `Effect.run*` sites added in this package

`Effect.runSync` appears exactly once in `server.ts`
(`decodeCanonicalWireKeyUnsafe`, the belt inside `readOne`, which runs a pure
suspend). Nothing else in `src/` runs an Effect. Worth listing for W6's #25
allowlist test.

### 5.7 Docs deferred, per S3's precedent

`.claude/rules/surface-reference.md` requires
`website/src/content/surface/ref-surface-map.mdx` to move with any public-API change.
§4 is a long list of them, but the map's Reference page describes an API whose OTHER
half (`@kolu/surface`) is being rewritten in the same worktree right now, so a
rewrite landed here would be stale before it was read. PLAN W6 already owns
"examples + website surface reference MDX"; §4 is written as the changelog that pass
consumes. **The rule is satisfied by the PR, not by this commit** — flag it if W6
slips.

### 5.8 No `package.json` change

`effect` was already declared. `zod` / `@orpc/{client,contract,server}` are now
UNUSED but still declared — W6 owns the purge, and removing them here would fire
PLAN standing rule 5 (`nix/workspace.nix` + `default.nix` stableLeaves) for no
benefit. `dequal`, `ts-pattern`, `@solid-primitives/keyed`, `solid-js` all still
used. **Standing rule 5 does not fire for this package.**

---

## 6. Test inventory

| file | note |
|---|---|
| `foldEnvelope.test.ts` | **REWRITTEN** — 3 schema/encoder pins + 2 ndjson BYTE pins over a real stdio wire (unary + streaming) |
| `failureEvidence.test.ts` | +2: an empty `membershipId` is refused; the ENCODED bytes of every arm, and `optionalKey`'s absent-stays-absent |
| `membershipId.test-d.ts` | **NEW** — the brand is a compile error (the `@ts-expect-error` battery) |
| `mapGroup.test.ts` | **NEW**, 7 tests — the D1/#16 group key set, route-set identity, sibling scoping, entries-tag agreement, no `system/*` |
| `siblingMount.test.ts` | **NEW**, 3 tests — a NAMED map end to end (the path every production consumer takes and the nameless harness never exercised), plus the brand guard surviving scoping |
| `mapHarness.test.ts` | ported; (6) now drives the face's `Stream` and asserts a tagged `MapKeyUnknown`; (8)/(11) use stubbed dispatches; (15)–(17) drain through `runStreamScoped` instead of `AbortController`; the canonical-key pin asserts the tagged `MapKeyNonCanonical` with both keys |
| `procedureErrorsAcrossMap.test.ts` | ported to tagged errors + `Exit`/`Cause`, so a DEFECT and a typed FAILURE are distinguishable (a Promise rejection collapsed them); +1 `describe` for the map's OWN rejections across a wire, +1 for the in-process forward |
| `entryConnectionState.test-d.ts` | `link: {}` → `dispatch: SurfaceDispatch` |
| `clientPolicyOrigin.test.ts`, `procedureUseVerb.test.ts`, `scoped.test.ts`, `watchByEntry.test.ts`, `mapHarness.testlib.ts` | ported |

The dedup spy in `mapHarness.testlib.ts` was a Proxy-of-Proxy over
`link.surface.urgency.get`; it is now a one-line tag compare over the erased
dispatch, measuring the same thing.

---

## 7. Gate

```
tsc --noEmit                                   → ZERO errors
vitest run                                     → 10 files, 76 tests, ALL GREEN
biome lint --error-on-warnings packages/surface-map → clean (exit 0)
just fmt                                       → run
grep for `zod` / `@orpc` across src/           → NO hits
```

`just fmt` also reformatted four already-committed `packages/surface` files
(whitespace only, from the repo-wide `biome format --write`). They are left
UNSTAGED and out of this commit — another agent may be editing them concurrently.

---

## 8. Nothing here invalidates a PLAN assumption

- **D1/#16** holds and is enforced twice (claim + size assertion) plus asserted at
  serve time, with the key-set tests the finding asked for.
- **D2** holds: the key-injecting Proxy is a dispatch wrapper, `leafAt` is tag
  concatenation, and the face stays typed from the spec.
- **D4** holds: the three map rejections live in the shared vocabulary and are
  DECLARED on every folded member, so they cross a hop by `_tag` rather than by a
  magic code; an undeclared failure stays a defect.
- **#17** holds: `optionalKey` everywhere, no `.default()` to translate, and both
  wire formats carry byte-level fixture tests.
- **D10** holds: no `AbortSignal` remains anywhere in this package — the membership
  watcher is a scoped resource and cancellation is fiber interruption.
- No `package.json` `dependencies` change ⇒ standing rule 5 does not fire.
