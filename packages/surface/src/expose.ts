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
 * a type error rather than a boot crash. {@link restrictHandlers} then proves
 * the exposure was built from the same surface the group came from.
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
 * ## Which faces take one
 *
 * `serveSurfaceApp` (`@kolu/surface-app/serve`) and `serveOverUnixSocket`
 * (`@kolu/surface/unix-socket`) take `expose` directly. A HAND-BUILT serve path
 * — `serveSurfaceSocket` under drishti's per-host dispatch, `serveOverStdio` —
 * restricts its own handlers with {@link restrictHandlers} and serves the
 * result; there is nothing else to it, and that is why the filter is exported.
 */

import { Data, Effect, Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcSchema } from "effect/unstable/rpc";
import { CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB } from "./clockNow";
import {
  type CellSpec,
  type CellVerb,
  type CollectionSpec,
  type CollectionVerb,
  resolveCellVerbs,
  resolveCollectionVerbs,
  siblingTagPrefix,
  type Surface,
  type SurfaceSpec,
  surfaceTag,
} from "./define";
import { IDENTITY_NAMESPACE, IDENTITY_VERB } from "./identity";
import { LIVENESS_NAMESPACE, LIVENESS_VERB } from "./liveness";
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

/** How a procedure is exposed. On the MCP face `mutates` is the authz bit the
 *  host surfaces as a write capability (`readOnlyHint`/`destructiveHint`) and
 *  defaults CONSERVATIVELY: both the bare `"tool"` shorthand and `{ tool: {} }`
 *  (no explicit flag) are treated as MUTATING, so an unannotated procedure is
 *  never advertised as auto-approvable read-only. Mark a genuinely read-only
 *  procedure with `{ tool: { mutates: false } }`.
 *
 *  A WIRE face reads only the membership: a procedure the map names is callable
 *  there whatever `mutates` says, because `mutates` describes how a host should
 *  PRESENT a call, not whether this face may make it. */
export type ToolExposure = "tool" | { tool: { mutates?: boolean } };

/** The default-deny allowlist. Keys are the spec's own primitives and
 *  procedures; omission means *not exposed*. A primitive maps to `"resource"`;
 *  a procedure to a `ToolExposure`.
 *
 *  Typed against `S` where the compiler can narrow, with a `string` index so a
 *  key the mapped types can't enumerate (a heavily-composed spec) still
 *  type-checks and is caught by {@link classifyExpose} at boot. Write the map
 *  where `S` is inferable — `exposeFace(surface, { … })`,
 *  `serveSurfaceAsMcp({ surface, expose })` — and the mapped halves do their
 *  job; annotate a bare `ExposeMap` and only the boot check remains. */
export type ExposeMap<S extends SurfaceSpec = SurfaceSpec> = {
  [K in ProcedureName<S>]?: ToolExposure;
} & {
  [K in ResourceCellName<S> | CollectionName<S>]?: "resource";
} & {
  [key: string]: ToolExposure | "resource" | undefined;
};

// ── Step 1: what a key NAMES ────────────────────────────────────────────

/** One classified `expose` entry — what the key named, resolved against the
 *  spec. A procedure carries its `exposure` because the MCP face reads
 *  `mutates` off it; a primitive carries only its kind and key, because that is
 *  all either face needs. */
export type ExposeEntry =
  | {
      readonly kind: "procedure";
      readonly ns: string;
      readonly verb: string;
      readonly exposure: ToolExposure;
    }
  | {
      readonly kind: "cell" | "collection" | "stream" | "event";
      readonly key: string;
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
      if (procedures[ns]?.[verb] === undefined) {
        throw new Error(
          `expose names procedure "${key}" but the spec has no such procedure`,
        );
      }
      if (exposure === "resource") {
        throw new Error(
          `procedure "${key}" is exposed as "resource"; procedures map to tools`,
        );
      }
      entries.push({ kind: "procedure", ns, verb, exposure });
      continue;
    }

    if (exposure !== "resource") {
      throw new Error(
        `primitive "${key}" must be exposed as "resource", not a tool`,
      );
    }
    if (key in cells) entries.push({ kind: "cell", key });
    else if (key in collections) entries.push({ kind: "collection", key });
    else if (key in streams) entries.push({ kind: "stream", key });
    else if (key in events) entries.push({ kind: "event", key });
    else {
      throw new Error(
        `expose names "${key}" but the spec has no such cell/collection/stream/event`,
      );
    }
  }
  return entries;
}

// ── Step 2: the tags one face serves ────────────────────────────────────

/** The verbs a `"resource"` exposure grants — the read face of every primitive
 *  kind at once (a cell's / stream's / event's `get`, a collection's `keys` /
 *  `get` / `deltas`). Intersected with the verbs the member actually declares,
 *  so a cell that declares only `get` grants only `get`.
 *
 *  An ALLOWLIST, not half of a partition: a member verb the framework grows
 *  later is withheld until someone decides it reads, which is the safe
 *  direction for a gate to be wrong in. `satisfies` pins each entry to a verb
 *  the framework declares, so a typo here is a compile error rather than a
 *  member that can never be exposed. */
export const READ_VERBS = [
  "get",
  "keys",
  "deltas",
] as const satisfies readonly (CellVerb | CollectionVerb)[];

const READS: ReadonlySet<string> = new Set<string>(READ_VERBS);

/** The `<namespace, verb>` of every framework-reserved member. They are ALWAYS
 *  reachable on a gated face and are not spellable in a map (they live only in
 *  the group, never in `spec`, so {@link classifyExpose} rejects them like any
 *  other unknown key): a client's heartbeat rides `system/live`, its stale-tab
 *  handshake `system/identity`, and its clock offset `system/clockNow`. Gating
 *  them off would not restrict the face — it would break the link, since a
 *  watchdog reads a refused probe as a dead transport and reconnects forever. */
const RESERVED: readonly (readonly [string, string])[] = [
  [LIVENESS_NAMESPACE, LIVENESS_VERB],
  [IDENTITY_NAMESPACE, IDENTITY_VERB],
  [CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB],
];

/** One face's resolved allowlist: the wire tags it serves, reserved members
 *  included. A checked VALUE — built where the surface is in scope, applied
 *  where only the group is. */
export interface FaceExposure {
  readonly tags: ReadonlySet<string>;
}

/** Every wire tag one classified entry stands for, under `tagPrefix`. */
function tagsOf(
  spec: SurfaceSpec,
  tagPrefix: string,
  entry: ExposeEntry,
  into: Set<string>,
): void {
  if (entry.kind === "procedure") {
    into.add(surfaceTag(tagPrefix, entry.ns, entry.verb));
    return;
  }
  const { key } = entry;
  // The verbs a member DECLARES, intersected with the read set — read off the
  // same `resolve*Verbs` the tag minting and the handler binding read, so a
  // granted tag is always one the group actually carries.
  const declared =
    entry.kind === "cell"
      ? resolveCellVerbs(
          (spec.cells as Record<string, CellSpec<unknown, unknown, never>>)[
            key
          ] as CellSpec<unknown, unknown, never>,
        )
      : entry.kind === "collection"
        ? resolveCollectionVerbs(
            (
              spec.collections as Record<
                string,
                CollectionSpec<unknown, unknown, never>
              >
            )[key] as CollectionSpec<unknown, unknown, never>,
          )
        : // A stream and an event each have exactly one verb.
          (["get"] as const);
  for (const verb of declared) {
    if (READS.has(verb)) into.add(surfaceTag(tagPrefix, key, verb));
  }
}

function reservedTags(tagPrefix: string, into: Set<string>): void {
  for (const [ns, verb] of RESERVED) into.add(surfaceTag(tagPrefix, ns, verb));
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
  reservedTags(surface.tagPrefix, tags);
  for (const entry of classifyExpose(surface.spec, expose)) {
    tagsOf(surface.spec, surface.tagPrefix, entry, tags);
  }
  return { tags };
}

/** {@link exposeFace} for a sibling bundle (`implementSurfaces`): one map per
 *  sibling, keyed the way the bundle is.
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
  for (const [key, sibling] of Object.entries(surfaces)) {
    const prefix = siblingTagPrefix(key);
    reservedTags(prefix, tags);
    const map = expose[key];
    if (map === undefined) continue;
    for (const entry of classifyExpose(sibling.spec, map)) {
      tagsOf(sibling.spec, prefix, entry, tags);
    }
  }
  return { tags };
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
 *  The two wire faces call this for you (`serveSurfaceApp`,
 *  `serveOverUnixSocket`); a hand-built serve path calls it itself and serves
 *  the result.
 *
 *  It also PROVES the exposure describes this group — an exposure built from a
 *  different surface would otherwise gate silently and completely, which is the
 *  failure a default-deny gate is uniquely good at hiding (everything is denied
 *  and the face still serves, so nothing looks broken until a caller needs the
 *  verb). */
export function restrictHandlers(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  handlers: SurfaceHandlers,
  exposure: FaceExposure,
): SurfaceHandlers {
  const stray = [...exposure.tags].filter((tag) => !group.requests.has(tag));
  if (stray.length > 0) {
    throw new Error(
      `restrictHandlers: the exposure names ${stray.length} tag(s) this surface does not serve [${stray.sort().join(", ")}] — it was built from a different surface than the group being served.`,
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
