/**
 * Per-face `expose` — the default-deny allowlist ONE serving face applies to a
 * served surface.
 *
 * A surface is served by more than one face at a time (a browser websocket, a
 * unix socket, an MCP adapter), and those faces do not carry the same trust. A
 * local CLI on a `0700` socket is not an anonymous tab someone left open. Until
 * this module existed only the MCP face was gated, so a verb was reachable to
 * EVERY face or to none, and an app that wanted its writes on the surface had
 * to keep a second, hand-rolled path beside it (juspay/kolu#2169).
 *
 * ## The shape is the one `@kolu/surface-mcp` already takes
 *
 * {@link ExposeMap} lives here rather than in the MCP adapter because it is now
 * shared vocabulary: membership is the allowlist, an omitted member is NOT
 * exposed, and the keys are typed against the spec where the compiler can
 * narrow. `@kolu/surface-mcp` re-exports these two types and keeps its own
 * resolver — a map entry there also decides a `surface://` resource URI or an
 * MCP tool name, which is adapter vocabulary and stays with the adapter.
 *
 * ## What a wire face resolves it against: the GROUP, not the spec
 *
 * A wire face holds `{ group, handlers }` and never the `SurfaceSpec` — and it
 * does not need it. `implementSurface` proves the bound handler set is exactly
 * the group's tag set, so the group IS the authoritative inventory of what this
 * surface can be asked for. {@link restrictHandlers} reads member and verb off
 * each wire tag, which is also what lets it gate a sibling bundle
 * (`surface/<sibling>/<member>/<verb>`) with the same code that gates a
 * standalone surface (`surface/<member>/<verb>`).
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
 * same way: `"resource"` grants a member's read verbs ({@link READ_VERBS}) and
 * withholds everything else it declares (`set`, `patch`, `upsert`, `delete`,
 * `test__set`). That is the whole point on the untrusted face — the tab reads
 * the cell, the socket writes it.
 *
 * A member that must be *writable* on a gated face has no spelling today. That
 * is a deliberate gap: it wants a shape (`{ resource: { writes: true } }`)
 * proposed on both faces at once, not back-doored in as a knob here.
 */

import { Data, Effect, Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcSchema } from "effect/unstable/rpc";
import { CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB } from "./clockNow";
import {
  type CellVerb,
  type CollectionVerb,
  type SurfaceSpec,
  TAG_SEPARATOR,
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

/** The default-deny allowlist. Keys are constrained to the spec's own
 *  primitives/procedures; omission means *not exposed*. A primitive maps to
 *  `"resource"`; a procedure to a `ToolExposure`.
 *
 *  Typed against `S` where the compiler can narrow; falls back to a `string`
 *  index so a key the generics can't enumerate (a heavily-composed spec) still
 *  type-checks and is validated at runtime against the live surface. */
export type ExposeMap<S extends SurfaceSpec = SurfaceSpec> = {
  [K in ProcedureName<S>]?: ToolExposure;
} & {
  [K in ResourceCellName<S> | CollectionName<S>]?: "resource";
} & {
  // Loosen-to-string escape hatch: keys the mapped types above can't enumerate
  // stay assignable, and the resolvers check each against the live surface at
  // boot. A WIRE face has no `S` to narrow with at all — it holds a group, not a
  // spec — so on that face EVERY key lands here and the boot check is the whole
  // guarantee. Which is why an unmatched key crashes rather than warns.
  [key: string]: ToolExposure | "resource" | undefined;
};

// ── The refusal ─────────────────────────────────────────────────────────

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

// ── The verb partition ──────────────────────────────────────────────────

/** The verbs a `"resource"` exposure grants — the read face of every primitive
 *  kind at once (a cell's and a stream's and an event's `get`, a collection's
 *  `keys` / `get` / `deltas`).
 *
 *  The list is an ALLOWLIST, not half of a partition, so a member verb the
 *  framework grows later is withheld until someone decides it reads — which is
 *  the safe direction for a gate to be wrong in. `satisfies` pins each entry to
 *  a verb the framework actually declares, so a typo here is a compile error
 *  rather than a member that can never be exposed. */
const READ_VERBS = ["get", "keys", "deltas"] as const satisfies readonly (
  | CellVerb
  | CollectionVerb
)[];

const READS: ReadonlySet<string> = new Set<string>(READ_VERBS);

/** The framework-reserved members, as the `<member>.<verb>` tail of their wire
 *  tags. They are ALWAYS reachable on a gated face and are not spellable in an
 *  `ExposeMap`: a client's heartbeat rides `system/live`, its stale-tab
 *  handshake rides `system/identity`, and its clock-offset measurement rides
 *  `system/clockNow`. Gating them off would not restrict the face, it would
 *  break the link — a watchdog reads a refused probe as a dead transport and
 *  reconnects forever. */
const RESERVED_TAILS: ReadonlySet<string> = new Set([
  `${LIVENESS_NAMESPACE}.${LIVENESS_VERB}`,
  `${IDENTITY_NAMESPACE}.${IDENTITY_VERB}`,
  `${CLOCK_NOW_NAMESPACE}.${CLOCK_NOW_VERB}`,
]);

// ── Tag algebra ─────────────────────────────────────────────────────────

/** A wire tag, split the one way a face can split it: the LAST segment is the
 *  verb, the one before it is the member, and whatever precedes both is the
 *  prefix (`surface/` standalone, `surface/<sibling>/` inside a bundle).
 *  `defineSurface` forbids a `/` in either name, so this split is exact.
 *
 *  `path` is the dot-joined member path an `ExposeMap` key spells — `"nodes"`
 *  for a standalone member, `"kaval.nodes"` for a sibling's; `procedure` is that
 *  joined with the verb, which is what a `"<ns>.<verb>"` key spells; `tail` is
 *  the last two segments, which is how a reserved member is recognised whatever
 *  prefix it is carrying. */
interface SplitTag {
  readonly path: string;
  readonly procedure: string;
  readonly tail: string;
  readonly verb: string;
}

function splitTag(tag: string): SplitTag | undefined {
  const segments = tag.split(TAG_SEPARATOR);
  if (segments.length < 3) return undefined;
  const verb = segments[segments.length - 1] as string;
  const member = segments[segments.length - 2] as string;
  const path = segments.slice(1, -1).join(".");
  return {
    path,
    procedure: `${path}.${verb}`,
    tail: `${member}.${verb}`,
    verb,
  };
}

// ── The filter ──────────────────────────────────────────────────────────

/** A handler that refuses, in the shape its member's `Rpc` promises. A caller
 *  subscribing to a streaming member gets a stream that dies rather than a value
 *  the protocol cannot run — which is why this needs the group, and not just the
 *  handler record. */
function refuse(tag: string, streaming: boolean): SurfaceHandler {
  const refusal = new SurfaceMemberNotExposed({ tag });
  return streaming ? () => Stream.die(refusal) : () => Effect.die(refusal);
}

/** Apply one face's `expose` to a served surface's handlers, returning the
 *  record that face should serve: every exposed member's real handler, and a
 *  refusing handler at every tag the map does not name.
 *
 *  Validated against `group` at the call — which is BOOT, because every face
 *  restricts once, before it binds. A key that names nothing, a procedure
 *  exposed as `"resource"`, or a primitive exposed as a tool all throw here
 *  rather than resolve to a silently narrower allowlist. That is the failure
 *  mode a default-deny gate is uniquely good at hiding: a typo'd map denies
 *  everything and the face still serves, so nothing looks broken until a caller
 *  needs the verb.
 *
 *  Not called for a face with no `expose` — an ungated face serves `handlers`
 *  itself, unwrapped. */
export function restrictHandlers(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  handlers: SurfaceHandlers,
  expose: ExposeMap,
): SurfaceHandlers {
  /** Every tag this face will answer. Reserved members are seeded, so the map
   *  can neither grant nor revoke them. */
  const allowed = new Set<string>();
  /** Every member tag, split and with the one bit the classification below
   *  turns on. Parsed once. */
  const split = new Map<string, SplitTag & { readonly streaming: boolean }>();
  /** Paths that name a PRIMITIVE with something to read.
   *
   *  A STREAMING verb is what says so, and it says so exactly: every readable
   *  primitive serves its read as a subscription (a cell's / stream's / event's
   *  `get`, a collection's `keys` / `get` / `deltas`), and a procedure is never
   *  streaming — `defineSurface` mints one with `payload`/`success`/`error` and
   *  no `stream: true` to give it. Classifying by NAME instead would read a
   *  procedure namespace holding a verb called `get` as a member, and
   *  `{ config: "resource" }` would then grant `config.get` on a face where the
   *  MCP adapter reading the same map refuses to boot. */
  const primitives = new Set<string>();
  /** Paths that name something — a procedure namespace, or a primitive with no
   *  read verb. Used only to tell a wrong-shaped key from a typo'd one. */
  const paths = new Set<string>();

  for (const [tag, rpc] of group.requests) {
    const parts = splitTag(tag);
    if (parts === undefined) {
      throw new Error(
        `restrictHandlers: "${tag}" is not a surface member tag (expected at least <root>/<member>/<verb>), so this face cannot decide whether an expose map names it.`,
      );
    }
    // `Rpc.Any` narrows away the schema fields the whole union carries;
    // `AnyWithProps` is Effect's own name for reading them off an erased `Rpc`,
    // which is exactly what a tag-keyed walk has to do.
    const streaming = RpcSchema.isStreamSchema(
      (rpc as Rpc.AnyWithProps).successSchema,
    );
    split.set(tag, { ...parts, streaming });
    if (RESERVED_TAILS.has(parts.tail)) {
      allowed.add(tag);
      continue;
    }
    paths.add(parts.path);
    if (streaming) primitives.add(parts.path);
  }

  /** Every `"<ns>.<verb>"` a key may name. Derived by SUBTRACTION — a tag under
   *  a primitive path is a member verb, everything else is a procedure — so
   *  `{ config: "resource" }` cannot quietly grant a procedure named
   *  `config.get`, which is what treating every path as a member would do. */
  const procedures = new Set<string>();
  for (const parts of split.values()) {
    if (!RESERVED_TAILS.has(parts.tail) && !primitives.has(parts.path)) {
      procedures.add(parts.procedure);
    }
  }

  for (const [key, exposure] of Object.entries(
    expose as Record<string, ToolExposure | "resource" | undefined>,
  )) {
    if (exposure === undefined) continue;
    // Which of the two things a key names is decided by the SURFACE, not by
    // counting dots: `"a.b"` is procedure `b` in namespace `a` on a standalone
    // surface AND member `b` of sibling `a` in a bundle, and only the tag set
    // knows which of those this surface has.
    const isProcedure = procedures.has(key);
    const isPrimitive = primitives.has(key);
    if (isProcedure && isPrimitive) {
      throw new Error(
        `restrictHandlers: expose key "${key}" names BOTH a procedure and a primitive on this surface, so what it exposes is ambiguous. Rename one, or serve them on separate faces.`,
      );
    }
    if (isProcedure) {
      if (exposure === "resource") {
        throw new Error(
          `restrictHandlers: procedure "${key}" is exposed as "resource"; procedures are called, not read.`,
        );
      }
      for (const [tag, parts] of split) {
        if (parts.procedure === key) allowed.add(tag);
      }
      continue;
    }
    if (isPrimitive) {
      if (exposure !== "resource") {
        throw new Error(
          `restrictHandlers: primitive "${key}" must be exposed as "resource", not a tool.`,
        );
      }
      for (const [tag, parts] of split) {
        if (parts.path === key && READS.has(parts.verb)) allowed.add(tag);
      }
      continue;
    }
    if (paths.has(key)) {
      throw new Error(
        `restrictHandlers: expose names "${key}", which this surface has members under but nothing readable at — "resource" grants a member's read verbs (${READ_VERBS.join(" / ")}) and "${key}" declares none. If it is a procedure NAMESPACE, name its verbs one at a time as "${key}.<verb>".`,
      );
    }
    throw new Error(
      `restrictHandlers: expose names "${key}" but this surface has no such member or procedure — exposable keys are [${[...primitives, ...procedures].sort().join(", ")}].`,
    );
  }

  // Null prototype, for the same reason `implementSurface`'s record has one: a
  // member legitimately named `toString` must not collide with an inherited
  // property.
  const restricted = Object.create(null) as SurfaceHandlers;
  for (const [tag, parts] of split) {
    const handler = handlers[tag];
    if (handler === undefined) {
      throw new Error(
        `restrictHandlers: nothing is bound at "${tag}", which this surface's group advertises. Restrict the handler record implementSurface returned, not one assembled by hand.`,
      );
    }
    restricted[tag] = allowed.has(tag) ? handler : refuse(tag, parts.streaming);
  }
  return restricted;
}
