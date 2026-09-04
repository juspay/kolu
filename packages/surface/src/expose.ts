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
 *   2. **{@link exposeFace} / {@link exposeFaces} / {@link exposeRootedFaces}** —
 *      surface(s) + map(s) → {@link FaceExposure}, the concrete set of wire tags
 *      this face serves. One constructor per SHAPE of served surface (standalone,
 *      sibling bundle, rooted bundle), never one with a mode flag. Parse, don't
 *      validate: a face is handed a checked VALUE, never a map it has to
 *      re-interpret.
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
 * (`@kolu/surface/unix-socket`) take `expose` directly. `serveSurfaceApp`
 * applies it per accepted generation (a value is the generation written at
 * the call; a thunk or getter is re-read at each accept, memoized by identity
 * so an unchanged roster costs nothing). `serveOverUnixSocket` still applies
 * it once at bind. A HAND-BUILT serve path — `serveSurfaceSocket` under
 * drishti's per-host dispatch, `serveOverStdio` — restricts its own handlers
 * with {@link restrictHandlers} and serves the result; there is nothing else
 * to it, and that is why the filter is exported. Nothing enforces this split,
 * so it is stated HERE and only here: every other home for it (those faces'
 * docblocks, the reference page, the skill) points back rather than restating,
 * because four independently-worded copies of one rule are four places it can
 * go stale.
 *
 * The two PROJECTING faces take the MAP itself, not a {@link FaceExposure}: a
 * tag set is lossy for them, since each needs the member kind and `mutates` to
 * resolve its own names. `serveSurfaceAsMcp` (`@kolu/surface-mcp`) resolves a
 * `surface://` URI or an MCP tool name; `surfaceCommands` (`@kolu/surface-cli`)
 * resolves a command and its flags. Same map, same grammar, a different step 2
 * each — which is the whole point of the split: a consumer gating its agent
 * face, its terminal face and its browser face writes ONE kind of map, and the
 * same key means the same thing on all three.
 *
 * A projecting face's map is ERGONOMICS, never security: it decides what the
 * client OFFERS, while the serving face's {@link FaceExposure} decides what the
 * server ANSWERS. Both gates exist, and only the second one is a gate.
 */

import { Data } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcSchema } from "effect/unstable/rpc";
import {
  type ComposedSurfaces,
  composeSurfaceContracts,
  isReservedSurfaceTag,
  isStandaloneRoot,
  mergeDisjointGroups,
  notStandaloneRootDetail,
  READ_VERBS,
  type Surface,
  type SurfaceSpec,
  surfaceTag,
} from "./define";
import {
  assertHandlersMatchGroup,
  emptyHandlers,
  refusingHandler,
  type SurfaceHandler,
  type SurfaceHandlers,
} from "./server";

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
 *  The PROJECTING half is `mutates`, a presentation HINT for a host — the write
 *  capability MCP surfaces as `readOnlyHint`/`destructiveHint` and a CLI's
 *  `list` reports as `writes`/`reads`. It defaults CONSERVATIVELY (see
 *  {@link exposureMutates}): both the bare `"tool"` shorthand and `{ tool: {} }`
 *  (no explicit flag) are treated as MUTATING, so an unannotated procedure is
 *  never advertised as auto-approvable read-only. Mark a genuinely read-only
 *  procedure with `{ tool: { mutates: false } }`. It describes how a host should
 *  PRESENT a call, never whether a face may make it. */
export type ToolExposure = "tool" | { tool: { mutates?: boolean } };

/** Does this exposure declare a MUTATING procedure?
 *
 *  CONSERVATIVE by construction: an exposure that does not explicitly say
 *  `mutates: false` is mutating. A read-only hint can let a host auto-execute a
 *  call unconfirmed, so an unannotated procedure must fail SAFE — the
 *  inverted-default defect, in one derivation rather than in one per face.
 *
 *  It is the FRAMEWORK's and not each face's precisely because it is a safety
 *  default: both faces spelled it character for character, each with its own
 *  paragraph explaining the same reasoning, which is two places for one rule to
 *  be relaxed in and only one of them to be noticed. */
export const exposureMutates = (exposure: ToolExposure): boolean =>
  typeof exposure === "object" ? (exposure.tool.mutates ?? true) : true;

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

/** Every `<ns>.<verb>` split of a dotted key that names a REAL procedure.
 *
 *  ENUMERATED, not split at the first dot, because the first-dot rule's premise
 *  is false: `assertTagSegment` refuses `/` in a member name, never `.`, and
 *  `claim` rejects a duplicate TAG rather than a shared name — so
 *  `procedures: { a: { "b.c": … }, "a.b": { c: … } }` is a LEGAL surface whose
 *  two procedures mint distinct tags and both spell the key `"a.b.c"`
 *  (`ProcedureName<S>` emits it twice, so the compile-time key check sees
 *  nothing either). Taking the first split there grants `a`.`b.c` to a face
 *  whose author wrote `a.b`.`c` — a member reachable on a gated face that the
 *  map does not name, which is the ONE thing this gate exists to prevent. So a
 *  key is read only when exactly one procedure answers to it: zero is the
 *  "names nothing" refusal, and more than one is refused as ambiguous rather
 *  than resolved by a tie-break nobody could predict from the map. */
/** A spec table's member at `key` — its OWN member, or `undefined`.
 *
 *  Every lookup this module makes into a spec goes through here, because a spec
 *  table is a plain object literal a surface author wrote, so it inherits
 *  `Object.prototype`: a bare `cells[key]` answers a FUNCTION for `toString`,
 *  `constructor`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`,
 *  `propertyIsEnumerable` and `toLocaleString`. Read that way, `{ toString:
 *  "resource" }` and `{ "admin.toString": "tool" }` name members no surface
 *  declares and the classifier says they exist — so `@kolu/surface-mcp`
 *  ADVERTISED them, `tools/list` carrying `admin_toString` and a resource
 *  `surface://cells/toString`. A key that names nothing became a grant, which
 *  is the one failure a default-deny gate exists to prevent (and on the wire
 *  face it surfaced as the write-only-gap refusal — the right verdict for the
 *  wrong reason, diagnosed as a different deferred gap entirely).
 *
 *  `Object.hasOwn` is what the rest of the stack already uses for exactly this:
 *  `define.ts` reads a cell-vs-collection collision with it, `exposeFaces`
 *  reads sibling keys with it, and `implementSurface`'s handler record is
 *  null-prototype for the same reason. A member a surface legitimately names
 *  `toString` keeps working — it is an own key, and the tests pin it. */
function ownMember<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function procedureSplits(
  procedures: Record<string, Record<string, SpecProcedure>>,
  key: string,
): {
  readonly ns: string;
  readonly verb: string;
  readonly spec: SpecProcedure;
}[] {
  const found: { ns: string; verb: string; spec: SpecProcedure }[] = [];
  for (
    let dot = key.indexOf(".");
    dot !== -1;
    dot = key.indexOf(".", dot + 1)
  ) {
    const ns = key.slice(0, dot);
    const verb = key.slice(dot + 1);
    const namespace = ownMember(procedures, ns);
    if (namespace === undefined) continue;
    const spec = ownMember(namespace, verb);
    if (spec !== undefined) found.push({ ns, verb, spec });
  }
  return found;
}

/** Is this value the `ToolExposure` the type promises?
 *
 *  Checked at RUNTIME because {@link classifyExpose} is the boot check for
 *  exactly the call shapes the type cannot see (an erased
 *  `ExposeMap<SurfaceSpec>` collapses to `{}` and accepts any key AND any
 *  value). Without it the likeliest hand-authoring slip —
 *  `{ "ns.verb": { mutates: false } }`, the `tool` wrapper forgotten — reaches
 *  `@kolu/surface-mcp` as `exposure.tool.mutates` and dies with a raw
 *  `TypeError` carrying neither this module's class nor the face's brand, while
 *  a wire face reads the same garbage as a perfectly good grant. The value half
 *  of the grammar is the grammar's, like the key half. */
function isToolExposure(value: unknown): value is ToolExposure {
  if (value === "tool") return true;
  if (typeof value !== "object" || value === null) return false;
  const tool = (value as { tool?: unknown }).tool;
  if (typeof tool !== "object" || tool === null) return false;
  const mutates = (tool as { mutates?: unknown }).mutates;
  return mutates === undefined || typeof mutates === "boolean";
}

/** Walk a spec + expose map and say what each key names. THE authority on the
 *  key grammar, so every face reads one map one way:
 *
 *    - a key with a `.` names a procedure, `<ns>.<verb>` — at whichever dot the
 *      spec's own procedures resolve at, uniquely (see {@link procedureSplits});
 *    - any other key names a primitive by its surface key.
 *
 *  "A `.`" means the ASCII full stop and nothing else. A key spelled with a
 *  lookalike (`a．b` U+FF0E, `a․b` U+2024, `a·b`) is therefore a PRIMITIVE key,
 *  and refuses as one — loud, and worth knowing before you read the message,
 *  because "must be exposed as resource, not a tool" is a surprising answer to
 *  a key that looks dotted.
 *
 *  Every key is checked against the live spec — a key that names no
 *  primitive/procedure, or more than one, is a boot-time error and not a silent
 *  no-op — as is the KIND of exposure and its VALUE, so a procedure exposed as a
 *  resource, a primitive exposed as a tool, and a malformed `ToolExposure` are
 *  all refusals rather than surprises. Lookups are OWN-property only (see
 *  {@link ownMember}): a spec table inherits `Object.prototype`, so `toString`
 *  and its siblings name nothing and must refuse like any other absent key.
 *
 *  `face` is the optional brand a non-framework face stamps on the refusal —
 *  `@kolu/surface-mcp` passes its adapter name, so a consumer who wrote one bad
 *  map is told which door it came through. Stamped HERE, at the throw, rather
 *  than by a caller that catches and rebuilds: a rebuilt error is a new error,
 *  and the stack that says which key failed is the half a rebuild discards. */
export function classifyExpose<S extends SurfaceSpec>(
  spec: S,
  expose: ExposeMap<S>,
  face?: string,
): ExposeEntry[] {
  function refuseMap(detail: string): never {
    throw new ExposeMapError({ detail, face });
  }
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

    if (key.includes(".")) {
      const matches = procedureSplits(procedures, key);
      if (matches.length > 1) {
        refuseMap(
          `expose key "${key}" is ambiguous — the spec declares ${matches.length} procedures it could name (${matches
            .map((m) => `namespace "${m.ns}" verb "${m.verb}"`)
            .join(", ")}); rename one so the key names exactly one member`,
        );
      }
      const match = matches[0];
      if (match === undefined) {
        refuseMap(
          `expose names procedure "${key}" but the spec has no such procedure`,
        );
      }
      if (exposure === "resource") {
        refuseMap(
          `procedure "${key}" is exposed as "resource"; procedures map to tools`,
        );
      }
      if (!isToolExposure(exposure)) {
        refuseMap(
          `procedure "${key}" is exposed as something that is not a tool — write "tool" or { tool: { mutates?: boolean } }`,
        );
      }
      entries.push({
        kind: "procedure",
        ns: match.ns,
        verb: match.verb,
        exposure,
        spec: match.spec,
      });
      continue;
    }

    if (exposure !== "resource") {
      refuseMap(`primitive "${key}" must be exposed as "resource", not a tool`);
    }
    const cellSpec = ownMember(cells, key);
    const collectionSpec = ownMember(collections, key);
    const streamSpec = ownMember(streams, key);
    const eventSpec = ownMember(events, key);
    if (cellSpec !== undefined) {
      entries.push({ kind: "cell", key, exposure, spec: cellSpec });
    } else if (collectionSpec !== undefined) {
      entries.push({ kind: "collection", key, exposure, spec: collectionSpec });
    } else if (streamSpec !== undefined) {
      entries.push({ kind: "stream", key, exposure, spec: streamSpec });
    } else if (eventSpec !== undefined) {
      entries.push({ kind: "event", key, exposure, spec: eventSpec });
    } else {
      refuseMap(
        `expose names "${key}" but the spec has no such cell/collection/stream/event`,
      );
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
  /** The wire tags this face serves. The three reserved `system/*` members are
   *  deliberately NOT in here: they are always reachable on a gated face, and
   *  that is {@link restrictHandlers}' guarantee about every exposure it is
   *  handed rather than a property of the ones these constructors built. This is
   *  a structural interface, so a value assembled any other way would otherwise
   *  refuse the heartbeat and break every client on the face. */
  readonly tags: ReadonlySet<string>;
}

/** Every wire tag one classified entry stands for, at `surface.tagPrefix`.
 *  Membership is asked of the GROUP — not re-derived from the spec — so a
 *  granted tag is one the surface provably serves and the verb rules stay in
 *  `define.ts` where they are minted. A `"resource"` grant offers every read
 *  verb and keeps the ones this member actually declares, which is why a cell
 *  that declares only `get` grants only `get` and a collection without `deltas`
 *  never gets one. Returned rather than only accumulated, because a grant of
 *  NOTHING is a defect the caller has to refuse — see {@link tagsAt}. */
function grantedTags(
  surface: Surface<SurfaceSpec>,
  entry: ExposeEntry,
): string[] {
  const granted: string[] = [];
  const add = (member: string, verb: string): void => {
    const tag = surfaceTag(surface.tagPrefix, member, verb);
    if (surface.group.requests.has(tag)) granted.push(tag);
  };
  if (entry.kind === "procedure") {
    add(entry.ns, entry.verb);
    return granted;
  }
  for (const verb of READ_VERBS) add(entry.key, verb);
  return granted;
}

/** Bind ONE map to ONE surface, collecting the tags it grants. The single
 *  operation behind both constructors below — and the prefix is read OFF THE
 *  VALUE, never assumed: `Surface.tagPrefix` is carried precisely so a scoped
 *  sibling and a standalone surface are the same shape here.
 *
 *  A key that resolves but grants NO tag is refused here, not accepted. It is
 *  the last silent way for a map to say something the face will not do: a
 *  write-only primitive (`verbs: ["set"]`) passes {@link classifyExpose} — the
 *  member exists — and then offers only read verbs the surface does not serve,
 *  so the author's `"resource"` grants zero tags and the member is denied with
 *  nothing anywhere saying so. Indistinguishable from a face that is correctly
 *  narrow, which is precisely the failure mode a default-deny gate hides best,
 *  and the same one every other refusal in this module exists to make loud. */
function tagsAt(
  surface: Surface<SurfaceSpec>,
  map: ExposeMap<SurfaceSpec>,
  into: Set<string>,
): void {
  for (const entry of classifyExpose(surface.spec, map)) {
    const granted = grantedTags(surface, entry);
    if (granted.length === 0) {
      const name =
        entry.kind === "procedure" ? `${entry.ns}.${entry.verb}` : entry.key;
      throw new ExposeMapError({
        detail:
          `expose names "${name}" but that grants nothing on this surface: ` +
          `a "resource" key offers the read verbs [${READ_VERBS.join(", ")}] and this member declares none of them. ` +
          `A write-only member has no spelling on a gated face today (juspay/kolu#2169)`,
      });
    }
    for (const tag of granted) into.add(tag);
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
  tagsAt(surface, expose, tags);
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
 *  omission. A map for a sibling that does not EXIST is the opposite — an
 *  {@link ExposeMapError}, the same refusal {@link classifyExpose} raises for a
 *  key that names nothing, because a policy nobody reads is not a policy.
 *
 *  A FOLD of {@link exposeFace}'s single-surface step over
 *  `composeSurfaceContracts` — the same composition `implementSurfaces` binds
 *  its handlers against, so the scoped tags this gate names and the scoped tags
 *  that runtime serves come from ONE walk and cannot drift. Nothing here does
 *  prefix arithmetic of its own: each `composed.siblings[key]` is a `Surface`
 *  whose `tagPrefix` is already `surface/<key>/`, and the bundle's tag universe
 *  is just `composed.group.requests`. (It also makes an already-SCOPED sibling a
 *  non-question — composition rebuilds every sibling from its `spec`, so the
 *  prefix a caller happens to hand in is never read.) */
export function exposeFaces<M extends Record<string, Surface<SurfaceSpec>>>(
  surfaces: M,
  expose: { [K in keyof M]?: ExposeMap<M[K]["spec"]> },
): FaceExposure {
  const composed = composeSurfaceContracts(surfaces);
  return {
    universe: new Set(composed.group.requests.keys()),
    tags: siblingTagsAt("exposeFaces", surfaces, composed, expose),
  };
}

/** Bind one map PER SIBLING to the bundle they were composed into, collecting the
 *  tags they grant — the fold {@link exposeFaces} and {@link exposeRootedFaces}
 *  share, so the two constructors read a sibling map by ONE rule and a third
 *  constructor cannot arrive with a fourth reading of `expose`. */
function siblingTagsAt<M extends Record<string, Surface<SurfaceSpec>>>(
  seam: string,
  surfaces: M,
  composed: ComposedSurfaces<M>,
  expose: { [K in keyof M]?: ExposeMap<M[K]["spec"]> },
): Set<string> {
  const into = new Set<string>();
  const maps = expose as Record<string, ExposeMap<SurfaceSpec> | undefined>;
  // A map keyed by a sibling this bundle does not have is {@link
  // classifyExpose}'s "names nothing" refusal one level UP, and it needs the
  // same answer for the same reason: the fold below walks `surfaces`, never
  // `expose`, so a misspelled sibling key is read by nobody. Silently, and in
  // the direction that looks like success — the sibling the author meant to gate
  // is simply absent from the policy, `universe` still matches the served group,
  // and the face binds serving nothing of it. The type catches this only for an
  // inline literal against a non-erased `M`; this catches the rest, exactly as
  // the member-level check does for a member-level typo.
  const strays = Object.keys(maps).filter(
    (key) => maps[key] !== undefined && !Object.hasOwn(surfaces, key),
  );
  if (strays.length > 0) {
    throw new ExposeMapError({
      detail: `${seam}: expose names sibling(s) [${strays.sort().join(", ")}] this bundle does not have; its siblings are [${Object.keys(surfaces).sort().join(", ")}]`,
    });
  }
  for (const key of Object.keys(surfaces)) {
    const sibling = composed.siblings[key] as Surface<SurfaceSpec>;
    tagsAt(sibling, maps[key] ?? {}, into);
  }
  return into;
}

/** {@link exposeFaces} for a ROOTED bundle — an unprefixed ROOT surface beside the
 *  sibling map, gated as ONE face. The third member of the family
 *  (`exposeFace` → one surface, `exposeFaces` → siblings, this → root + siblings),
 *  a distinct constructor rather than a mode flag, exactly as
 *  `implementSurface`/`implementSurfaces` are.
 *
 *  It exists so the two halves are never unioned by HAND. A face over root +
 *  siblings is otherwise spelled `{ universe: a.universe ∪ b.universe, tags: a.tags
 *  ∪ b.tags }` over an `exposeFace` and an `exposeFaces` — and a set union carries
 *  an unwritten precondition its caller has to promise: it is only sound while the
 *  two groups are DISJOINT. When they are not, the union silently keeps one copy of
 *  the shared tag, the `universe` still set-equals a served group merged just as
 *  carelessly, {@link restrictHandlers} sees nothing wrong, and the face serves one
 *  member under the other's policy.
 *
 *  Two things replace that promise. The universe is `mergeDisjointGroups` of the
 *  two halves — the SAME counted composition the serve path runs — so disjointness
 *  is established rather than assumed. And the root is REFUSED unless it is
 *  standalone, which is the reachable half of the same law: `tagsAt` reads a
 *  surface's prefix off the value (by design — a scoped sibling and a standalone
 *  surface are the same shape there), so a sibling-scoped surface handed in as the
 *  root carries `surface/<key>/…` tags. Those collide with the sibling of that key
 *  when it is present, and when it is NOT they quietly describe a bundle nobody
 *  serves — an exposure `restrictHandlers` then refuses far from the mistake. The
 *  same refusal `connectSurfaces` makes about its own `core`, made here so the
 *  rule holds at both doors rather than only the one an app happens to use.
 *
 *  The maps are per surface: the root's against the root's own spec, one per
 *  sibling against that sibling's, which is what keeps every `S` inferable and what
 *  stops one dotted path meaning two things. A sibling with no map is fully denied
 *  (default-deny is the contract); a map for a sibling that does not exist is an
 *  {@link ExposeMapError}, the same refusal {@link exposeFaces} raises. */
export function exposeRootedFaces<
  S extends SurfaceSpec,
  M extends Record<string, Surface<SurfaceSpec>>,
>(
  core: Surface<S>,
  coreExpose: ExposeMap<S>,
  siblings: M,
  siblingExpose: { [K in keyof M]?: ExposeMap<M[K]["spec"]> },
): FaceExposure {
  // The predicate and the sentence are `./define`'s — ONE reading of "is this the
  // root of a bundle", shared with the serve door and the browser door. The error
  // CLASS stays this module's own: `ExposeMapError` is what a caller here
  // recognises a malformed exposure by.
  if (!isStandaloneRoot(core)) {
    throw new ExposeMapError({
      detail: notStandaloneRootDetail(
        "exposeRootedFaces",
        "the root surface",
        core.tagPrefix,
        "gate it as a sibling with `exposeFaces`",
      ),
    });
  }
  const composed = composeSurfaceContracts(siblings);
  // The siblings enter as ONE labelled half, where `connectSurfaces` labels each
  // sibling separately — a deliberate difference, not an oversight. That seam also
  // multiplexes `extraGroups` it did not build (a keyed map's group, a host's
  // hand-written procedures), so naming WHICH sibling an outside group collided
  // with is the whole value of the report. Here both halves are ours and
  // `composeSurfaceContracts` has already proved the siblings disjoint among
  // themselves, so the only collision left to report is root-against-siblings, and
  // one label says it exactly.
  const universe = mergeDisjointGroups({
    core: core.group,
    siblings: composed.group,
  });
  const tags = siblingTagsAt(
    "exposeRootedFaces",
    siblings,
    composed,
    siblingExpose,
  );
  tagsAt(core, coreExpose, tags);
  return { universe: new Set(universe.requests.keys()), tags };
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

/** This face's refusal, in the shape its member's `Rpc` promises. The SHAPE rule
 *  is `./server`'s {@link refusingHandler} — the one place the framework decides
 *  what "answer in the member's own shape" means, shared with a rooted bundle's
 *  dropped-sibling refusal. What is this module's own is the error CLASS. */
function refuse(tag: string, streaming: boolean): SurfaceHandler {
  // HOISTED, once per denied tag. A policy refusal carries nothing per call —
  // `tag` is fixed when the face binds — and `SurfaceMemberNotExposed` extends
  // `Error`, so minting it inside the thunk captured a fresh stack on every
  // refused call to buy nothing. (A LIFETIME refusal is the same shape; see
  // `refusingHandler`'s note.)
  const refusal = new SurfaceMemberNotExposed({ tag });
  return refusingHandler(streaming, () => refusal);
}

/** Apply one face's {@link FaceExposure} to a served surface's handlers,
 *  returning the record that face should serve: every exposed member's real
 *  handler, and a refusing handler at every other tag.
 *
 *  TOTAL over "no declared policy": an `undefined` exposure returns `handlers`
 *  unchanged, so the "omit `expose` and the face serves the whole surface" rule
 *  has ONE implementation and a face cannot get the default wrong. WHEN a face
 *  calls it is that face's: `serveSurfaceApp` calls it per accepted generation
 *  (and once at bind, so a static mismatch still fails before anyone connects);
 *  `serveOverUnixSocket` calls it once at bind. A mismatched exposure crashes
 *  rather than gating silently, which is the failure a default-deny gate is
 *  uniquely good at hiding.
 *
 *  The two wire faces call this for you (`serveSurfaceApp`,
 *  `serveOverUnixSocket`); a hand-built serve path calls it itself and serves
 *  the result.
 *
 *  It is also where the framework-reserved `system/*` members are GRANTED — not
 *  in the constructors above. Stated once, by the code that applies the policy,
 *  it holds for every {@link FaceExposure} rather than only the ones this module
 *  built.
 *
 *  It also PROVES the exposure describes this group, by comparing the origin
 *  the exposure CARRIES with the tags the group serves. An exposure built from
 *  a different — or merely PARTIAL — surface would otherwise gate silently and
 *  completely, which is the failure a default-deny gate is uniquely good at
 *  hiding (everything is denied and the face still serves, so nothing looks
 *  broken until a caller needs the verb). Set equality, not "no stray tag": a
 *  map exposed against the wrong surface can easily grant nothing at all, so a
 *  one-directional check reads it as fine — and a bundle exposed with one
 *  sibling missing would silently deny that whole sibling, its `system/live`
 *  heartbeat included. The refusal is an {@link ExposeMapError}, the same class
 *  every other "this map does not describe this surface" boot crash raises, so a
 *  face that wants to recognise one never matches on message text. The `tags`
 *  are proved the same way, in the one direction that can be wrong: a GRANT of a
 *  tag the surface does not serve (only reachable on a hand-assembled exposure —
 *  the constructors ask the group before granting) would be read by nobody,
 *  since the walk below is over the group. */
export function restrictHandlers(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  handlers: SurfaceHandlers,
  exposure: FaceExposure | undefined,
): SurfaceHandlers {
  if (exposure === undefined) return handlers;
  // The record must be the group's, exactly — the same proof `implementSurface`
  // owes when it BUILDS one. An unbound tag would 404 at the far end, and a
  // handler at a tag the group does not carry would be silently dropped here
  // while surviving on an ungated face, which is the worse of the two.
  assertHandlersMatchGroup(group, handlers, "restrictHandlers");
  const served = group.requests;
  const missing = [...exposure.universe].filter((tag) => !served.has(tag));
  const undescribed = [...served.keys()].filter(
    (tag) => !exposure.universe.has(tag),
  );
  if (missing.length > 0 || undescribed.length > 0) {
    const clauses: string[] = [];
    if (missing.length > 0) {
      clauses.push(
        `it describes ${missing.length} tag(s) this surface does not serve [${missing.sort().join(", ")}]`,
      );
    }
    if (undescribed.length > 0) {
      clauses.push(
        `this surface serves ${undescribed.length} tag(s) the exposure describes nothing about [${undescribed.sort().join(", ")}], which would be denied with nothing to say so`,
      );
    }
    throw new ExposeMapError({
      detail: `restrictHandlers: this exposure was built from a different surface than the group being served — ${clauses.join(" — ")}.`,
    });
  }
  // …and that every tag it GRANTS is one the surface serves. The constructors
  // above cannot mint a stray (they ask the group before granting), but
  // `FaceExposure` is a structural interface and a hand-assembled one is a
  // supported argument — and the walk below is over the GROUP, so a granted tag
  // nothing serves is read by nobody. Loud here, rather than an allowance that
  // quietly does less than it says, is the same answer `universe` gets one line
  // up: an author who names a member and gets silence has no way to find out.
  const ungranted = [...exposure.tags].filter((tag) => !served.has(tag));
  if (ungranted.length > 0) {
    throw new ExposeMapError({
      detail: `restrictHandlers: this exposure grants ${ungranted.length} tag(s) this surface does not serve [${ungranted.sort().join(", ")}], which would be silently ignored.`,
    });
  }
  const restricted = emptyHandlers();
  for (const [tag, rpc] of group.requests) {
    // The framework-reserved members ALWAYS answer, whatever the exposure says.
    // Asked of the TAG rather than seeded into `exposure.tags` when it was
    // built, so the invariant holds for every exposure this applier is handed —
    // `FaceExposure` is a structural interface, and a hand-assembled one that
    // refused `system/live` would read as a dead transport to every client's
    // watchdog and reconnect forever.
    restricted[tag] =
      exposure.tags.has(tag) || isReservedSurfaceTag(tag)
        ? (handlers[tag] as SurfaceHandler)
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
