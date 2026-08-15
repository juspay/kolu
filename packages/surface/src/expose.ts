/**
 * Per-face `expose` — the default-deny allowlist ONE serving face applies to a
 * served surface, and the ONE reading of a map every face shares.
 *
 * A surface is served by more than one face at a time (a browser websocket, a
 * unix socket, an MCP adapter), and those faces do not carry the same trust. A
 * local CLI on a `0700` socket is not an anonymous tab someone left open. Until
 * this module existed only the MCP face was gated, so a verb was reachable to
 * EVERY face or to none, and an app that wanted its writes on the surface had
 * to keep a second, hand-rolled path beside it (juspay/kolu#2169).
 *
 * ## Three steps, and the middle one is the point
 *
 *   1. **{@link classifyExpose}** — spec + map → what each key NAMES. The one
 *      authority on the key grammar, shared by every face.
 *   2. **{@link exposeFace} / {@link exposeFaces}** — surface + map →
 *      {@link FaceExposure}, the concrete set of wire tags this face serves.
 *      Parse, don't validate: a face is handed a checked VALUE, never a map it
 *      has to re-interpret.
 *   3. **{@link restrictHandlers}** — group + handlers + exposure → the handler
 *      record that face serves.
 *
 * `@kolu/surface-mcp` enters at step 1 and does its own step 2 (a map entry
 * there resolves to a `surface://` URI or an MCP tool name, which is adapter
 * vocabulary). That split is load-bearing: the first version of this module
 * classified keys by walking the GROUP instead — inferring "primitive" from the
 * presence of a streaming verb — and the two faces then read the same map by
 * two different grammars. A surface with a cell `nodes` and a procedure
 * namespace `nodes` (both legal — `defineSurface`'s `claim` rejects only a
 * duplicate TAG) made `"nodes.refresh"` an MCP tool and a boot crash on the
 * wire, and a member name containing a `.` was ambiguous between two members.
 * One classifier is what makes "the same key means the same thing on both
 * faces" true rather than aspirational.
 *
 * ## Why the face takes a `Surface`, not just a map
 *
 * A wire face holds `{ group, handlers }` and never the spec, so `expose` is
 * bound to its surface where the surface is in scope — at the composition root,
 * which already has it. That is what buys the shared grammar above AND the
 * compile-time key check: `exposeFace(surface, { … })` infers `S`, so a typo is
 * a type error rather than a boot crash. The bound value CARRIES the origin it
 * was built from ({@link FaceExposure}'s `universe`), and
 * {@link restrictHandlers} compares that with the group it is asked to gate —
 * so "this policy describes this surface" is proven from a fact, not inferred
 * from the shape of the answer.
 *
 * ## A denied member ANSWERS — it does not vanish
 *
 * The restricted record keeps every tag and replaces the denied ones. Dropping
 * them is not an option: `group.toLayer(handlers)` is total over the group, and
 * a face that served a hole would answer a denied call with the transport's own
 * "no such method" — indistinguishable from a version skew. A denial is a
 * per-request {@link SurfaceMemberNotExposed} defect, so exactly the caller that
 * asked hears it (`surfaceRpcServerLayer` runs with `disableFatalDefects`, so
 * one member's refusal never touches a sibling subscription on the same
 * connection).
 *
 * It is a DEFECT and not a typed failure because it cannot be a typed failure: a
 * primitive's `Rpc` declares no error channel at all and a procedure's defaults
 * to `Schema.Never`, so there is no declared arm for the framework to fail into.
 * Refusing loudly on the channel that exists beats minting an error arm on every
 * member of every surface for a case most faces never reach.
 *
 * ## `"resource"` is the READ face
 *
 * The MCP adapter maps a primitive to a resource — a thing you read — and a
 * procedure to a tool — a thing you call. A wire face reads the same map the
 * same way: `"resource"` grants the read verbs a member actually declares
 * ({@link READ_VERBS}) and withholds the rest (`set`, `patch`, `upsert`,
 * `delete`, `test__set`). That is the whole point on the untrusted face — the
 * tab reads the cell, the socket writes it.
 *
 * A member that must be *writable* on a gated face has no spelling today. That
 * is a deliberate gap: it wants a shape (`{ resource: { writes: true } }`)
 * proposed on both faces at once, not back-doored in as a knob here.
 *
 * ## Which faces take one — THE authority on this rule
 *
 * `serveSurfaceApp` (`@kolu/surface-app/serve`) and `serveOverUnixSocket`
 * (`@kolu/surface/unix-socket`) take `expose` directly, and apply it once at
 * bind. A HAND-BUILT serve path — `serveSurfaceSocket` under drishti's per-host
 * dispatch, `serveOverStdio` — restricts its own handlers with
 * {@link restrictHandlers} and serves the result; there is nothing else to it,
 * and that is why the filter is exported. Nothing enforces this split, so it is
 * stated HERE and only here: every other home for it (those faces' docblocks,
 * the reference page, the skill) points back rather than restating, because
 * four independently-worded copies of one rule are four places it can go stale.
 *
 * `serveSurfaceAsMcp` (`@kolu/surface-mcp`) takes the MAP itself, not a
 * {@link FaceExposure}: a tag set is lossy for it, since it needs the member
 * kind and `mutates` to resolve URIs and tool names. Same map, same grammar,
 * different step 2.
 */

import { Data, Effect, Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcSchema } from "effect/unstable/rpc";
import {
  READ_VERBS,
  reservedSurfaceTags,
  scopeSiblingTag,
  siblingTagPrefix,
  SURFACE_TAG_PREFIX,
  type Surface,
  type SurfaceSpec,
  surfaceTag,
} from "./define";
import type { SurfaceHandler, SurfaceHandlers } from "./server";

// ── Expose map types ────────────────────────────────────────────────────

/** `"<ns>.<verb>"` for every declared procedure — the legal tool keys. */
type ProcedureName<S extends SurfaceSpec> =
  S["procedures"] extends Record<string, Record<string, unknown>>
    ? {
        [N in keyof S["procedures"] &
          string]: `${N}.${keyof S["procedures"][N] & string}`;
      }[keyof S["procedures"] & string]
    : never;

/** Cell / Stream / Event keys — the singleton resource-shaped primitives. */
type ResourceCellName<S extends SurfaceSpec> =
  | (S["cells"] extends Record<string, unknown>
      ? keyof S["cells"] & string
      : never)
  | (S["streams"] extends Record<string, unknown>
      ? keyof S["streams"] & string
      : never)
  | (S["events"] extends Record<string, unknown>
      ? keyof S["events"] & string
      : never);

/** Collection keys — the keyed resource primitives (list + template). */
type CollectionName<S extends SurfaceSpec> =
  S["collections"] extends Record<string, unknown>
    ? keyof S["collections"] & string
    : never;

/** How a procedure is exposed.
 *
 *  The FRAMEWORK half is membership, and it is all a wire face reads: a
 *  procedure the map names is callable on that face, whatever the value says.
 *  Nothing below this line is interpreted by `@kolu/surface`.
 *
 *  The MCP half is `mutates`, a presentation HINT for a host — the write
 *  capability it surfaces as `readOnlyHint`/`destructiveHint`. It defaults
 *  CONSERVATIVELY in `@kolu/surface-mcp`: both the bare `"tool"` shorthand and
 *  `{ tool: {} }` (no explicit flag) are treated as MUTATING, so an unannotated
 *  procedure is never advertised as auto-approvable read-only. Mark a genuinely
 *  read-only procedure with `{ tool: { mutates: false } }`. It describes how a
 *  host should PRESENT a call, never whether a face may make it. */
export type ToolExposure = "tool" | { tool: { mutates?: boolean } };

/** The default-deny allowlist. Keys are the spec's own primitives and
 *  procedures; omission means *not exposed*. A primitive maps to `"resource"`;
 *  a procedure to a `ToolExposure`.
 *
 *  Typed against `S`, with NO string index: write the map where `S` is
 *  inferable — `exposeFace(surface, { … })`, `serveSurfaceAsMcp({ surface,
 *  expose })`, `satisfies ExposeMap<MySpec>` — and a typo'd key is a type
 *  error rather than a boot crash. A loosening index signature would take that
 *  away on exactly the paths that have it (excess-property checking never fires
 *  when every string key is assignable) and buy nothing on the paths that
 *  don't: an erased `ExposeMap<SurfaceSpec>` already collapses to `{}` and
 *  accepts any key. {@link classifyExpose}'s boot check is what covers THAT
 *  path — the type check and the runtime check answer for different call
 *  shapes, and neither replaces the other. */
export type ExposeMap<S extends SurfaceSpec = SurfaceSpec> = {
  [K in ProcedureName<S>]?: ToolExposure;
} & {
  [K in ResourceCellName<S> | CollectionName<S>]?: "resource";
};

// ── Step 1: what a key NAMES ────────────────────────────────────────────

/** An `expose` map that does not describe its surface. A CLASS, not a bare
 *  `Error`, because every face refuses at boot in its own vocabulary — the MCP
 *  adapter says which door the consumer came through — and a face that wants to
 *  recognise this refusal must not have to match on message text. `face` is
 *  that label, carried as a field rather than spliced into `detail` by a
 *  rewrite, so the framework's words and the face's brand stay separable. */
export class ExposeMapError extends Data.TaggedError("ExposeMapError")<{
  readonly detail: string;
  readonly face?: string;
}> {
  override get message(): string {
    return this.face === undefined
      ? this.detail
      : `${this.face}: ${this.detail}`;
  }
}

/** A spec's own member types, at the erasure `SurfaceSpec` declares them with.
 *  Read off `SurfaceSpec` rather than restated from `CellSpec<…>` & co, so an
 *  entry carries exactly the value the spec holds and no second spelling of the
 *  member shapes can drift from the first. */
type SpecCell = NonNullable<NonNullable<SurfaceSpec["cells"]>[string]>;
type SpecCollection = NonNullable<
  NonNullable<SurfaceSpec["collections"]>[string]
>;
type SpecStream = NonNullable<NonNullable<SurfaceSpec["streams"]>[string]>;
type SpecEvent = NonNullable<NonNullable<SurfaceSpec["events"]>[string]>;
type SpecProcedure = NonNullable<
  NonNullable<NonNullable<SurfaceSpec["procedures"]>[string]>[string]
>;

/** One classified `expose` entry — what the key named, resolved against the
 *  spec, WITH the member spec the lookup found.
 *
 *  Carrying the value is the point: the classifier already proved the member
 *  exists, so handing a face a bare key would make it redeem that key by
 *  re-running the lookup — through casts, in another package, on a path where a
 *  disagreement between the two lookups would be invisible. Every arm also
 *  carries the author's written `exposure` verbatim; a face interprets the part
 *  it understands (a wire face: membership only) and ignores the rest. */
export type ExposeEntry =
  | {
      readonly kind: "procedure";
      readonly ns: string;
      readonly verb: string;
      readonly exposure: ToolExposure;
      readonly spec: SpecProcedure;
    }
  | {
      readonly kind: "cell";
      readonly key: string;
      readonly exposure: "resource";
      readonly spec: SpecCell;
    }
  | {
      readonly kind: "collection";
      readonly key: string;
      readonly exposure: "resource";
      readonly spec: SpecCollection;
    }
  | {
      readonly kind: "stream" | "event";
      readonly key: string;
      readonly exposure: "resource";
      readonly spec: SpecStream | SpecEvent;
    };

/** Walk a spec + expose map and say what each key names. THE authority on the
 *  key grammar, so every face reads one map one way:
 *
 *    - a key with a `.` names a procedure, `<ns>.<verb>`, split at the FIRST
 *      dot (a namespace and a verb are single tag segments, so no later dot can
 *      belong to the split);
 *    - any other key names a primitive by its surface key.
 *
 *  Every key is checked against the live spec — a key that names no
 *  primitive/procedure is a boot-time error, not a silent no-op — as is the
 *  KIND of exposure, so a procedure exposed as a resource and a primitive
 *  exposed as a tool are both refusals rather than surprises. */
export function classifyExpose<S extends SurfaceSpec>(
  spec: S,
  expose: ExposeMap<S>,
): ExposeEntry[] {
  const cells = spec.cells ?? {};
  const collections = spec.collections ?? {};
  const streams = spec.streams ?? {};
  const events = spec.events ?? {};
  const procedures = spec.procedures ?? {};

  const entries: ExposeEntry[] = [];
  for (const [key, exposure] of Object.entries(
    expose as Record<string, ToolExposure | "resource" | undefined>,
  )) {
    if (exposure === undefined) continue;

    const dot = key.indexOf(".");
    if (dot !== -1) {
      const ns = key.slice(0, dot);
      const verb = key.slice(dot + 1);
      const procSpec = procedures[ns]?.[verb];
      if (procSpec === undefined) {
        throw new ExposeMapError({
          detail: `expose names procedure "${key}" but the spec has no such procedure`,
        });
      }
      if (exposure === "resource") {
        throw new ExposeMapError({
          detail: `procedure "${key}" is exposed as "resource"; procedures map to tools`,
        });
      }
      entries.push({ kind: "procedure", ns, verb, exposure, spec: procSpec });
      continue;
    }

    if (exposure !== "resource") {
      throw new ExposeMapError({
        detail: `primitive "${key}" must be exposed as "resource", not a tool`,
      });
    }
    const cellSpec = cells[key];
    const collectionSpec = collections[key];
    const streamSpec = streams[key];
    const eventSpec = events[key];
    if (cellSpec !== undefined) {
      entries.push({ kind: "cell", key, exposure, spec: cellSpec });
    } else if (collectionSpec !== undefined) {
      entries.push({ kind: "collection", key, exposure, spec: collectionSpec });
    } else if (streamSpec !== undefined) {
      entries.push({ kind: "stream", key, exposure, spec: streamSpec });
    } else if (eventSpec !== undefined) {
      entries.push({ kind: "event", key, exposure, spec: eventSpec });
    } else {
      throw new ExposeMapError({
        detail: `expose names "${key}" but the spec has no such cell/collection/stream/event`,
      });
    }
  }
  return entries;
}

// ── Step 2: the tags one face serves ────────────────────────────────────

/** One face's resolved allowlist. A checked VALUE — built where the surface is
 *  in scope, applied where only the group is.
 *
 *  It is what a WIRE face needs, and only a wire face takes one today: the tag
 *  set is lossy for the MCP adapter, which resolves the same classified entries
 *  into `surface://` URIs and tool names instead. */
export interface FaceExposure {
  /** Every tag the surface(s) this exposure was built FROM advertise — the
   *  exposure's ORIGIN, carried rather than inferred. {@link restrictHandlers}
   *  compares it with the served group's own tags, so "this exposure describes
   *  this surface" is a fact the value states and not a rule the reader
   *  reconstructs by set arithmetic (which cannot tell a partial bundle, or an
   *  empty map against the wrong surface, from a correct one). */
  readonly universe: ReadonlySet<string>;
  /** The wire tags this face serves, reserved members included. */
  readonly tags: ReadonlySet<string>;
}

/** Every wire tag one classified entry stands for, emitted under `emitPrefix`.
 *  Membership is asked of the GROUP — not re-derived from the spec — so a
 *  granted tag is one the surface provably serves and the verb rules stay in
 *  `define.ts` where they are minted. A `"resource"` grant offers every read
 *  verb and keeps the ones this member actually declares, which is why a cell
 *  that declares only `get` grants only `get` and a collection without `deltas`
 *  never gets one. */
function grantedTags(
  surface: Surface<SurfaceSpec>,
  emitPrefix: string,
  entry: ExposeEntry,
  into: Set<string>,
): void {
  const add = (member: string, verb: string): void => {
    if (surface.group.requests.has(surfaceTag(surface.tagPrefix, member, verb)))
      into.add(surfaceTag(emitPrefix, member, verb));
  };
  if (entry.kind === "procedure") {
    add(entry.ns, entry.verb);
    return;
  }
  for (const verb of READ_VERBS) add(entry.key, verb);
}

/** Bind ONE map to ONE surface, emitting that surface's tags under
 *  `emitPrefix`. The single operation behind both constructors below: a
 *  standalone face emits at the surface's own prefix, a sibling emits at its
 *  bundle prefix, and nothing else differs. */
function tagsAt(
  surface: Surface<SurfaceSpec>,
  emitPrefix: string,
  map: ExposeMap<SurfaceSpec>,
  into: Set<string>,
): void {
  // The framework-reserved members are ALWAYS reachable on a gated face and are
  // not spellable in a map (they live only in the group, never in `spec`, so
  // `classifyExpose` rejects them like any other unknown key) — see
  // `reservedSurfaceTags` for why gating them off would break the link rather
  // than restrict the face.
  for (const tag of reservedSurfaceTags(emitPrefix)) into.add(tag);
  for (const entry of classifyExpose(surface.spec, map)) {
    grantedTags(surface, emitPrefix, entry, into);
  }
}

/** Bind an `expose` map to the surface it describes — the step that turns a
 *  record of strings into the tag set a face serves, and the step that gives
 *  the map its compile-time key check (`S` is inferred from `surface`).
 *
 *  For a STANDALONE surface (`implementSurface`). Its sibling-bundle twin is
 *  {@link exposeFaces} — a distinct constructor rather than a mode flag, the
 *  same way `implementSurface` and `implementSurfaces` are. */
export function exposeFace<S extends SurfaceSpec>(
  surface: Surface<S>,
  expose: ExposeMap<S>,
): FaceExposure {
  const tags = new Set<string>();
  // The prefix is read OFF THE VALUE, never assumed: `Surface.tagPrefix` is
  // carried precisely so a scoped sibling and a standalone surface are the same
  // shape here.
  tagsAt(surface as Surface<SurfaceSpec>, surface.tagPrefix, expose, tags);
  return { universe: new Set(surface.group.requests.keys()), tags };
}

/** {@link exposeFace} for a sibling bundle (`implementSurfaces`): one map per
 *  sibling, keyed the way the bundle is. Takes the STANDALONE sibling surfaces
 *  the bundle was composed from — the same values `implementSurfaces` is given.
 *
 *  Per SIBLING rather than one map with dotted sibling paths, because a
 *  sibling's map is written against that sibling's own spec — which is what
 *  keeps `S` inferable, and what stops `"a.b"` meaning two things depending on
 *  whether `a` is a namespace or a sibling. A sibling with no map is fully
 *  denied: default-deny is the whole contract, and an omitted map is an
 *  omission. */
export function exposeFaces<M extends Record<string, Surface<SurfaceSpec>>>(
  surfaces: M,
  expose: { [K in keyof M]?: ExposeMap<M[K]["spec"]> },
): FaceExposure {
  const tags = new Set<string>();
  const universe = new Set<string>();
  for (const [key, sibling] of Object.entries(surfaces)) {
    if (sibling.tagPrefix !== SURFACE_TAG_PREFIX) {
      throw new ExposeMapError({
        detail: `exposeFaces: sibling "${key}" is already scoped (its tagPrefix is "${sibling.tagPrefix}"). Pass the STANDALONE surfaces the bundle was composed from — an already-scoped sibling would be re-prefixed here and gate a set of tags no surface serves.`,
      });
    }
    for (const tag of sibling.group.requests.keys()) {
      universe.add(scopeSiblingTag(tag, key));
    }
    tagsAt(sibling, siblingTagPrefix(key), expose[key] ?? {}, tags);
  }
  return { universe, tags };
}

// ── Step 3: the refusal, and applying it ────────────────────────────────

/** A member this face does not expose was called. Raised as a DEFECT (see the
 *  module header for why it cannot be a typed failure), per request, so only the
 *  caller that asked hears it.
 *
 *  Carries the FULL wire tag rather than the expose key: the expose key is a
 *  thing the *server author* wrote, and the tag is the thing the *caller* asked
 *  for — a refusal is read by whoever made the call. */
export class SurfaceMemberNotExposed extends Data.TaggedError(
  "SurfaceMemberNotExposed",
)<{
  readonly tag: string;
}> {
  override get message(): string {
    return `surface: "${this.tag}" is not exposed on this face`;
  }
}

/** A handler that refuses, in the shape its member's `Rpc` promises. A caller
 *  subscribing to a streaming member gets a stream that dies rather than a value
 *  the protocol cannot run — which is why this needs the group, and not just the
 *  handler record. */
function refuse(tag: string, streaming: boolean): SurfaceHandler {
  const refusal = new SurfaceMemberNotExposed({ tag });
  return streaming ? () => Stream.die(refusal) : () => Effect.die(refusal);
}

/** Apply one face's {@link FaceExposure} to a served surface's handlers,
 *  returning the record that face should serve: every exposed member's real
 *  handler, and a refusing handler at every other tag.
 *
 *  TOTAL over "no declared policy": an `undefined` exposure returns `handlers`
 *  unchanged, so the "omit `expose` and the face serves the whole surface" rule
 *  has ONE implementation and a face cannot get the default wrong. It applies
 *  ONCE, at bind, not per connection — the allowlist is a property of the
 *  LISTENER (of who can reach it), so every connection serves the identical
 *  record and a mismatched exposure crashes at construction rather than behind
 *  whoever connects first.
 *
 *  The two wire faces call this for you (`serveSurfaceApp`,
 *  `serveOverUnixSocket`); a hand-built serve path calls it itself and serves
 *  the result.
 *
 *  It also PROVES the exposure describes this group, by comparing the origin
 *  the exposure CARRIES with the tags the group serves. An exposure built from
 *  a different — or merely PARTIAL — surface would otherwise gate silently and
 *  completely, which is the failure a default-deny gate is uniquely good at
 *  hiding (everything is denied and the face still serves, so nothing looks
 *  broken until a caller needs the verb). Set equality, not "no stray tag":
 *  `exposeFace(otherSurface, {})` names only the reserved members, which EVERY
 *  surface carries, so a one-directional check reads it as fine — and a bundle
 *  exposed with one sibling missing would silently deny that whole sibling,
 *  its `system/live` heartbeat included. */
export function restrictHandlers(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  handlers: SurfaceHandlers,
  exposure: FaceExposure | undefined,
): SurfaceHandlers {
  if (exposure === undefined) return handlers;
  const served = group.requests;
  const missing = [...exposure.universe].filter((tag) => !served.has(tag));
  const undescribed = [...served.keys()].filter(
    (tag) => !exposure.universe.has(tag),
  );
  if (missing.length > 0 || undescribed.length > 0) {
    throw new Error(
      `restrictHandlers: this exposure was built from a different surface than the group being served` +
        (missing.length > 0
          ? ` — it describes ${missing.length} tag(s) this surface does not serve [${missing.sort().join(", ")}]`
          : "") +
        (undescribed.length > 0
          ? ` — this surface serves ${undescribed.length} tag(s) the exposure describes nothing about [${undescribed.sort().join(", ")}], which would be denied with nothing to say so`
          : "") +
        `.`,
    );
  }
  // Null prototype, for the same reason `implementSurface`'s record has one: a
  // member legitimately named `toString` must not collide with an inherited
  // property.
  const restricted = Object.create(null) as SurfaceHandlers;
  for (const [tag, rpc] of group.requests) {
    const handler = handlers[tag];
    if (handler === undefined) {
      throw new Error(
        `restrictHandlers: nothing is bound at "${tag}", which this surface's group advertises. Restrict the handler record implementSurface returned, not one assembled by hand.`,
      );
    }
    restricted[tag] = exposure.tags.has(tag)
      ? handler
      : // `Rpc.Any` narrows away the schema fields the whole union carries;
        // `AnyWithProps` is Effect's own name for reading them off an erased
        // `Rpc`, which is exactly what a tag-keyed walk has to do.
        refuse(
          tag,
          RpcSchema.isStreamSchema((rpc as Rpc.AnyWithProps).successSchema),
        );
  }
  return restricted;
}
