# W2 Stage 1 — the contract kernel (`@kolu/surface` define/errors)

Scope delivered: `src/errors.ts` (new), `src/define.ts`, `src/liveness.ts`,
`src/identity.ts`, `src/clockNow.ts`, `src/index.ts` (descriptor schema type only),
plus the four tests runnable at this stage. Everything else in `packages/surface`
(server.ts, solid/*, project.ts, links/*) is untouched and is Stage 2/3 work.

Verified against the **installed** `effect@4.0.0-beta.102` — every API below was
compiled with the repo's own `typescript@7.0.2` and executed, not recalled.

---

## 1. Exported shapes

### 1.1 The `surface` object

```ts
interface Surface<S extends SurfaceSpec = SurfaceSpec> {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;   // NEW — replaces `contract`
  readonly tagPrefix: string;                   // NEW — "surface/" | "surface/<sibling>/"
  readonly spec: S;                             // unchanged
  readonly descriptors: SurfaceDescriptors<S>;  // unchanged
}
```

- The oRPC `contract` field is **gone**. `SurfaceContractFor<S>` /
  `SurfaceInnerContract<S>` / `CellContract` / `CollectionContract` /
  `StreamContract` / `EventContract` / `ProcedureContract` / `MergeContract` /
  `UnionToIntersection` are deleted with it.
- There was **no `version` field** on `Surface` before this stage (checked); the
  brief's "keep `{ spec, version, … }`" has nothing to keep.
  `isContractVersionCompatible` is untouched and still exported.
- `group` is deliberately typed with the **erased** `Rpc.Any` element. The group
  is assembled by a runtime spec walk, so `RpcGroup`'s invariant type parameter
  carries nothing a caller could trust (#16), and materialising the precise union
  into the value type would push every consumer through the TS2590-prone
  instantiation D2 exists to avoid. Per-member precision lives in the spec-derived
  types below.

### 1.2 The tag algebra (new public section in `define.ts`)

```ts
const TAG_SEPARATOR = "/";
const SURFACE_TAG_ROOT = "surface";
const SURFACE_TAG_PREFIX = "surface/";
function siblingTagPrefix(key: string): string;                   // "surface/<key>/"
function surfaceTag(prefix: string, member: string, verb: string): string;
function scopeSiblingTag(tag: string, siblingKey: string): string; // splices key after root
```

`scopeSiblingTag` is the **runtime dual of the deleted `scopeSibling(link, key)`**.
Stage 3 builds a per-sibling face against the STANDALONE tags and wraps its flat
dispatch through `scopeSiblingTag`, so the face never learns it is scoped. It
throws on a non-surface tag — a mis-scoped dispatch fails at the seam rather than
404-ing at the far end.

### 1.3 The spec-derived type oracle (replaces `SurfaceContractFor`)

```ts
type SurfaceRpcsFor<S extends SurfaceSpec, Prefix extends string = "surface/">  // union of Rpc<…>
type SurfaceTags<S extends SurfaceSpec, Prefix extends string = "surface/">     // = SurfaceRpcsFor<…>["_tag"]
```

`SurfaceRpcsFor<S>` is the type-level image of the runtime walk: a **union of
`Rpc` types**, not an object tree, because the wire namespace is flat.
`SurfaceTags<S>` is its `_tag` projection — a string-literal union of exactly the
tags the runtime mints, including the three reserved `system/*` members.

This is what Stage 2's handler map and Stage 3's dispatch should key off.
`define.test.ts` uses it as the type-level half of the verb-narrowing pin (the
`"surface/conn/set" extends Tags ? true : false` = `false` assertion replaces the
deleted `keyof Entry` assertion over the oRPC contract).

**Measured cost** (the TS2590 worry from #16/D2): a synthetic surface with 12
cells / 10 delta-bearing collections / 6 streams / 6 events / 24 procedures =
**113 tags** typechecks in 0.46 s wall under `typescript@7.0.2` with zero errors
and no TS2590, and `SurfaceTags` resolves precisely (positive AND negative
assertions both hold). The oracle scales past any real surface in the tree.

### 1.4 Schemas on the spec

```ts
type WireSchema<T>   = Schema.Codec<T, unknown, never, never>;
type WireSchemaAny   = Schema.Codec<unknown, unknown, never, never>;
```

Every spec schema field is a `WireSchema`. `RD = RE = never` is the **context-free
bound** the brief asked for: `Codec`'s `RD`/`RE` are covariant, so a schema that
demanded a service is not assignable. `Encoded` is left open (`unknown`) rather
than adding a second generic parameter to `CellSpec` etc.; the concrete encoded
type is recovered by **indexing the spec's own schema**
(`S["cells"][K]["schema"]["Encoded"]`), which is exact and keeps the generic arity
identical to the zod version. `index.ts` gained the same bound as
`DescriptorSchema<T>` for `Cell`/`Collection`/`Stream`/`Event`.

`ProcedureSpec.errors?: ErrorMap` → **`ProcedureSpec.error?: WireSchemaAny`** (one
schema, normally a `Schema.Union` of `TaggedErrorClass`es — `Rpc.make`'s own
option name). `ProcedureSpecErrors<S>` → **`ProcedureSpecError<S>`**, resolving to
`typeof Schema.Never` when undeclared. Siblings added:
`ProcedureInputSchema<S>` / `ProcedureOutputSchema<S>` (→ `typeof Schema.Void`),
which is how the four oRPC-era `buildProcedure*` oracles collapse to one.

### 1.5 `SurfaceTypes<S>` — the Encoded/Type split (D2/#13)

Unsuffixed fields keep their meaning exactly (`typeof S.Type`, the decoded domain
type — same as the old `z.infer`). Each input-bearing schema gained a `*Wire`
twin carrying `typeof S.Encoded`:

| kind | decoded (unchanged) | encoded (new) |
|---|---|---|
| cells | `Value`, `Patch` | `ValueWire`, `PatchWire` |
| collections | `Key`, `Value` | `KeyWire`, `ValueWire` |
| streams | `Input`, `Output` | `InputWire` |
| events | `Input`, `Payload` | `InputWire` |

The eight flat helpers (`SurfaceCellValue` …) are unchanged and project the
DECODED side only — no `*Wire` flat twins were added, since the client face (their
one consumer) already walks `SurfaceTypes` per member. `SiblingRead<S>` is decoded
throughout (the reactor works in domain values).

### 1.6 `composeSurfaceContracts`

```ts
interface ComposedSurfaces<E extends Record<string, Surface<any>>> {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;              // all siblings, one flat group
  readonly siblings: { readonly [K in keyof E]: Surface<…> }; // per-sibling Surface, tagPrefix "surface/<K>/"
}
```

Composition is **per-sibling re-walk with a sibling tag prefix**, never
`RpcGroup.merge` (D1): every surface carries the same three `system/*` tags, and
`merge` is a last-writer-wins `Map.set`, so a bare merge would silently leave one
sibling's liveness probe answering for the other's. Each sibling goes back through
the SAME `buildSurface(spec, prefix)`, so a sibling's tags and a standalone
surface's tags can never be derived by two different rules. Each sibling's entry
is a full `Surface` whose `group.requests` keys are exactly the tags it owns —
that is the handle Stage 2 binds handlers with and Stage 3 dispatches with.

Sibling descriptors are **reused** from the passed-in surface (pure data, no tag),
not re-derived.

### 1.7 `errors.ts` — the D4 vocabulary

Six `Schema.TaggedErrorClass`es, each with a `message` getter reproducing the
oRPC-era text, plus one closed union and five typed predicates:

| class | `_tag` | fields |
|---|---|---|
| `SurfaceTransportRetired` | `"SurfaceTransportRetired"` | `reason` |
| `SurfaceStdioTransportClosed` | `"SurfaceStdioTransportClosed"` | `reason` |
| `SurfaceRelayTransportLost` | `"SurfaceRelayTransportLost"` | `reason` |
| `MapKeyNonCanonical` | `"MapKeyNonCanonical"` | `wireKey`, `canonicalKey` |
| `MapKeyUnknown` | `"MapKeyUnknown"` | `mapKey` |
| `MapEntryFailed` | `"MapEntryFailed"` | `mapKey`, `failure` (rendered string) |

```ts
const SurfaceErrorSchema = Schema.Union([...all six]);
type SurfaceError = typeof SurfaceErrorSchema.Type;

isSurfaceError(e): e is SurfaceError
isDeadTransportError(e): e is SurfaceTransportRetired | SurfaceStdioTransportClosed
isSurfaceTransportRetired(e) / isSurfaceStdioTransportClosed(e) / isSurfaceRelayTransportLost(e)
```

Identifiers are `@kolu/surface/<Tag>`. The `_tag`s are the **class names**, NOT the
old `SURFACE_TRANSPORT_RETIRED` screaming-snake codes — D6 is a flag day, so
there is no compatibility to preserve, and the discriminant is now a `_tag` check
instead of a magic-string compare.

**D4's relay-rehydration requirement is proven, not asserted**: `errors.test.ts`
round-trips every member `encode → JSON → decode → encode` and pins that the
class, the `_tag`, the message and the **bytes** are all identical, and that the
predicates still narrow a rehydrated instance.

Deliberately NOT tagged: `ClockNowUnavailableError` (clockNow.ts). It is raised
locally about the shape of a client object in this process's own hand and never
crosses a wire, so it has no schema and no `_tag` to preserve. Documented as such
in the file.

### 1.8 Reserved members

`liveness.ts` / `identity.ts` / `clockNow.ts` each now export ONE
`buildXRpc<Tag extends string>(tag)` that is **both the runtime emitter and the
type oracle** (`ReservedLivenessRpc<Prefix>` = `ReturnType<typeof buildLivenessRpc<...>>`),
because a reserved member's verb is statically known. The old
`xContractEntry()` + `ReservedXContract` pair is gone. Payload/success schemas are
exported (`LivenessPayloadSchema`, `IdentityPayloadSchema`, `ClockNowPayloadSchema`,
`ServedIdentitySchema`, `BakedIdentitySchema`, `BuildCommitSchema`,
`ServedClockNowSchema`) with encoded shapes byte-identical to the zod originals
(`{}` in, `{...}` out; `z.string().min(1)` → `Schema.String.check(Schema.isMinLength(1))`).

`probeSurfaceLive` / `probeSurfaceIdentity` / `probeSurfaceClockNow` /
`measureSurfaceClockOffset` / `buildCommit` / `serveIdentity` keep their exact
signatures and bodies. They were already oRPC-free structural walks over the
nested client face (`client.surface.<ns>.<verb>(input, opts)`), which D2 keeps —
so they compile and are tested today against a hand-built face. **No dead stubs.**

---

## 2. The two invariants, and how they are held

**D1 / #16 — no tag minted twice.** The walk builds a flat `Map<tag, Rpc>` and
`claim()` throws on a duplicate tag (message preserves the old
`duplicate verb "<verb>" claimed at "<member>"` phrasing, plus the wire tag). Every
assembly then goes through `assembleGroup()`, which throws unless
`group.requests.size === claimed.size`. The **flat-namespace collision class** is
made unrepresentable rather than merely detected: `assertTagSegment` refuses an
empty name and any name containing `/`, for cells, collections, streams, events,
procedure namespaces, procedure verbs, and sibling keys. (`member "conn/get" +
verb "set"` and `procedure ns "conn" + verb "get/set"` both spell
`surface/conn/get/set` with different (member, verb) pairs, which `claim` alone
could not see.)

**#17 mapping (LAW).** No `.optional()`/`.default()` idiom exists in the kernel
files, so nothing was translated; the rule is stated in `define.ts`'s header as
the law for every spec author (`Schema.optionalKey` / `Schema.withDecodingDefaultKey`,
never `Schema.optional` / `withDecodingDefault`).

**Byte compat.** `collectionDeltasSchema`'s encoded shape is pinned by literal
JSON strings in `collectionDeltasSchema.test.ts`. Cross-checked against the
pre-migration zod schema in a scratch script (not committed): zod
`{"kind":"snapshot","entries":[[1,{"label":"a","n":1}],[2,{"label":"b","n":2}]]}`
and `{"kind":"delta","upserts":[[3,{"label":"c","n":3}]],"removes":[1,2]}` —
**identical bytes** from the Effect schema. Entry tuples stay two-element JSON
arrays; the discriminant stays `kind`, not `_tag`.

---

## 3. Gate

```
vitest run src/define.test.ts src/clockNow.test.ts \
           src/collectionDeltasSchema.test.ts src/errors.test.ts
  → 4 files, 54 tests, all green

biome lint --error-on-warnings  (the 6 source files + 4 test files + biome.jsonc)
  → clean

tsc --noEmit  → zero errors in every file this stage owns
```

**#26 — the `define.ts` biome override is re-justified in place** (not deleted).
The old reason cited two things that no longer exist (`(contract as any).surface`
and "every value flows through Zod schemas"). The new reason records that every
remaining `any` is type-plumbing — a constraint or a default type argument, never
a value cast (the file contains **no `as any` at all**, so PLAN rule 8 is not
invoked) — and that what keeps values honest now is the `WireSchema<T>` bound.
`includes` stays scoped to `packages/surface/src/define.ts`; the new `errors.ts`
needs no override.

---

## 4. Left for Stages 2 / 3 (named)

These files still reference the deleted shapes and are **expected red** until
their stage lands. `tsc --noEmit` on the package reports errors in exactly:

- **Stage 2 (server):** `src/server.ts` (the whole `implement(contract)` walk,
  `walkSurface`, `extendSurface`, `implementSurfaces`, the three reserved
  auto-answers), and its tests — `implementSurface.test.ts`,
  `implementSurfaces.test.ts`, `extendSurface.test.ts`, `cellHandlers.test.ts`,
  `channelNames.test.ts`, `collectionDeltas.test.ts`,
  `collectionKeysMembership.test.ts`, `liveness.test.ts`, `reactor.test.ts`,
  `surfaceRuntimeSupervision.test.ts`, `mirrorRemoteSurface.test.ts`,
  `mirrorPumpOwnership.test.ts`, `peer-server.test.ts`, `unix-socket.test.ts`,
  `procedureErrors.test.ts`, `project.ts` + `project.test.ts`,
  `links/direct.test.ts`.
- **Stage 3 (client face):** `src/solid/surfaceClient.ts`, `src/solid/liveSignal.ts`,
  and their tests — `solid/boundProcedure.test-d.ts` (**the D2/#13 spec — port it,
  do not delete it**), `solid/boundCollection.test-d.ts`,
  `solid/surfaceClient.{readonly,policy,health}.test.ts`,
  `solid/collectionDeltasGate.test.ts`, `solid/keyedSubscriptionCache.test.ts`,
  `solid/createLiveSignal.test.ts`.
- **`src/client.ts` is untouched** and still holds the oRPC `ORPCError`-based
  `SURFACE_*` code constants, `deadTransportError`, the three `is*` predicates and
  `shouldNotRetryORPCError`/`STREAM_RETRY`. Stage 3 deletes those in favour of
  `./errors` (which is why the new predicates carry the same names) and builds D3's
  per-subscription `Stream.retry` fence on
  `isSurfaceRelayTransportLost` + `RpcClientError`.
- `liveness.test.ts` / `identity`-adjacent served round-trips: the *schema* halves
  are covered here; the *served* halves (probe against a real `implementSurface`)
  land with Stage 2.

### Concrete asks of Stage 2

- Bind handlers by tag off `surface.group.requests` / `SurfaceTags<S>`; the tag for
  member `m` verb `v` is `surface.tagPrefix + m + "/" + v` (use `surfaceTag`).
- For siblings, take `composed.siblings[key]` — its `group.requests` keys are
  already prefixed, so no handler needs to know about scoping.
- Reserved auto-answers key off the same three tags:
  `surfaceTag(tagPrefix, LIVENESS_NAMESPACE, LIVENESS_VERB)` etc.

### Concrete asks of Stage 3

- Type the face from `SurfaceTypes<S>`: inputs from the `*Wire` fields, results
  from the decoded fields, and `Schema.encode` the payload before handing it to
  `RpcClient.make(group, { flatten: true })`.
- Scope a sibling by wrapping the flat dispatch through `scopeSiblingTag`.
- Keep `client.surface.<ns>.<verb>(input, opts?)` reachable on the face — the three
  reserved probes walk it structurally and are already green against that shape.

---

## 5. Deviations from PLAN / brief, with reasons

1. **`ProcedureSpec.errors` → `error` (singular), an Effect Schema, not a map.**
   `Rpc.make` takes one `error` schema; a per-code map has no analogue. D4 already
   says "per-surface declared procedure errors as Schema tagged errors", so this is
   the mechanical translation, but the field NAME changes, which is a public API
   break beyond what the brief enumerated. Add it to the drishti/odu follow-up list.
2. **Four `buildProcedure*` oracles collapsed to one.** The brief says rewrite the
   oracle block "1:1". The four arms existed only because `oc.input(...)`'s builder
   TYPE differed per arm; `Rpc.make` takes all three schemas positionally, so the
   arms are now resolved as schemas (`ProcedureInputSchema` / `ProcedureOutputSchema`
   / `ProcedureSpecError`) and fed to one oracle — which mirrors the single runtime
   `procedureRpcEntry` exactly. This is *more* 1:1 with the runtime, not less.
   `boundProcedure.test-d.ts` (Stage 3) still has four arms to pin, and can.
3. **`index.ts` was edited** though it is not named in the scope: its four
   descriptor interfaces spell `ZodType<T>`, and `define.ts` constructs them. The
   change is the type swap only (`ZodType<T>` → `DescriptorSchema<T>`, the same
   context-free `Schema.Codec` bound) plus three stale doc phrases.
4. **The cell/collection same-name check keeps its original position** (after the
   collections walk), so a dual name whose verbs OVERLAP still reports
   `duplicate verb "get"` first, exactly as before. `reactor.test.ts:844` pins the
   specific message using disjoint verbs, and that behaviour is preserved. Hoisting
   the check would give a better message but would change an existing error for an
   existing input class — out of scope here.
5. **`surface.group` is typed `RpcGroup<Rpc.Any>`, not the precise union.** See
   §1.1. The precise union exists and is cheap (§1.3 measurement) but lives in
   `SurfaceRpcsFor<S>`, per D2's "type the face from the spec, not from RpcGroup
   inference".

## 6. Nothing here invalidates a PLAN assumption

- #20's compiler verdict holds beyond the spike: the real oracle typechecks under
  `typescript@7.0.2`, at 113 tags, with no TS2590.
- #16's collision hazard is real and is now closed by construction plus assertion.
- #13's Encoded/Type inversion is accommodated (`*Wire`) rather than worked around.
- D1's "never bare `merge`" is enforced by composition never calling `merge` at all.
- No package.json `dependencies` block changed, so PLAN standing rule 5
  (`nix/workspace.nix` + `default.nix` stableLeaves) does not fire for this stage.
