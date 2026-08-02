/**
 * `defineSurface` — declarative app-wide reactive surface.
 *
 * One spec value declares every Cell, Collection, Stream, Event, and
 * imperative procedure the app's typed reactive layer exposes. From the
 * spec the surface derives:
 *
 *   - `surface.group`: a flat Effect `RpcGroup`. Every member is one `Rpc`
 *     whose tag is the slash-joined wire path `surface/<member>/<verb>` (D1).
 *     The namespace is FLAT — there is no nesting on the wire — so the
 *     `surface/` root is what keeps a surface composable with hand-written raw
 *     RPC: a host merges `surface.group` with its own group and no host tag
 *     (`terminal/create`, `git/status`) can collide with a surface member.
 *   - `surface.descriptors`: the underlying Cell/Collection/Stream/Event
 *     values, keyed by surface path. Available as an escape hatch — the
 *     manual primitives (`cellHandlers` etc.) still accept these.
 *
 * The framework owns publish channel naming: cells use `"<key>:changed"`,
 * collections use `"<key>:keys"` and `"<key>:" + String(k)`, events use
 * `"<key>:" + String(input)`. There are no per-entry overrides — if you
 * need a different on-disk persistence key (e.g. to land an existing
 * `Conf` store), use the consumer's `Conf` migration ladder, not a
 * framework override.
 *
 * ── The two invariants this file exists to hold ────────────────────────
 *
 * 1. **No tag is minted twice.** `RpcGroup.make` is a plain `Map.set`: it
 *    silently drops a colliding tag, last writer wins. So the spec walk carries
 *    its own `claim()` duplicate-throw (as the oRPC-era contract walk did), and
 *    every assembled group is followed by an assertion that
 *    `group.requests.size` equals the number of tags claimed. A flat tag
 *    namespace also opens a collision class a nested router could not express —
 *    `member "conn/get" + verb "set"` and `procedure ns "conn" + verb "get/set"`
 *    both spell `surface/conn/get/set` — which {@link assertTagSegment} makes
 *    unrepresentable by refusing a `/` in any name.
 * 2. **Wire schemas are CONTEXT-FREE.** Every schema on a spec is a
 *    {@link WireSchema}: `Schema.Codec<T, unknown, never, never>`. A schema whose
 *    decode or encode demanded an Effect service could not run on the wire,
 *    where there is no environment to provide one, so the requirement is a type
 *    bound rather than a convention.
 *
 * ── Declaring schemas (the #17 mapping, LAW) ───────────────────────────
 *
 * Every WIRE field uses `Schema.optionalKey` for an optional key (NEVER
 * `Schema.optional`, which round-trips an explicit `undefined` through `null`)
 * and `Schema.withDecodingDefaultKey` for a defaulted key (encoded stays `T`,
 * the key stays omittable). These are the only faithful translations of zod's
 * `.optional()` / `.default()`; the other Effect variants change the encoded
 * bytes.
 *
 * ── Encoded vs Type (D2/#13) ───────────────────────────────────────────
 *
 * A schema has two sides and they are NOT interchangeable at the two ends of a
 * call. INPUT positions (a payload a caller hands in) expose the **Encoded**
 * side, RESULT positions expose the **Type** side — the split zod spelled
 * `z.input` / `z.output`. `SurfaceTypes<S>` carries both: `Value`/`Key`/
 * `Output`/`Payload` are decoded domain types; the `*Wire` fields beside them
 * are the encoded shapes the hand-built client face (D2) accepts.
 */

import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import {
  buildClockNowRpc,
  CLOCK_NOW_NAMESPACE,
  CLOCK_NOW_VERB,
  type ReservedClockNowRpc,
} from "./clockNow";
import {
  buildIdentityRpc,
  IDENTITY_NAMESPACE,
  IDENTITY_VERB,
  type ReservedIdentityRpc,
} from "./identity";
import type { Cell, Collection, Event, Stream } from "./index";
import { cell, collection, event, stream } from "./index";
import {
  buildLivenessRpc,
  LIVENESS_NAMESPACE,
  LIVENESS_VERB,
  type ReservedLivenessRpc,
} from "./liveness";

// ── Wire schema bounds ─────────────────────────────────────────────────

/** A wire schema whose decoded type is `T`. `RD`/`RE` are pinned to `never`:
 *  decoding and encoding a wire value must require NO Effect services, because
 *  the wire has no environment to provide them. `Encoded` is left open
 *  (`unknown`) so any encoded representation is admissible — the concrete
 *  encoded type is recovered by indexing the spec's own schema
 *  (`S["cells"][K]["schema"]["Encoded"]`), which is exact, rather than by a
 *  second generic parameter every spec author would have to spell. */
export type WireSchema<T> = Schema.Codec<T, unknown, never, never>;

/** Any context-free wire schema — {@link WireSchema} with its decoded type left
 *  open. The bound for generic positions that only compose a schema (the tag
 *  emitters and their type oracles) rather than pinning what it decodes to. */
export type WireSchemaAny = Schema.Codec<unknown, unknown, never, never>;

// ── Spec types ─────────────────────────────────────────────────────────

/** Subset of cell verbs the surface exposes on the wire. Default is
 *  `["get", "patch"]` when `patchSchema` is set, else `["get", "set"]`.
 *  `test__set` is opt-in (production surfaces shouldn't leak the test
 *  reset procedure). */
export type CellVerb = "get" | "set" | "patch" | "test__set";

/** Subset of collection verbs the surface exposes. Default
 *  `["keys", "get", "upsert", "delete"]`. `test__set` is opt-in. `deltas` is
 *  opt-in too: a SINGLE batched snapshot-then-delta stream for the whole
 *  collection, the bulk-friendly counterpart to the per-key `keys`+`get` pair.
 *  A producer that mutates N keys in a tick publishes ONE coalesced frame
 *  instead of N per-key frames, so a whole-collection consumer pays per-tick
 *  decode/reconcile once, not once per key. Per-key `get` stays for the
 *  "watch one specific key" / subset case. */
export type CollectionVerb =
  | "keys"
  | "get"
  | "upsert"
  | "delete"
  | "deltas"
  | "test__set";

/** One frame of a collection's batched `deltas` stream: the full keyed set on
 *  (re)subscribe, then one coalesced `{upserts, removes}` per producer tick.
 *  The bulk-friendly twin of the per-key `get` stream — see {@link CollectionVerb}. */
export type CollectionDeltasMsg<K, T> =
  | { kind: "snapshot"; entries: [K, T][] }
  | { kind: "delta"; upserts: [K, T][]; removes: K[] };

/** The `delta` frame of {@link CollectionDeltasMsg} — one coalesced
 *  `{upserts, removes}` batch for a producer tick. Carried both on the server's
 *  internal `deltasBus` and on the wire, so deriving it from the union (rather
 *  than declaring a structural twin) keeps the bus payload and the wire frame
 *  ONE type that can't drift. */
export type CollectionDelta<K, T> = Extract<
  CollectionDeltasMsg<K, T>,
  { kind: "delta" }
>;

/** A CLIENT-side error policy declared on a cell spec — the OPAQUE, app-typed
 *  slot the framework carries but never interprets. `TPolicy` is the app's own
 *  closed discriminated union (kolu's `{kind:"toast"|"hostToast"|"scopedSub"}`,
 *  drishti's `{kind:"log"}`); the framework only THREADS the declared value to
 *  the app's registered interpreter (`onClientError`) when a subscription fails.
 *
 *  DISCRIMINATED on `authority`, not flattened — a server-authority cell and a
 *  local-authority cell are structurally distinct client-side subscriptions, and
 *  a discriminant keeps `coalesceMs` (a write-coalescing knob) unspellable on a
 *  server-authority cell. There is NO `initial` field: the local-authority store
 *  seeds from the cell's MANDATORY {@link CellSpec.default}, so "local-authority
 *  without a seed" is unrepresentable without a duplicate source of truth.
 *
 *  The default `TPolicy = never` makes `onError` unfillable for every existing
 *  `defineSurface` caller — no policy VALUE is assignable — so the slot costs
 *  nothing until a surface opts in via {@link defineSurfaceWithPolicy}. */
export type ClientCellPolicy<TPolicy> = { onError?: TPolicy } & (
  | { authority?: "server" }
  | { authority: "local"; coalesceMs?: number }
);

/** A CLIENT-side error policy declared on a collection spec — the collection
 *  sibling of {@link ClientCellPolicy}, but `onError` ONLY. A collection has no
 *  authority/coalesce concept (its per-site reactive `keys` filter is genuine
 *  use-site wiring, not a declared policy), so the slot carries just the opaque,
 *  app-typed error policy. `TPolicy = never` keeps it unfillable by default. */
export type ClientCollectionPolicy<TPolicy> = { onError?: TPolicy };

export interface CellSpec<T = unknown, P = T, TPolicy = never> {
  schema: WireSchema<T>;
  default: T;
  /** When set, `patch` becomes the canonical mutation verb and `set` is
   *  suppressed unless explicitly listed in `verbs`. */
  patchSchema?: WireSchema<P>;
  /** Pure merge `(current, patch) => next`. When `patchSchema` is set,
   *  the framework needs this to apply partial updates. Used by **both**
   *  sides:
   *
   *    - `implementSurface` plugs it into `cellHandlers`' patch path so
   *      server-side mutations apply it before persist+publish.
   *    - `surfaceClient` plugs it into `useCell`'s `applyPatch` so
   *      authority-`local` cells apply patches optimistically with the
   *      same merge function the server uses.
   *
   *  Declared once on the spec so server and client can't drift. The
   *  consumer can override per-side via `implementSurface`'s deps or
   *  `useCell`'s `applyPatch` when a side legitimately needs a different
   *  merge (rare). */
  patch?: (current: T, patch: P) => T;
  /** Optional equality predicate. When supplied, `set` / `patch` /
   *  `test__set` and the server-internal `ctx.cells.<key>.set` skip the
   *  store write and bus publish if `equals(prev, next)` returns true.
   *
   *  Defaults to no dedup (every mutation publishes), which preserves
   *  the legacy "writer's intent = publish" contract. Opt in when a
   *  cell's value comes from a source that re-serializes the same
   *  content on every write (e.g. test harness re-POSTing the same
   *  fixture, or a server-side write loop firing on every dirty tick)
   *  and downstream consumers do work on each publish that would
   *  otherwise be wasted — most importantly, SolidJS keyed `<Show>`
   *  remounts driven by reactive object-identity changes. The
   *  predicate runs on every mutation, so keep it cheap for hot cells
   *  (terminalList et al. don't need it). */
  equals?: (a: T, b: T) => boolean;
  verbs?: readonly CellVerb[];
  /** Mark this cell as a READINESS GATE: a pure predicate over its own value that
   *  the client folds into `client.health().live` (AND-reduced with the transport
   *  leg and every other readiness cell). A mirrored surface's `connection` cell
   *  declares `liveWhen: (v) => v.state === "connected"`, so a surface composing
   *  that cell carries the mirror-liveness leg in its fact BY CONSTRUCTION —
   *  `<SurfaceGate>`/`<HostStatusPip>` read the whole "is it connected?" truth and
   *  no consumer hand-ANDs the cell state (the round-5 collapse).
   *
   *  This is the runtime sibling of {@link CellSpec.equals}: the GENERIC mechanism lives in
   *  `@kolu/surface` (core only INVOKES the predicate — it never names a state
   *  literal or any domain vocabulary), while the predicate itself (`v.state ===
   *  "connected"`) is declared on the cell where its schema lives — the same
   *  mechanism/vocabulary split as `resolveCellVerbs`. Keep it PURE and CHEAP (it runs on every cell frame
   *  and every `health()` read), and ensure the cell's `default` does NOT satisfy
   *  it (gate-closed cold start), so a freshly-composed surface reads `connecting`
   *  until a genuine "ready" frame arrives — `DEFAULT_CONNECTION` already complies. */
  liveWhen?: (value: T) => boolean;
  /** The OPAQUE, app-typed client error policy for this cell — see
   *  {@link ClientCellPolicy}. The framework never interprets it; it threads the
   *  declared value to the app's registered `onClientError` when this cell's
   *  client subscription fails. Unfillable unless the surface was built with a
   *  non-`never` `TPolicy` via {@link defineSurfaceWithPolicy}.
   *
   *  The `authority: "local"` arm's validity (a non-null object value with a
   *  `set`/`patch` verb) is enforced by `buildSurfaceClient`'s CONSTRUCTION
   *  BACKSTOP, not the type: the `SurfaceSpec` constraint erases `T` to `any` at
   *  the `defineSurfaceWithPolicy` spec-literal site, so a `[T] extends [object]`
   *  gate would resolve to the full union there anyway (`[any] extends [object]`
   *  distributes to both arms) — a type gate can't reliably fire where the
   *  declaration is written, exactly as the missing-interpreter check is runtime
   *  for the same erasure reason. */
  client?: ClientCellPolicy<TPolicy>;
}

export interface CollectionSpec<K = unknown, T = unknown, TPolicy = never> {
  keySchema: WireSchema<K>;
  schema: WireSchema<T>;
  verbs?: readonly CollectionVerb[];
  /** The OPAQUE, app-typed client error policy for this collection — see
   *  {@link ClientCollectionPolicy}. The framework threads the declared value to
   *  the app's registered `onClientError` on a subscription failure; it never
   *  interprets it. Unfillable unless the surface was built with a non-`never`
   *  `TPolicy` via {@link defineSurfaceWithPolicy}. */
  client?: ClientCollectionPolicy<TPolicy>;
  /** Per-key VALUE equality — the collection sibling of {@link CellSpec.equals}.
   *  A `derived.collection(...)` reconciler uses it to publish only the keys whose
   *  value actually MOVED against the last snapshot (drishti's `processChanged`,
   *  declared once here instead of hand-held at every write site). Omitted ⇒ the
   *  reconciler treats every present key as changed each frame (the unconditional
   *  re-publish drishti's `cpuCores`/`networkInterfaces` do today — a per-tick rate
   *  that always moves). It does NOT gate an authored collection's `upsert` publish;
   *  it is the derived reconciler's diff predicate. */
  equals?: (a: T, b: T) => boolean;
}

export interface StreamSpec<I = unknown, T = unknown> {
  inputSchema: WireSchema<I>;
  outputSchema: WireSchema<T>;
}

export interface EventSpec<I = unknown, T = unknown> {
  inputSchema: WireSchema<I>;
  outputSchema: WireSchema<T>;
}

export interface ProcedureSpec<I = unknown, O = unknown> {
  /** When omitted the procedure takes no input (payload `Schema.Void`). */
  input?: WireSchema<I>;
  /** When omitted the procedure returns void (success `Schema.Void`). */
  output?: WireSchema<O>;
  /** The procedure's DECLARED error channel (SK6) — one Effect Schema, normally a
   *  `Schema.Union` of `Schema.TaggedErrorClass`es (see `./errors` for the
   *  framework's own vocabulary). A declaring handler FAILS with an instance of a
   *  declared class; the caller receives it decoded, with its `_tag` and data
   *  intact, and narrows with a `_tag` check — so a typed domain error can no
   *  longer flatten to an opaque transport failure at a generic hop.
   *
   *  Replaces the oRPC-era `errors: ErrorMap` keyed by magic code string. An
   *  UNDECLARED throw is a DEFECT (`Effect.die`), not a failure: it still crosses
   *  as an opaque defect, which remains the fail-fast crash-loudly channel.
   *  Declare what is actionable. */
  error?: WireSchemaAny;
}

/** `TPolicy` DEFAULTS to `any`, not `never` — so every bare `extends SurfaceSpec`
 *  constraint across the framework (`Surface<S>`, `SurfaceRpcsFor<S>`, the bound
 *  client types, the map's `ES`, …) accepts a policy-bearing spec without churn: a
 *  wider constraint still admits every existing `TPolicy = never` spec. The
 *  "unfillable client for existing callers" guarantee is pinned at the ONE seam that
 *  MINTS a spec from a caller literal — `defineSurface<const S extends
 *  SurfaceSpec<never>>` — so a plain `defineSurface` caller still cannot spell a
 *  `client.onError` value (it must be assignable to `never`). A surface OPTS IN to a
 *  real policy union via {@link defineSurfaceWithPolicy}. */
export interface SurfaceSpec<TPolicy = any> {
  cells?: Record<string, CellSpec<any, any, TPolicy>>;
  collections?: Record<string, CollectionSpec<any, any, TPolicy>>;
  streams?: Record<string, StreamSpec<any, any>>;
  events?: Record<string, EventSpec<any, any>>;
  /** Imperative escape hatch — non-descriptor RPCs that should still
   *  travel through the surface. Inner key is the verb. Lives under the
   *  same `<surface-key>/<verb>` tag namespace as the typed primitives, so
   *  `procedures.notes.create` ends up at `surface/notes/create` on the
   *  wire — alongside `surface/notes/{keys,get,upsert,delete}` from the
   *  matching `collections.notes` entry. RPCs that don't fit a primitive
   *  *or* a request/response procedure (bidirectional binary streams,
   *  custom retry plumbing) stay outside the surface as raw `Rpc`s in the
   *  host's own group. */
  procedures?: Record<string, Record<string, ProcedureSpec<any, any>>>;
}

// ── Defaults ────────────────────────────────────────────────────────────

/** Default verb sets — exported so server-side `implementSurface` derives
 *  handler verbs from the same source as `defineSurface`'s tag minting.
 *  Drift between the group and the handlers is a wire-shape break. */
export const DEFAULT_CELL_VERBS_WITH_PATCH = ["get", "patch"] as const;
export const DEFAULT_CELL_VERBS_WITHOUT_PATCH = ["get", "set"] as const;
export const DEFAULT_COLLECTION_VERBS = [
  "keys",
  "get",
  "upsert",
  "delete",
] as const;

/** A cell's effective verbs — `spec.verbs` when present, else the patch /
 *  no-patch default. The SINGLE runtime source of this rule: the tag minting
 *  (`cellRpcEntries`), the server handler walk (`server.ts`), and the client
 *  binding (`surfaceClient`) all call this, so the wire shape, the handler set,
 *  and the bound client can't drift on a `??` someone forgot to update.
 *  `CellVerbsOf` is its type-level dual (TS can't reuse the runtime value);
 *  keep the two in step. */
export function resolveCellVerbs(
  spec: CellSpec<any, any, any>,
): readonly CellVerb[] {
  return (
    spec.verbs ??
    (spec.patchSchema
      ? DEFAULT_CELL_VERBS_WITH_PATCH
      : DEFAULT_CELL_VERBS_WITHOUT_PATCH)
  );
}

/** A collection's effective verbs — `spec.verbs` when present, else
 *  {@link DEFAULT_COLLECTION_VERBS}. The collection-side dual of
 *  {@link resolveCellVerbs}: the SINGLE runtime source of this rule, so the tag
 *  minting (`collectionRpcEntries`), the server handler walk (`server.ts`'s
 *  `walkSurface`), and the client binding (`surfaceClient`) can't drift on a `??`
 *  someone forgot to update. */
export function resolveCollectionVerbs(
  spec: CollectionSpec<any, any, any>,
): readonly CollectionVerb[] {
  return spec.verbs ?? DEFAULT_COLLECTION_VERBS;
}

/** Whether a collection opts into batched `deltas` delivery — derived from
 *  {@link resolveCollectionVerbs} so the deltas gate (server-side coalescing and
 *  client-side routing) reads from the one verb resolver, never an inline
 *  `.includes("deltas")` that a third call site could forget. */
export function collectionHasDeltas(
  spec: CollectionSpec<any, any, any>,
): boolean {
  return resolveCollectionVerbs(spec).includes("deltas");
}

// ── Tag algebra ────────────────────────────────────────────────────────
//
// Rpc tags are slash-joined wire paths (D1). The namespace is FLAT: there is no
// nesting on the wire, only string tags, so every rule about "which member owns
// which path" is a rule about string joining and lives HERE, in one section, for
// the walk below, for `composeSurfaceContracts`, and for the client face's
// sibling scoping (D2).

/** The separator every tag segment is joined with. */
export const TAG_SEPARATOR = "/";

/** The root segment every surface member's tag carries, so a surface member can
 *  never collide with a host's own hand-written `Rpc` tags. */
export const SURFACE_TAG_ROOT = "surface";

/** The tag prefix of a STANDALONE surface: `"surface/"`. */
export const SURFACE_TAG_PREFIX = "surface/";

/** The tag prefix of one sibling inside a {@link composeSurfaceContracts} bundle:
 *  `"surface/<key>/"`. Sibling composition prefixes per sibling and NEVER merges
 *  bare groups — the three reserved `system/*` members exist on EVERY surface, so
 *  a bare merge would collide them across siblings and (`RpcGroup.merge` being a
 *  last-writer-wins `Map.set`) silently keep one. */
export function siblingTagPrefix(key: string): string {
  return `${SURFACE_TAG_ROOT}${TAG_SEPARATOR}${key}${TAG_SEPARATOR}`;
}

/** Join a member's tag from a prefix, a member name, and a verb. */
export function surfaceTag(
  tagPrefix: string,
  member: string,
  verb: string,
): string {
  return `${tagPrefix}${member}${TAG_SEPARATOR}${verb}`;
}

/** Rewrite a STANDALONE surface tag (`surface/<member>/<verb>`) into the tag the
 *  same member carries inside a sibling bundle (`surface/<key>/<member>/<verb>`).
 *  The tag-algebra dual of the oRPC-era `scopeSibling(link, key)` link re-wrap:
 *  a per-sibling client face is built against the standalone tags and its
 *  dispatch is wrapped through here, so the face itself never learns it is
 *  scoped. Throws on a tag that is not a surface tag — a mis-scoped dispatch must
 *  fail loudly at the seam, not 404 at the far end. */
export function scopeSiblingTag(tag: string, siblingKey: string): string {
  if (!tag.startsWith(SURFACE_TAG_PREFIX)) {
    throw new Error(
      `scopeSiblingTag: "${tag}" is not a surface tag (expected a "${SURFACE_TAG_PREFIX}" prefix), so it cannot be scoped to sibling "${siblingKey}".`,
    );
  }
  return siblingTagPrefix(siblingKey) + tag.slice(SURFACE_TAG_PREFIX.length);
}

/** Every name that becomes a tag segment must be a non-empty string free of the
 *  separator. Both halves are load-bearing on a FLAT namespace:
 *
 *    - an EMPTY name would mint `surface//get`, two members away from readable;
 *    - a name CONTAINING `/` opens a collision class a nested router could not
 *      express — a stream named `"conn/get"` and a procedure `conn.get` would
 *      both spell `surface/conn/get/...`, with DIFFERENT (member, verb) pairs, so
 *      the `claim` duplicate-check could not see it. Refusing the `/` makes the
 *      collision unrepresentable instead of merely detected. */
function assertTagSegment(kind: string, name: string): void {
  if (name.length === 0) {
    throw new Error(
      `defineSurface: empty ${kind} name — every wire tag segment must be a non-empty name.`,
    );
  }
  if (name.includes(TAG_SEPARATOR)) {
    throw new Error(
      `defineSurface: ${kind} name "${name}" contains "${TAG_SEPARATOR}". Wire tags are slash-joined and FLAT, so a name carrying a separator could collide with a different member's tag.`,
    );
  }
}

// ── Per-primitive Rpc derivation ───────────────────────────────────────
//
// Internal: each returns a record of `Rpc` values keyed by VERB. The caller
// (`buildSurface`) claims the record against the flat tag map. Typing is loose
// (`Rpc.Any`) because the verb set is a RUNTIME value — the precise per-verb
// shape is computed by the type oracles further down, which mirror these
// switches 1:1 (drift watch).

function cellRpcEntries<T, P>(
  tagBase: string,
  spec: CellSpec<T, P, any>,
): Record<string, Rpc.Any> {
  const verbs = resolveCellVerbs(spec);
  const entries: Record<string, Rpc.Any> = {};
  for (const v of verbs) {
    if (v === "get") {
      entries.get = Rpc.make(`${tagBase}${TAG_SEPARATOR}get`, {
        success: spec.schema,
        stream: true,
      });
    } else if (v === "set") {
      entries.set = Rpc.make(`${tagBase}${TAG_SEPARATOR}set`, {
        payload: spec.schema,
      });
    } else if (v === "patch") {
      if (!spec.patchSchema) {
        throw new Error("surface: cell exposes 'patch' but has no patchSchema");
      }
      entries.patch = Rpc.make(`${tagBase}${TAG_SEPARATOR}patch`, {
        payload: spec.patchSchema,
      });
    } else if (v === "test__set") {
      entries.test__set = Rpc.make(`${tagBase}${TAG_SEPARATOR}test__set`, {
        payload: spec.schema,
      });
    }
  }
  return entries;
}

/** The `deltas` wire schema (`snapshot | delta`) for a collection. Exported as the ONE
 *  authority so a keyed-map's folded entry collection (`@kolu/surface-map`) decodes the exact
 *  same shape rather than a drift-prone copy — a wire contract with two authorities silently
 *  cross-decodes if the format ever changes. It is also the single home both the runtime
 *  emitter (`collectionRpcEntries`) and the type oracle (`buildCollection`) build from.
 *
 *  The encoded shape is FROZEN and byte-identical to the oRPC/zod original:
 *  `{"kind":"snapshot","entries":[[k,v],…]}` and
 *  `{"kind":"delta","upserts":[[k,v],…],"removes":[k,…]}` — entries are two-element
 *  JSON arrays, the discriminant is `kind` (not `_tag`), and no key is reordered or
 *  dropped. `collectionDeltasSchema.test.ts` pins the exact bytes. */
export function collectionDeltasSchema<
  KSc extends WireSchemaAny,
  VSc extends WireSchemaAny,
>(keySchema: KSc, schema: VSc) {
  const entry = Schema.Tuple([keySchema, schema]);
  return Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("snapshot"),
      entries: Schema.Array(entry),
    }),
    Schema.Struct({
      kind: Schema.Literal("delta"),
      upserts: Schema.Array(entry),
      removes: Schema.Array(keySchema),
    }),
  ]);
}

function collectionRpcEntries<K, T>(
  tagBase: string,
  spec: CollectionSpec<K, T, any>,
): Record<string, Rpc.Any> {
  const verbs = resolveCollectionVerbs(spec);
  const keyShape = Schema.Struct({ key: spec.keySchema });
  const upsertShape = Schema.Struct({
    key: spec.keySchema,
    value: spec.schema,
  });
  const entries: Record<string, Rpc.Any> = {};
  for (const v of verbs) {
    if (v === "keys") {
      entries.keys = Rpc.make(`${tagBase}${TAG_SEPARATOR}keys`, {
        success: Schema.Array(spec.keySchema),
        stream: true,
      });
    } else if (v === "get") {
      entries.get = Rpc.make(`${tagBase}${TAG_SEPARATOR}get`, {
        payload: keyShape,
        success: spec.schema,
        stream: true,
      });
    } else if (v === "deltas") {
      entries.deltas = Rpc.make(`${tagBase}${TAG_SEPARATOR}deltas`, {
        success: collectionDeltasSchema(spec.keySchema, spec.schema),
        stream: true,
      });
    } else if (v === "upsert") {
      entries.upsert = Rpc.make(`${tagBase}${TAG_SEPARATOR}upsert`, {
        payload: upsertShape,
      });
    } else if (v === "delete") {
      entries.delete = Rpc.make(`${tagBase}${TAG_SEPARATOR}delete`, {
        payload: keyShape,
      });
    } else if (v === "test__set") {
      entries.test__set = Rpc.make(`${tagBase}${TAG_SEPARATOR}test__set`, {
        payload: Schema.Array(upsertShape),
      });
    }
  }
  return entries;
}

function streamRpcEntries<I, T>(
  tagBase: string,
  spec: StreamSpec<I, T>,
): Record<string, Rpc.Any> {
  return {
    get: Rpc.make(`${tagBase}${TAG_SEPARATOR}get`, {
      payload: spec.inputSchema,
      success: spec.outputSchema,
      stream: true,
    }),
  };
}

function eventRpcEntries<I, T>(
  tagBase: string,
  spec: EventSpec<I, T>,
): Record<string, Rpc.Any> {
  return {
    get: Rpc.make(`${tagBase}${TAG_SEPARATOR}get`, {
      payload: spec.inputSchema,
      success: spec.outputSchema,
      stream: true,
    }),
  };
}

function procedureRpcEntry<I, O>(
  tag: string,
  spec: ProcedureSpec<I, O>,
): Rpc.Any {
  // `payload` / `success` / `error` are supplied UNCONDITIONALLY (`Void` / `Void`
  // / `Never` when undeclared) so this runtime entry and the `buildProcedure`
  // type oracle below stay ONE shape — the drift-watch rule. `Schema.Never` as
  // the error channel is semantically "declares no failures", which is exactly
  // what an undeclared spec means.
  return Rpc.make(tag, {
    payload: spec.input ?? Schema.Void,
    success: spec.output ?? Schema.Void,
    error: spec.error ?? Schema.Never,
  });
}

// ── Type oracles for per-primitive Rpc shape ───────────────────────────
//
// Each `build*` here is a runtime-dead type oracle: TypeScript reads its return
// shape via `ReturnType<typeof X<Tag, Sc>>` at the mapped types below (see
// `SurfaceRpcsFor<S>`) to compute the exact per-member `Rpc` type — tag literal,
// payload schema, success schema, error schema — WITHOUT spelling out Effect's
// internal `Rpc<...>` / `RpcSchema.Stream<...>` types by hand. The bodies are
// never called: the actual `Rpc`s are built by the lowercase `xxxRpcEntries`
// functions above, which return `Record<string, Rpc.Any>` because their verb set
// is a runtime value.
//
// `noinline`-equivalent: tree-shaking removes the bodies because no runtime
// caller exists. Keeping them as real functions (rather than `declare function`)
// lets us reuse the inferred return type without duplicating Effect's internal
// types — which is the duplication this file exists to avoid.
//
// Drift watch: when adding a verb, edit both the runtime `xxxRpcEntries` (above)
// AND the matching `build*` oracle (below).
//
// Reserved members (`system/live`, `system/identity`, `system/clockNow`) need NO
// oracle of their own: their verb is statically known, so `./liveness`,
// `./identity` and `./clockNow` each export ONE `buildXRpc` that is both the
// runtime emitter and the oracle.

// One oracle per cell VERB, so `CellVerbRpc<…>` resolves the verb set from
// `S["verbs"]` and maps each verb to its Rpc — a `verbs`-narrowed cell
// (`["get"]`) types exactly the tags the runtime group carries, no phantom
// `set`. Mirrors the per-verb `entries[v]` switch in `cellRpcEntries` 1:1.
function buildCellGet<Tag extends string, Sc extends WireSchemaAny>(
  tag: Tag,
  opts: { schema: Sc },
) {
  return Rpc.make(tag, { success: opts.schema, stream: true });
}

function buildCellSet<Tag extends string, Sc extends WireSchemaAny>(
  tag: Tag,
  opts: { schema: Sc },
) {
  return Rpc.make(tag, { payload: opts.schema });
}

function buildCellPatch<Tag extends string, Sc extends WireSchemaAny>(
  tag: Tag,
  opts: { patchSchema: Sc },
) {
  return Rpc.make(tag, { payload: opts.patchSchema });
}

function buildCollection<
  Tag extends string,
  KSc extends WireSchemaAny,
  VSc extends WireSchemaAny,
>(tagBase: Tag, opts: { keySchema: KSc; schema: VSc }) {
  const keyShape = Schema.Struct({ key: opts.keySchema });
  const upsertShape = Schema.Struct({
    key: opts.keySchema,
    value: opts.schema,
  });
  return {
    keys: Rpc.make(`${tagBase}${TAG_SEPARATOR}keys`, {
      success: Schema.Array(opts.keySchema),
      stream: true,
    }),
    get: Rpc.make(`${tagBase}${TAG_SEPARATOR}get`, {
      payload: keyShape,
      success: opts.schema,
      stream: true,
    }),
    deltas: Rpc.make(`${tagBase}${TAG_SEPARATOR}deltas`, {
      success: collectionDeltasSchema(opts.keySchema, opts.schema),
      stream: true,
    }),
    upsert: Rpc.make(`${tagBase}${TAG_SEPARATOR}upsert`, {
      payload: upsertShape,
    }),
    delete: Rpc.make(`${tagBase}${TAG_SEPARATOR}delete`, { payload: keyShape }),
    // The opt-in `test__set` verb (replace-all from a fixture). Listed alongside
    // the other verbs: opt-in gating is done by `CollectionVerbRpc` indexing the
    // verb UNION, not by which builder owns the field, so `test__set` surfaces
    // only for a collection whose `verbs` lists it. Mirrors the runtime
    // `entries.test__set = …` branch in `collectionRpcEntries` (drift watch).
    test__set: Rpc.make(`${tagBase}${TAG_SEPARATOR}test__set`, {
      payload: Schema.Array(upsertShape),
    }),
  };
}

function buildStream<
  Tag extends string,
  ISc extends WireSchemaAny,
  OSc extends WireSchemaAny,
>(tagBase: Tag, opts: { inputSchema: ISc; outputSchema: OSc }) {
  return {
    get: Rpc.make(`${tagBase}${TAG_SEPARATOR}get`, {
      payload: opts.inputSchema,
      success: opts.outputSchema,
      stream: true,
    }),
  };
}

function buildEvent<
  Tag extends string,
  ISc extends WireSchemaAny,
  OSc extends WireSchemaAny,
>(tagBase: Tag, opts: { inputSchema: ISc; outputSchema: OSc }) {
  return {
    get: Rpc.make(`${tagBase}${TAG_SEPARATOR}get`, {
      payload: opts.inputSchema,
      success: opts.outputSchema,
      stream: true,
    }),
  };
}

// ONE procedure oracle, not four. The oRPC era needed one per input/output arm
// because `oc.input(...)`'s builder type differed per arm; `Rpc.make` takes all
// three schemas positionally, so the four arms are resolved as SCHEMAS
// ({@link ProcedureInputSchema} et al.) and fed to a single oracle — which is
// exactly what the single runtime `procedureRpcEntry` does with `?? Schema.Void`.
function buildProcedure<
  Tag extends string,
  ISc extends WireSchemaAny,
  OSc extends WireSchemaAny,
  ESc extends WireSchemaAny,
>(tag: Tag, opts: { input: ISc; output: OSc; error: ESc }) {
  return Rpc.make(tag, {
    payload: opts.input,
    success: opts.output,
    error: opts.error,
  });
}

// ── The verb sets, at the type level ───────────────────────────────────

/** The verb set a cell exposes — the TYPE counterpart of the runtime
 *  {@link resolveCellVerbs}: `spec.verbs` when present, else the patch/no-patch
 *  default. TS can't reuse the runtime value, so this mirrors it; keep the two
 *  in step. Honoring `verbs` here is load-bearing, not cosmetic:
 *  a read-only cell (`verbs: ["get"]`, e.g. `@kolu/surface-remote`'s
 *  connection-health cell) must NOT type a `set` tag the runtime group doesn't
 *  carry — otherwise a downstream consumer (kolu, drishti) sees a typed
 *  `surface/<cell>/set` that fails at runtime, an API-facing falsehood in the
 *  exact cell whose stale-health safety relies on `set` being absent. */
export type CellVerbsOf<S extends CellSpec<any, any, any>> = S extends {
  verbs: readonly CellVerb[];
}
  ? S["verbs"][number]
  : S extends { patchSchema: WireSchemaAny }
    ? (typeof DEFAULT_CELL_VERBS_WITH_PATCH)[number]
    : (typeof DEFAULT_CELL_VERBS_WITHOUT_PATCH)[number];

/** The verb set a collection exposes — the TYPE counterpart of the runtime
 *  {@link resolveCollectionVerbs}: `spec.verbs` when present, else
 *  {@link DEFAULT_COLLECTION_VERBS}. TS can't reuse the runtime value, so this
 *  mirrors it; keep the two in step. Honoring `verbs` here is load-bearing, the
 *  collection dual of {@link CellVerbsOf}: `deltas` and `test__set` are OPT-IN,
 *  so a DEFAULT collection must NOT type a `deltas` tag the runtime group never
 *  mints, and a read-only collection (`verbs: ["keys", "get"]`, e.g. `common`'s
 *  `authored` / `daemonStatus`) must NOT type the `upsert` / `delete` the server
 *  omits. */
export type CollectionVerbsOf<S extends CollectionSpec<any, any, any>> =
  S extends {
    verbs: readonly CollectionVerb[];
  }
    ? S["verbs"][number]
    : (typeof DEFAULT_COLLECTION_VERBS)[number];

/** Whether a cell exposes a CLIENT-facing wire-mutation verb — `set` or
 *  `patch`, the verbs the Solid client's `.use()` mutate path actually calls.
 *  `test__set` does NOT count: it's the opt-in e2e reset procedure, never a
 *  consumer mutation, so a cell whose only non-`get` verb is `test__set` (e.g.
 *  `activityFeed` / `session`, `["get", "test__set"]`) is read-only on the
 *  client — the server is the sole writer. A get-only cell (`verbs: ["get"]`)
 *  is likewise `false`. This is the client-side dual of {@link CellVerbsOf}
 *  honoring `verbs` in the raw group: it must select the SAME mutation verb
 *  the runtime binds in `surfaceClient`, or the bound type advertises a `.set` /
 *  local-authority path the runtime closure can't service (`mutate` undefined). */
export type CellIsMutable<S extends CellSpec<any, any, any>> =
  "set" extends CellVerbsOf<S>
    ? true
    : "patch" extends CellVerbsOf<S>
      ? true
      : false;

/** Whether a cell exposes the `patch` wire verb (the partial-payload mutation).
 *  Load-bearing for the client bound shape: `patch` carries `patchSchema` (`P`),
 *  but `set` carries the full value schema (`T`). A cell that mutates via `set`
 *  alone — even one that also declares a `patchSchema` (a legal but unusual
 *  combination, e.g. `patchSchema` + explicit `verbs: ["get", "set"]`) — has NO
 *  `P`-shaped wire procedure, so the client must NOT advertise a `.patch(P)` that
 *  would post a partial `P` to the full-value `set` endpoint. `surfaceClient`
 *  collapses such a cell's client patch shape to `T` (full replacement through
 *  `set`); this type is what drives that collapse. */
export type CellHasPatchVerb<S extends CellSpec<any, any, any>> =
  "patch" extends CellVerbsOf<S> ? true : false;

/** The schema a procedure's PAYLOAD resolves to — its declared `input`, or
 *  `Schema.Void` when it declares none. The type-level dual of the runtime
 *  `spec.input ?? Schema.Void`. */
export type ProcedureInputSchema<S> = S extends { input: WireSchemaAny }
  ? S["input"]
  : typeof Schema.Void;

/** The schema a procedure's SUCCESS resolves to — its declared `output`, or
 *  `Schema.Void` when it declares none. */
export type ProcedureOutputSchema<S> = S extends { output: WireSchemaAny }
  ? S["output"]
  : typeof Schema.Void;

/** The schema a procedure's ERROR channel resolves to — its declared `error`, or
 *  `Schema.Never` ("declares no failures") when it declares none. The ONE
 *  extractor for "how a spec declares errors", owned here beside
 *  {@link ProcedureSpec}, and consumed by the server's handler typing and the
 *  Solid client's bound-procedure rejection type — so a change to the declaration
 *  shape edits this alias, not three modules. */
export type ProcedureSpecError<S> = S extends { error: WireSchemaAny }
  ? S["error"]
  : typeof Schema.Never;

// ── The spec → Rpc union ───────────────────────────────────────────────
//
// The type-level image of the runtime walk. `SurfaceRpcsFor<S>` is a UNION of
// `Rpc` types (not an object tree): the wire namespace is flat, so the honest
// type-level shape of a surface is "the set of Rpcs it mints", and
// `SurfaceTags<S>` is that set's `_tag` projection.

type CellVerbRpc<
  Tag extends string,
  V extends CellVerb,
  Sp extends CellSpec<any, any, any>,
> = V extends "get"
  ? ReturnType<typeof buildCellGet<`${Tag}/get`, Sp["schema"]>>
  : V extends "set"
    ? ReturnType<typeof buildCellSet<`${Tag}/set`, Sp["schema"]>>
    : V extends "patch"
      ? ReturnType<
          typeof buildCellPatch<`${Tag}/patch`, NonNullable<Sp["patchSchema"]>>
        >
      : V extends "test__set"
        ? ReturnType<typeof buildCellSet<`${Tag}/test__set`, Sp["schema"]>>
        : never;

type CollectionRpcShape<
  Tag extends string,
  Sp extends CollectionSpec<any, any, any>,
> = ReturnType<typeof buildCollection<Tag, Sp["keySchema"], Sp["schema"]>>;

type CollectionVerbRpc<
  Tag extends string,
  V extends CollectionVerb,
  Sp extends CollectionSpec<any, any, any>,
> = V extends keyof CollectionRpcShape<Tag, Sp>
  ? CollectionRpcShape<Tag, Sp>[V]
  : never;

type SpecCellRpcs<S extends SurfaceSpec, Prefix extends string> =
  S["cells"] extends Record<string, CellSpec<any, any, any>>
    ? {
        [K in keyof S["cells"] & string]: CellVerbRpc<
          `${Prefix}${K}`,
          CellVerbsOf<S["cells"][K]>,
          S["cells"][K]
        >;
      }[keyof S["cells"] & string]
    : never;

type SpecCollectionRpcs<S extends SurfaceSpec, Prefix extends string> =
  S["collections"] extends Record<string, CollectionSpec<any, any, any>>
    ? {
        [K in keyof S["collections"] & string]: CollectionVerbRpc<
          `${Prefix}${K}`,
          CollectionVerbsOf<S["collections"][K]>,
          S["collections"][K]
        >;
      }[keyof S["collections"] & string]
    : never;

type SpecStreamRpcs<S extends SurfaceSpec, Prefix extends string> =
  S["streams"] extends Record<string, StreamSpec<any, any>>
    ? {
        [K in keyof S["streams"] & string]: ReturnType<
          typeof buildStream<
            `${Prefix}${K}`,
            S["streams"][K]["inputSchema"],
            S["streams"][K]["outputSchema"]
          >
        >["get"];
      }[keyof S["streams"] & string]
    : never;

type SpecEventRpcs<S extends SurfaceSpec, Prefix extends string> =
  S["events"] extends Record<string, EventSpec<any, any>>
    ? {
        [K in keyof S["events"] & string]: ReturnType<
          typeof buildEvent<
            `${Prefix}${K}`,
            S["events"][K]["inputSchema"],
            S["events"][K]["outputSchema"]
          >
        >["get"];
      }[keyof S["events"] & string]
    : never;

type SpecProcedureRpcs<S extends SurfaceSpec, Prefix extends string> =
  S["procedures"] extends Record<
    string,
    Record<string, ProcedureSpec<any, any>>
  >
    ? {
        [K in keyof S["procedures"] & string]: {
          [V in keyof S["procedures"][K] & string]: ReturnType<
            typeof buildProcedure<
              `${Prefix}${K}/${V}`,
              ProcedureInputSchema<S["procedures"][K][V]>,
              ProcedureOutputSchema<S["procedures"][K][V]>,
              ProcedureSpecError<S["procedures"][K][V]>
            >
          >;
        }[keyof S["procedures"][K] & string];
      }[keyof S["procedures"] & string]
    : never;

/** Every `Rpc` a surface mints, as ONE union — the type-level image of the
 *  runtime group, including the three framework-reserved `system/*` members that
 *  are claimed onto EVERY surface. `Prefix` is the surface's tag prefix
 *  (`"surface/"` standalone, `"surface/<key>/"` for a composed sibling).
 *
 *  This — not `surface.group`'s type — is where per-member precision lives. The
 *  runtime group is assembled from a runtime spec walk, so its value type is the
 *  honest erased `RpcGroup<Rpc.Any>`; the precise shape is derived from the SPEC
 *  (D2), which is also how the client face is typed. */
export type SurfaceRpcsFor<
  S extends SurfaceSpec,
  Prefix extends string = typeof SURFACE_TAG_PREFIX,
> =
  | SpecCellRpcs<S, Prefix>
  | SpecCollectionRpcs<S, Prefix>
  | SpecStreamRpcs<S, Prefix>
  | SpecEventRpcs<S, Prefix>
  | SpecProcedureRpcs<S, Prefix>
  | ReservedLivenessRpc<Prefix>
  | ReservedIdentityRpc<Prefix>
  | ReservedClockNowRpc<Prefix>;

/** The exact set of wire tags a surface mints, as a string-literal union — the
 *  `_tag` projection of {@link SurfaceRpcsFor}. This is the type-level counterpart
 *  of the `group.requests` key-set assertion: a member the runtime does not mint
 *  is not in this union, so a Stage-2 handler map or a Stage-3 dispatch keyed off
 *  it cannot name a tag that does not exist. */
export type SurfaceTags<
  S extends SurfaceSpec,
  Prefix extends string = typeof SURFACE_TAG_PREFIX,
> = SurfaceRpcsFor<S, Prefix>["_tag"];

// ── Inferred runtime types from a spec ─────────────────────────────────

type EmptyObj = NonNullable<unknown>;

/** Map a `SurfaceSpec` to the runtime types its schemas describe — the
 *  `Note` you'd otherwise write `typeof NoteSchema.Type` for. Lets a
 *  surface declaration be the single source of truth for both wire shape
 *  AND the domain types consumers render against.
 *
 *  Indexed-access usage (tRPC-style):
 *
 *      type SF = SurfaceTypes<typeof surface.spec>;
 *      type Note     = SF["collections"]["notes"]["Value"];
 *      type NoteId   = SF["collections"]["notes"]["Key"];
 *      type Prefs    = SF["cells"]["preferences"]["Value"];
 *      type PrefsP   = SF["cells"]["preferences"]["Patch"];   // never if no patchSchema
 *
 *  Re-export the per-domain aliases at the surface module so consumers
 *  `import { Note, NoteId } from "./surface"` (the universal pattern in
 *  Zod / Drizzle / tRPC ecosystems).
 *
 *  **Two sides, deliberately (D2/#13).** The unsuffixed fields are the DECODED
 *  (`Type`) side — the domain types a handler produces and a consumer renders.
 *  The `*Wire` fields beside them are the ENCODED side — what a caller passes at
 *  an INPUT position, i.e. exactly the split zod spelled `z.output` / `z.input`.
 *  A schema carrying a decoding default makes a key REQUIRED after decode but
 *  OMITTABLE on the wire, so a face that typed its inputs on the decoded side
 *  would demand arguments the wire does not need. */
export type SurfaceTypes<S extends SurfaceSpec> = {
  cells: S["cells"] extends Record<string, CellSpec<any, any, any>>
    ? {
        [K in keyof S["cells"] & string]: {
          Value: S["cells"][K]["schema"]["Type"];
          ValueWire: S["cells"][K]["schema"]["Encoded"];
          Patch: NonNullable<S["cells"][K]["patchSchema"]>["Type"];
          PatchWire: NonNullable<S["cells"][K]["patchSchema"]>["Encoded"];
        };
      }
    : EmptyObj;
  collections: S["collections"] extends Record<
    string,
    CollectionSpec<any, any, any>
  >
    ? {
        [K in keyof S["collections"] & string]: {
          Key: S["collections"][K]["keySchema"]["Type"];
          KeyWire: S["collections"][K]["keySchema"]["Encoded"];
          Value: S["collections"][K]["schema"]["Type"];
          ValueWire: S["collections"][K]["schema"]["Encoded"];
        };
      }
    : EmptyObj;
  streams: S["streams"] extends Record<string, StreamSpec<any, any>>
    ? {
        [K in keyof S["streams"] & string]: {
          Input: S["streams"][K]["inputSchema"]["Type"];
          InputWire: S["streams"][K]["inputSchema"]["Encoded"];
          Output: S["streams"][K]["outputSchema"]["Type"];
        };
      }
    : EmptyObj;
  events: S["events"] extends Record<string, EventSpec<any, any>>
    ? {
        [K in keyof S["events"] & string]: {
          Input: S["events"][K]["inputSchema"]["Type"];
          InputWire: S["events"][K]["inputSchema"]["Encoded"];
          Payload: S["events"][K]["outputSchema"]["Type"];
        };
      }
    : EmptyObj;
};

/** Drizzle-style flat helpers — secondary to `SurfaceTypes<S>` indexed
 *  access. Same result, one fewer indexing layer at the call site:
 *
 *      type Prefs = SurfaceCellValue<typeof surface.spec, "preferences">;
 *      type Note  = SurfaceCollectionValue<typeof surface.spec, "notes">;
 *
 *  Use whichever reads better at the call site; both are typo-safe. They project
 *  the DECODED side only — the encoded `*Wire` twins are read through the indexed
 *  form, since the client face (their one consumer) already walks `SurfaceTypes`
 *  per member. */
export type SurfaceCellValue<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["cells"] & string,
> = SurfaceTypes<S>["cells"][K] extends { Value: infer V } ? V : never;

export type SurfaceCellPatch<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["cells"] & string,
> = SurfaceTypes<S>["cells"][K] extends { Patch: infer P } ? P : never;

export type SurfaceCollectionKey<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["collections"] & string,
> = SurfaceTypes<S>["collections"][K] extends { Key: infer T } ? T : never;

export type SurfaceCollectionValue<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["collections"] & string,
> = SurfaceTypes<S>["collections"][K] extends { Value: infer T } ? T : never;

export type SurfaceStreamInput<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["streams"] & string,
> = SurfaceTypes<S>["streams"][K] extends { Input: infer I } ? I : never;

export type SurfaceStreamOutput<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["streams"] & string,
> = SurfaceTypes<S>["streams"][K] extends { Output: infer O } ? O : never;

export type SurfaceEventInput<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["events"] & string,
> = SurfaceTypes<S>["events"][K] extends { Input: infer I } ? I : never;

export type SurfaceEventPayload<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["events"] & string,
> = SurfaceTypes<S>["events"][K] extends { Payload: infer P } ? P : never;

/** The typed `$` SIBLING-READ face handed to a compute-fn `derived.cell` /
 *  `derived.collection` — a plain mapped type over the spec (no `keyof` union
 *  explosion), so `$.someCell()` reads a sibling cell's value and
 *  `$.someCollection()` reads a sibling collection's live map. Reading is
 *  depending: the reactor tracks each `$.<sibling>()` read as a graph edge, so a
 *  derivation recomputes exactly when a sibling it read changed. A derived
 *  sibling reads as its own computed value (never a half-updated mirror) — every
 *  derivation chain stays a pure computed graph, glitch-free by the engine's lazy
 *  pull, even across a diamond. Declaration order is irrelevant: the boot walk
 *  builds every derived node before it seeds any, so a `derived.cell` may read a
 *  sibling `derived.cell` via `$` whether declared before or after it — only a
 *  genuine cycle fails.
 *
 *  Cells and collections share the one flat `$` namespace; a name declared as
 *  both would intersect their two accessor signatures — which `defineSurface`
 *  rejects at definition, so the intersection is unreachable.
 *
 *  Reads are always the DECODED side: the reactor works in domain values, never
 *  in wire shapes. */
export type SiblingRead<S extends SurfaceSpec> = {
  [K in keyof NonNullable<S["cells"]> & string]: () => NonNullable<
    S["cells"]
  >[K]["schema"]["Type"];
} & {
  [K in keyof NonNullable<S["collections"]> & string]: () => ReadonlyMap<
    NonNullable<S["collections"]>[K]["keySchema"]["Type"],
    NonNullable<S["collections"]>[K]["schema"]["Type"]
  >;
};

// ── Surface value ──────────────────────────────────────────────────────

/** Descriptor handles produced by the surface, keyed by surface path. */
export interface SurfaceDescriptors<S extends SurfaceSpec> {
  cells: {
    [K in keyof S["cells"] & string]: S["cells"][K] extends CellSpec<
      infer T,
      infer _P,
      any
    >
      ? Cell<K, T>
      : never;
  };
  collections: {
    [K in keyof S["collections"] &
      string]: S["collections"][K] extends CollectionSpec<
      infer K2,
      infer T,
      any
    >
      ? Collection<K, K2, T>
      : never;
  };
  streams: {
    [K in keyof S["streams"] & string]: S["streams"][K] extends StreamSpec<
      infer I,
      infer T
    >
      ? Stream<K, I, T>
      : never;
  };
  events: {
    [K in keyof S["events"] & string]: S["events"][K] extends EventSpec<
      infer I,
      infer T
    >
      ? Event<K, I, T>
      : never;
  };
}

export interface Surface<S extends SurfaceSpec = SurfaceSpec> {
  /** The flat `RpcGroup` this surface serves — one `Rpc` per member verb, tagged
   *  `<tagPrefix><member>/<verb>`, plus the three reserved `system/*` members.
   *
   *  Deliberately typed with the ERASED `Rpc.Any` element. The group is assembled
   *  from a RUNTIME spec walk, so `RpcGroup`'s invariant type parameter carries no
   *  information a caller could trust — and materialising the precise union here
   *  would push every consumer through the same TS2590-prone instantiation the
   *  spec-derived face (D2) exists to avoid. Per-member precision lives in
   *  {@link SurfaceRpcsFor} / {@link SurfaceTags}, derived from `spec`. */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** The tag prefix every member of `group` carries — `"surface/"` for a
   *  standalone surface, `"surface/<key>/"` for a sibling inside a
   *  {@link composeSurfaceContracts} bundle. Carried on the value (not assumed by
   *  callers) so a scoped sibling and a standalone surface are the same shape. */
  readonly tagPrefix: string;
  readonly spec: S;
  readonly descriptors: SurfaceDescriptors<S>;
}

/** The shared spec walk behind {@link defineSurface} and
 *  {@link composeSurfaceContracts}. One walk, parameterised by tag prefix, so a
 *  sibling's tags and a standalone surface's tags can never be derived by two
 *  different rules. */
function buildSurface(
  spec: SurfaceSpec,
  tagPrefix: string,
): Surface<SurfaceSpec> {
  // The flat tag map IS the collision detector. `RpcGroup.make` is a plain
  // `Map.set` with zero collision detection (last writer wins), so the walk
  // claims every tag here and throws on a duplicate — the same fail-at-boot
  // guarantee the oRPC-era contract walk gave, carried forward by hand.
  const byTag = new Map<string, Rpc.Any>();
  const claim = (member: string, entries: Record<string, Rpc.Any>): void => {
    for (const [verb, rpc] of Object.entries(entries)) {
      if (byTag.has(rpc._tag)) {
        throw new Error(
          `defineSurface: duplicate verb "${verb}" claimed at "${member}" (wire tag "${rpc._tag}"). ` +
            `Multiple primitives or procedures resolve to the same wire tag.`,
        );
      }
      byTag.set(rpc._tag, rpc);
    }
  };

  for (const [key, s] of Object.entries(spec.cells ?? {})) {
    assertTagSegment("cell", key);
    claim(key, cellRpcEntries(tagPrefix + key, s));
  }
  for (const [key, s] of Object.entries(spec.collections ?? {})) {
    assertTagSegment("collection", key);
    claim(key, collectionRpcEntries(tagPrefix + key, s));
  }
  // The `$` sibling-read face is one FLAT namespace over cells AND collections, so
  // a name that is BOTH is ambiguous — `$.<name>()`'s two accessors intersect to
  // the cell arm while the runtime would return the collection map. That is a
  // static property of the spec, so reject it HERE, at definition, for every
  // consumer (a group-only client as much as a server), not just when a server
  // implements the surface. (`Object.hasOwn`, so a member legitimately named
  // `toString`/`constructor` isn't mistaken for an inherited key.)
  const collectionsSpec = spec.collections ?? {};
  for (const key of Object.keys(spec.cells ?? {})) {
    if (Object.hasOwn(collectionsSpec, key)) {
      throw new Error(
        `defineSurface: "${key}" is declared as BOTH a cell and a collection — member names must be disjoint (the $ sibling-read face is one flat namespace, and the two accessors would collide).`,
      );
    }
  }
  for (const [key, s] of Object.entries(spec.streams ?? {})) {
    assertTagSegment("stream", key);
    claim(key, streamRpcEntries(tagPrefix + key, s));
  }
  for (const [key, s] of Object.entries(spec.events ?? {})) {
    assertTagSegment("event", key);
    claim(key, eventRpcEntries(tagPrefix + key, s));
  }
  for (const [ns, procs] of Object.entries(spec.procedures ?? {})) {
    assertTagSegment("procedure namespace", ns);
    const procEntries: Record<string, Rpc.Any> = {};
    for (const [verb, ps] of Object.entries(procs)) {
      assertTagSegment("procedure verb", verb);
      procEntries[verb] = procedureRpcEntry(
        surfaceTag(tagPrefix, ns, verb),
        ps,
      );
    }
    claim(ns, procEntries);
  }
  // Reserve the three framework members on EVERY surface (see ./liveness,
  // ./identity, ./clockNow). They are group-only (never in `spec`, so
  // `implementSurface`'s procedures walk never demands a dep for one — they are
  // auto-answered instead) and share ONE `system` namespace. `claim` rejects only
  // a duplicate TAG, so reserving them merges into an app-owned `system`
  // namespace and can't silently clobber an app procedure — while an app that
  // does declare `system.live` gets a loud boot-time collision, the correct
  // behaviour for a reserved verb.
  claim(LIVENESS_NAMESPACE, {
    [LIVENESS_VERB]: buildLivenessRpc(
      surfaceTag(tagPrefix, LIVENESS_NAMESPACE, LIVENESS_VERB),
    ),
  });
  claim(IDENTITY_NAMESPACE, {
    [IDENTITY_VERB]: buildIdentityRpc(
      surfaceTag(tagPrefix, IDENTITY_NAMESPACE, IDENTITY_VERB),
    ),
  });
  claim(CLOCK_NOW_NAMESPACE, {
    [CLOCK_NOW_VERB]: buildClockNowRpc(
      surfaceTag(tagPrefix, CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB),
    ),
  });

  // Descriptor handles for the manual escape hatch.
  const descriptors = {
    cells: {} as Record<string, unknown>,
    collections: {} as Record<string, unknown>,
    streams: {} as Record<string, unknown>,
    events: {} as Record<string, unknown>,
  };
  for (const [key, s] of Object.entries(spec.cells ?? {})) {
    descriptors.cells[key] = cell({
      name: key,
      schema: s.schema,
      default: s.default,
    });
  }
  for (const [key, s] of Object.entries(spec.collections ?? {})) {
    descriptors.collections[key] = collection({
      name: key,
      keySchema: s.keySchema,
      schema: s.schema,
    });
  }
  for (const [key, s] of Object.entries(spec.streams ?? {})) {
    descriptors.streams[key] = stream({
      name: key,
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
    });
  }
  for (const [key, s] of Object.entries(spec.events ?? {})) {
    descriptors.events[key] = event({
      name: key,
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
    });
  }

  return {
    group: assembleGroup(byTag),
    tagPrefix,
    spec,
    descriptors: descriptors as unknown as SurfaceDescriptors<SurfaceSpec>,
  };
}

/** Assemble a group from a claimed tag map and PROVE nothing was dropped.
 *  `RpcGroup.make` is `new Map(rpcs.map(rpc => [rpc._tag, rpc]))` — a colliding
 *  tag is silently overwritten — so every assembly in this file goes through
 *  here, and a size mismatch crashes at boot rather than serving a surface that
 *  is quietly missing a member. */
function assembleGroup(
  byTag: ReadonlyMap<string, Rpc.Any>,
): RpcGroup.RpcGroup<Rpc.Any> {
  const group = RpcGroup.make(...byTag.values());
  if (group.requests.size !== byTag.size) {
    throw new Error(
      `defineSurface: RpcGroup assembly dropped ${byTag.size - group.requests.size} tag(s) — ` +
        `claimed ${byTag.size}, group carries ${group.requests.size}. This is a collision the claim walk failed to catch.`,
    );
  }
  return group;
}

/** Build a surface from a spec. The returned `.group` is a flat `RpcGroup` whose
 *  tags all begin `surface/`; a host merges it with its own hand-written group
 *  for the RPCs the surface can't model:
 *
 *      const hostGroup = surface.group.merge(rawTerminalGroup, rawGitGroup);
 *
 *  Consumers feed the group to `implementSurface` (server) and to the client face
 *  builder (`surfaceClient`). */
export function defineSurface<const S extends SurfaceSpec<never>>(
  spec: S,
): Surface<S> {
  return buildSurface(spec, SURFACE_TAG_PREFIX) as unknown as Surface<S>;
}

/** {@link defineSurface}, but threading an app-owned client error policy union
 *  `TPolicy` through the spec so a member can declare `client: { onError: … }`
 *  (see {@link ClientCellPolicy} / {@link ClientCollectionPolicy}). CURRIED — the
 *  first call pins `TPolicy`, the returned function takes the spec:
 *
 *      type Toast = { kind: "toast"; label: string };
 *      const surface = defineSurfaceWithPolicy<Toast>()({
 *        cells: { preferences: { schema, default, client: { onError: { kind: "toast", label: "Preferences" } } } },
 *      });
 *
 *  The two-step form is load-bearing: it lets the caller name `TPolicy`
 *  EXPLICITLY while the spec argument keeps its `const S` inference (so
 *  `surface.spec` / `SurfaceTypes<typeof surface.spec>` stay precise). A single
 *  `defineSurfaceWithPolicy<TPolicy, S>(spec)` would force the caller to spell
 *  `S` too (losing inference) or drop `TPolicy` (losing the policy typing) — TS
 *  has no per-parameter partial inference. Runtime is identical to
 *  {@link defineSurface}: the policy slot is inert data the framework only threads
 *  to the app's interpreter, never reads here.
 *
 *  A surface built through this reports its `TPolicy` on `SurfaceSpec<TPolicy>`,
 *  which is what lets the per-scope policy typing (F8) hold: a root surface
 *  instantiated with a toast-only union makes an origin-requiring arm
 *  unspellable, and the mandatory `default` makes a local-authority cell without
 *  a seed a type error. Plain `defineSurface` is the `TPolicy = never` case — its
 *  `client` slot is unfillable, so existing callers pay nothing. */
export function defineSurfaceWithPolicy<TPolicy>() {
  return <const S extends SurfaceSpec<TPolicy>>(spec: S): Surface<S> =>
    // Runtime is identical to `defineSurface` — the policy slot is inert data.
    buildSurface(spec, SURFACE_TAG_PREFIX) as unknown as Surface<S>;
}

/** Whether a peer reporting contract version `reportedVersion` is
 *  wire-compatible with a consumer built against `expected` (both
 *  `major.minor` strings). Compatible when the majors match and the reported
 *  minor is >= the expected one — additive minor bumps (a new optional
 *  field / procedure / stream) stay backwards-compatible; a major mismatch
 *  is a breaking shape change. Tolerates a trailing patch/prerelease suffix
 *  on either side (only `major.minor` is load-bearing).
 *
 *  This is the standard handshake predicate for a surface served across a
 *  process boundary (a unix-socket daemon, an ssh agent): the server exposes
 *  its contract version via a `system.version`-style procedure, the client
 *  checks it with this BEFORE invoking anything else, and an incompatible
 *  skew becomes an honest "restart the other side" message instead of an
 *  opaque schema/procedure error from deep inside the RPC layer. */
export function isContractVersionCompatible(
  reportedVersion: string,
  expected: string,
): boolean {
  const parse = (v: string): [number, number] | null => {
    // Anchored so only `major.minor` with an OPTIONAL patch/prerelease suffix
    // parses — `2.1garbage` must be rejected, not silently truncated to 2.1.
    const m = /^(\d+)\.(\d+)(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.exec(v);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = parse(reportedVersion);
  const b = parse(expected);
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] >= b[1];
}

/** A keyed bundle of sibling surfaces served as ONE flat group — the wire-level
 *  counterpart to `implementSurfaces`. */
export interface ComposedSurfaces<E extends Record<string, Surface<any>>> {
  /** Every sibling's members in one flat group, ready to serve or merge into a
   *  host group. */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Per-sibling view — the same {@link Surface} shape as a standalone surface,
   *  but with `tagPrefix` = `surface/<key>/` and a `group` holding only that
   *  sibling's members. This is what lets Stage-2 handler binding and Stage-3
   *  dispatch be keyed BY SIBLING without re-deriving the tag rule: a sibling's
   *  own `group.requests` keys are exactly the tags it owns. */
  readonly siblings: {
    readonly [K in keyof E]: E[K] extends Surface<infer S> ? Surface<S> : never;
  };
}

/** Compose a keyed map of surfaces into ONE flat group whose members are tagged
 *  `surface/<key>/<member>/<verb>`.
 *
 *  Composition is per-sibling tag PREFIXING, never a bare `RpcGroup.merge` (D1).
 *  Every surface carries the same three reserved `system/*` members, so merging
 *  two bare surface groups would collide them — and `merge` is a last-writer-wins
 *  `Map.set`, so the collision would be silent. Each sibling is therefore re-walked
 *  through the SAME {@link buildSurface} with its own prefix, and the assembled
 *  group's size is asserted against the claimed tag count.
 *
 *  Lives in `@kolu/surface/define` (not `/server`) because it only walks each
 *  surface's spec — it has no server-only dependency, so a browser-reached common
 *  module can value-import it. */
export function composeSurfaceContracts<
  const E extends Record<string, Surface<any>>,
>(entries: E): ComposedSurfaces<E> {
  const siblings: Record<string, Surface<SurfaceSpec>> = {};
  const byTag = new Map<string, Rpc.Any>();
  for (const [key, sib] of Object.entries(entries)) {
    assertTagSegment("sibling", key);
    const scoped = buildSurface(sib.spec, siblingTagPrefix(key));
    for (const [tag, rpc] of scoped.group.requests) {
      if (byTag.has(tag)) {
        throw new Error(
          `composeSurfaceContracts: duplicate wire tag "${tag}" while composing sibling "${key}".`,
        );
      }
      byTag.set(tag, rpc);
    }
    // Reuse the sibling's OWN descriptors: they are pure data keyed by member
    // name and carry no tag, so re-deriving them would only mint equal twins.
    siblings[key] = {
      group: scoped.group,
      tagPrefix: scoped.tagPrefix,
      spec: sib.spec,
      descriptors: sib.descriptors,
    };
  }
  return {
    group: assembleGroup(byTag),
    siblings,
  } as unknown as ComposedSurfaces<E>;
}
