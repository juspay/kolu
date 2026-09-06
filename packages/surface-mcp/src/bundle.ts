/**
 * The ROOTED BUNDLE this face serves — an unprefixed core beside a keyed set of
 * siblings — resolved into the flat registration tables the MCP server hands to
 * the SDK, and re-resolved in place whenever the roster moves.
 *
 * ## Why this is a module and not four lines in `server.ts`
 *
 * The bundle is composed TWICE in a server's life and must compose identically
 * both times: once at boot, and again on every {@link ServedSurfaceMcp.reroster}.
 * Every refusal the composition owes — a sibling key that would swallow a core
 * collection's item space, two tools that collapse to one name, a per-sibling
 * expose map that names nothing — has to be made on the second pass exactly as on
 * the first, or a roster move becomes the way to smuggle past the boot gate. One
 * function, called from both, is what makes that true by construction rather than
 * by two call sites remembering the same list.
 *
 * ## The composition rule, once — and what it is FOR
 *
 * `composeSurfaceContracts` makes siblings disjoint by giving each one a SEGMENT
 * of the wire tag. This module applies the same rule to MCP's two name spaces —
 * a URI segment and a `_`-joined tool name (`./expose.ts` owns both spellings) —
 * so two siblings exposing the same member key are disjoint here for the same
 * reason they are on the wire, rather than because a merge happened to keep both.
 *
 * The core is the only surface with no segment, which is what leaves the
 * single-surface face's names exactly as they were.
 *
 * It applies to EVERY name a sibling contributes, hand-authored ones included: a
 * sibling's tool word is row-relative, and putting the row in front of it is what
 * composition is for. What the segment buys is that a collision nobody could have
 * foreseen becomes impossible; what it does NOT buy is uniqueness of the finished
 * namespace, which stays the collision pass's job — `_` is legal inside a
 * segment, and the bundle-root table is bare.
 */

import { notABundleDetail, rootedBundleEntries } from "@kolu/surface/client";
import type { Surface, SurfaceSpec, WireSchemaAny } from "@kolu/surface/define";
import type { ExposeMap } from "@kolu/surface/expose";
import { inputSchema } from "@kolu/surface/verbs";
import {
  COLLECTION_PREFIX,
  collectionUri,
  type ResourceEntry,
  type ResourceTemplateEntry,
  resolveExpose,
  scopedToolName,
  type SiblingKey,
  type ToolEntry,
} from "./expose";
import { ADAPTER_NAME, type BespokeTool, brand } from "./tools";

/** One position of the bundle as the composition WALKS it: a surface, its
 *  default-deny map, and — for a sibling — its own authored table. The core and a
 *  sibling differ only in whether that last field can be there, which is what
 *  lets one fold visit both. */
interface BundlePosition {
  readonly surface: Surface<SurfaceSpec>;
  readonly expose: ExposeMap<SurfaceSpec>;
  readonly tools?: Record<string, BespokeTool>;
}

/** The unprefixed CORE of a bundle: the surface whose members keep their bare
 *  names, and the default-deny map that gates it.
 *
 *  It carries no `tools` of its own. Hand-authored verbs that are about the
 *  ENDPOINT rather than about one surface are the bundle's
 *  ({@link McpBundle.tools}) and are handed the whole client bundle; a verb that
 *  wants only the core reaches `client.core`, which says which surface it is
 *  about at the line that calls it. */
export interface McpCore<S extends SurfaceSpec> {
  readonly surface: Surface<S>;
  readonly expose: ExposeMap<S>;
}

/** One SIBLING of a bundle: its surface, its own default-deny map, and its own
 *  hand-authored tools.
 *
 *  EVERY name it contributes takes the sibling's key as a segment — the
 *  hand-authored ones exactly as the derived ones. One rule, so a reader of a
 *  `tools/list` never has to know which kind of name they are looking at, and an
 *  author never has to decide whether this particular verb is "product
 *  vocabulary" enough to escape the composition. A sibling's tool word is
 *  ROW-RELATIVE (`read`, `commit`, `nodes`), and putting the row in front of it
 *  is exactly what composition is for; that is the same word the argv face puts
 *  the row's own subcommand in front of.
 *
 *  Belonging to the sibling is ALSO recorded on the entry, and the refusal path
 *  reads that rather than the name — see {@link ResolvedBespokeTool.sibling}. A
 *  sibling's tool is handed that sibling's own client (`client.clients[key]`),
 *  because it is written against that sibling's surface and nothing else, and it
 *  leaves with the sibling on a reroster. */
export interface McpSibling<S extends SurfaceSpec = SurfaceSpec> {
  readonly surface: Surface<S>;
  readonly expose: ExposeMap<S>;
  readonly tools?: Record<string, BespokeTool>;
}

/** The whole bundle as this face takes it — what `serveSurfaceAsMcp` is given,
 *  and what `reroster` replaces the sibling half of.
 *
 *  Both halves are optional, and a bundle with NEITHER is refused: "no core and
 *  no siblings" is not a bundle, which is the same refusal `connectSurfaces`
 *  makes on the consume side. */
export interface McpBundle<
  C extends SurfaceSpec = SurfaceSpec,
  M extends Record<string, SurfaceSpec> = Record<string, SurfaceSpec>,
> {
  readonly core?: McpCore<C>;
  /** The siblings, each keyed by the segment its names take.
   *
   *  `M` is the map of their SPECS, and the mapped type is what makes each
   *  sibling's `expose` checked against ITS OWN surface: TypeScript infers `M`
   *  backwards through `{ [K in keyof M]: McpSibling<M[K]> }`, so a call site's
   *  object literal pins one spec per key rather than collapsing to a single
   *  erased one — which is what a `Record<string, McpSibling>` would do, and what
   *  would silently reduce every map to the loosest `ExposeMap`. */
  readonly surfaces?: { [K in keyof M]: McpSibling<M[K]> };
  /** Hand-authored tools composing over the whole client bundle — the verbs that
   *  are about the endpoint rather than about one surface, and the ones that must
   *  survive any roster.
   *
   *  Their handler's `client` is the {@link RootedSurfaceClients} bundle, not a
   *  single surface's client: a tool declared at the bundle root is about the
   *  bundle. The rule across every table this face takes is the same one —
   *  **a tool receives the client of the thing it is declared on** — so a
   *  sibling's tool gets that sibling's client and this one gets the bundle.
   *
   *  BARE, and the only bare authored table there is — a bundle-root verb is
   *  about the endpoint, so it has no row to be relative to. It can still collide
   *  with a sibling's: a bundle-root `a_x` and a sibling `a` whose tool is `x`
   *  mint one name from two places, which is the case the collision pass in
   *  {@link resolveBundle} exists for. */
  readonly tools?: Record<string, BespokeTool>;
}

/** A bespoke tool, resolved: the tool, its computed JSON-Schema input, and WHICH
 *  client it is handed when it runs.
 *
 *  The `inputSchema` pass (Schema→JSON-Schema + dereference) runs once here —
 *  `tools/list` reads `schema`, dispatch reads `wrapped` — because computing it
 *  per request would re-run the full pass every call. */
export interface ResolvedBespokeTool {
  readonly tool: BespokeTool;
  readonly schema: Record<string, unknown>;
  readonly wrapped: boolean;
  /** WHO it belongs to: `undefined` for a bundle-root tool (handed the whole
   *  bundle), a sibling's key for one declared on that sibling (handed that
   *  sibling's client).
   *
   *  Recorded rather than read back out of the name, even though the name now
   *  carries the segment: `_` is legal inside a tag segment, so a leading
   *  `<key>_` is not a sound reading of ownership and never was. It is also what
   *  a departed-tool refusal consults — see `recordDeparted` in `./server.ts`. */
  readonly sibling: SiblingKey;
}

/** Everything the server registers, for ONE GENERATION of the roster —
 *  composed, refused, and INDEXED.
 *
 *  A single value, replaced whole by `ServedSurfaceMcp.reroster` rather than five
 *  tables updated in sequence: a `tools/list` landing between two of those
 *  updates would answer from a roster that never existed. The handlers read it
 *  once per request, so whichever generation they get is a real one.
 *
 *  The indices live HERE, on the value they index, and not in a second type one
 *  depth up. Split by authoring order, a reader did
 *  `current.resolved.bespoke.get(name)` on one line and `current.toolByName.get(
 *  name)` on the next for the same kind of lookup, and a new index had no
 *  principled home. They are a compute-once-read-N-times cache over exactly this
 *  composition — nothing in them reads request state — so the thing that produces
 *  the tables is the thing that produces their indices. */
export interface ResolvedBundle {
  readonly resources: readonly ResourceEntry[];
  readonly resourceTemplates: readonly ResourceTemplateEntry[];
  readonly tools: readonly ToolEntry[];
  readonly bespoke: ReadonlyMap<string, ResolvedBespokeTool>;
  /** The sibling keys this generation serves — what a later reroster diffs
   *  against to know who left. */
  readonly siblings: ReadonlySet<string>;
  /** Static resources by URI — O(1) read/subscribe dispatch. */
  readonly byUri: ReadonlyMap<string, ResourceEntry>;
  /** Collection templates keyed by their COLLECTION's key-set URI, which is the
   *  one address that identifies a collection across a bundle (its `(sibling,
   *  key)` pair, already composed). Keyed by the member key alone, two siblings
   *  exposing `entries` would share one entry and one of them would decode item
   *  ids against the other's key schema. */
  readonly templateByCollection: ReadonlyMap<string, ResourceTemplateEntry>;
  readonly toolByName: ReadonlyMap<string, ToolEntry>;
  /** `tools/list`'s answer, projected once per generation: nothing in it reads
   *  request state, so re-projecting per call would buy nothing.
   *
   *  NO `outputSchema` is advertised, and adding one is not the free win it looks
   *  like. The SDK's client validates `structuredContent` against a declared
   *  `outputSchema` whenever the field is PRESENT — including on an `isError`
   *  result, despite the comment beside that code claiming otherwise
   *  (`client/index.js`: the validate branch sits outside the `isError` guard). A
   *  refusal's `ToolFailure.detail` is a different shape from the success it
   *  refused, so declaring a success schema would make every structured refusal
   *  throw inside the client's SDK instead of reaching the agent. Whoever adds
   *  `outputSchema` owes that case a home first — a union with the refusal shape,
   *  or no structured arm on the error side.
   *
   *  `title` and `description` are bespoke-only TODAY because `ToolExposure` has
   *  no field for either — a gap in the consumer's authoring map, not in this
   *  projection. */
  readonly advertisedTools: ReadonlyArray<Record<string, unknown>>;
}

/** `annotations` carry the read/write distinction to the host: a read-only tool
 *  (`readOnlyHint`) can be auto-approved or surfaced separately from a mutating
 *  one (`destructiveHint`). Without these the `mutates` flag the API and docs
 *  promise never reaches the host.
 *
 *  `mutates` reaches the host through ONE `mutates → annotations` projection, so
 *  the two tool sources cannot drift on the mapping or on the undefined edge
 *  case. Each normalizes `mutates` to a concrete boolean before calling:
 *  procedure tools already carry one (`expose.ts`'s `?? true`), bespoke tools
 *  apply the same conservative `?? true` at the call. */
const toolAnnotations = (mutates: boolean) => ({
  readOnlyHint: !mutates,
  destructiveHint: mutates,
});

/** Resolve a whole bundle into the flat tables, making every refusal the
 *  composition owes.
 *
 *  Called at boot AND at every reroster, with the same arguments in the same
 *  order, so a roster move is held to exactly the boot gate. */
export function resolveBundle<
  C extends SurfaceSpec,
  M extends Record<string, SurfaceSpec>,
>(bundle: McpBundle<C, M>): ResolvedBundle {
  const siblings = (bundle.surfaces ?? {}) as Record<
    string,
    McpSibling<SurfaceSpec>
  >;
  // THE fold, the framework's — core first, then the siblings in key order, so
  // the tables (and therefore `tools/list` and `resources/list`, which a host
  // renders in order) read the same for the same roster however the caller's
  // object was built. The walk and its emptiness refusal used to be spelled here
  // and again, word for word, in the argv face.
  const positions = rootedBundleEntries<BundlePosition>(
    bundle.core as BundlePosition | undefined,
    siblings,
  );
  const siblingKeys = Object.keys(siblings);
  if (positions.length === 0) throw new Error(notABundleDetail(ADAPTER_NAME));

  const resources: ResourceEntry[] = [];
  const resourceTemplates: ResourceTemplateEntry[] = [];
  const tools: ToolEntry[] = [];
  const bespoke = new Map<string, ResolvedBespokeTool>();

  const take = (resolved: ReturnType<typeof resolveExpose>): void => {
    resources.push(...resolved.resources);
    resourceTemplates.push(...resolved.resourceTemplates);
    tools.push(...resolved.tools);
  };

  for (const { sibling, value } of positions) {
    take(resolveExpose(value.surface.spec, value.expose, sibling));
  }

  assertItemSpaceUnshadowed(bundle.core, resources, siblingKeys);

  // ── The whole tool namespace's uniqueness invariant, in one pass ────────
  // The union of generated tool names and every bespoke table's names must have
  // no duplicate: a collision would put two entries in `tools/list` and make
  // dispatch order-dependent. Each candidate is tagged by its ORIGIN — which
  // sibling, or the bundle root — so the error names both colliding sources.
  //
  // Prefixing narrows what can reach here; it is not the guarantee. `_` is legal
  // inside a tag segment, so `a_b_c` can be spelled by more than one
  // (sibling, ns, verb) triple — and a BARE bundle-root name shares the space
  // with every scoped one, so `a_x` at the root and `x` on sibling `a` mint one
  // name from two places. Only a pass over the FINISHED names can see either.
  const sourceByToolName = new Map<string, string>();
  const claim = (name: string, source: string): void => {
    const prior = sourceByToolName.get(name);
    if (prior !== undefined) {
      throw new Error(
        brand(
          `tool name "${name}" is produced by both ${prior} and ${source} — rename one`,
        ),
      );
    }
    sourceByToolName.set(name, source);
  };
  for (const tool of tools) claim(tool.name, describeProcedure(tool));
  const takeBespoke = (
    sibling: SiblingKey,
    table: Record<string, BespokeTool> | undefined,
  ): void => {
    for (const [name, tool] of Object.entries(table ?? {})) {
      // The sibling's segment, exactly as a derived name takes it — one rule for
      // every name this face publishes (see {@link McpSibling}). Ownership is
      // recorded on the entry as well, because the NAME is not a sound reading
      // of it: `_` is legal inside a segment.
      const scoped = scopedToolName(sibling, name);
      claim(
        scoped,
        sibling === undefined
          ? `bespoke ${name}`
          : `bespoke ${name} on sibling "${sibling}"`,
      );
      bespoke.set(scoped, {
        tool,
        ...inputSchema(tool.input as WireSchemaAny | undefined),
        sibling,
      });
    }
  };
  // The BARE bundle-root table first, then the siblings in the fold's own order,
  // so a collision report names the two sources in a stable order.
  takeBespoke(undefined, bundle.tools);
  for (const { sibling, value } of positions) {
    if (sibling !== undefined) takeBespoke(sibling, value.tools);
  }

  const byUri = new Map<string, ResourceEntry>();
  for (const r of resources) byUri.set(r.uri, r);
  const templateByCollection = new Map<string, ResourceTemplateEntry>();
  for (const t of resourceTemplates) {
    templateByCollection.set(collectionUri(t.sibling, t.key), t);
  }

  return {
    resources,
    resourceTemplates,
    tools,
    bespoke,
    siblings: new Set(siblingKeys),
    byUri,
    templateByCollection,
    toolByName: new Map(tools.map((t) => [t.name, t])),
    advertisedTools: [
      ...tools.map((t) => ({
        name: t.name,
        inputSchema: t.inputSchema,
        annotations: toolAnnotations(t.mutates),
      })),
      ...[...bespoke].map(([name, { tool, schema }]) => ({
        name,
        // MCP's display name, distinct from `description`: a host renders it in a
        // tool list, and without one it renders `name` — the machine spelling
        // (`lifecycle_sendInput`) rather than a phrase.
        title: tool.title,
        description: tool.description,
        inputSchema: schema,
        annotations: toolAnnotations(tool.mutates ?? true),
      })),
    ],
  };
}

/** How a generated tool's origin reads in a collision report. */
function describeProcedure(tool: ToolEntry): string {
  const where =
    tool.sibling === undefined ? "" : ` on sibling "${tool.sibling}"`;
  return `procedure ${tool.ns}.${tool.verb}${where}`;
}

/** THE one ambiguity prefix composition can produce, refused where it is made.
 *
 *  A collection is the only member kind with a TEMPLATE under it, so a core
 *  collection named `x` claims every `surface://collections/x/<id>` — which is
 *  exactly the address space a sibling keyed `x` claims for its own members. Two
 *  readings of one URI is not something a lookup order can fix honestly: whichever
 *  one wins, the other's rows are advertised and unreachable.
 *
 *  So it is refused at BOOT and on every reroster, naming both claimants. It is
 *  the only pair that can collide — every other kind's URI has a fixed segment
 *  count, and the tool names are held disjoint by the uniqueness pass above. */
function assertItemSpaceUnshadowed<C extends SurfaceSpec>(
  core: McpCore<C> | undefined,
  resources: readonly ResourceEntry[],
  siblingKeys: readonly string[],
): void {
  if (core === undefined || siblingKeys.length === 0) return;
  const keys = new Set(siblingKeys);
  const shadowed = resources
    .filter((r) => r.sibling === undefined && r.kind === "collection")
    .map((r) => r.key)
    .filter((key) => keys.has(key));
  if (shadowed.length === 0) return;
  throw new Error(
    brand(
      `the core exposes collection(s) [${shadowed.sort().join(", ")}] whose item template ` +
        `${COLLECTION_PREFIX}<name>/{id} is the same address space as the sibling(s) of that ` +
        "name — rename the sibling, or expose the collection from a sibling of its own",
    ),
  );
}

/** A collection-item URI, split into the bundle address it names.
 *
 *  Segment counting is the whole rule, and it is sound because every segment was
 *  `encodeURIComponent`-ed on the way out (`./expose.ts`): TWO segments is a CORE
 *  collection's item, THREE is a sibling's. A two-segment URI that is really a
 *  sibling's key-set resource never reaches here — the caller answers those from
 *  the resource index first — and the one case where the two readings would
 *  genuinely overlap is refused at boot by {@link assertItemSpaceUnshadowed}.
 *
 *  `null` for anything else, including a URI with four or more segments: a rooted
 *  bundle is one level deep, so a deeper address names nothing rather than being
 *  folded into the last segment. */
export function parseCollectionItem(
  uri: string,
): { sibling: SiblingKey; key: string; id: string } | null {
  if (!uri.startsWith(COLLECTION_PREFIX)) return null;
  const raw = uri.slice(COLLECTION_PREFIX.length).split("/");
  if (raw.length !== 2 && raw.length !== 3) return null;
  let parts: string[];
  try {
    parts = raw.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (parts.some((segment) => segment === "")) return null;
  return parts.length === 2
    ? { sibling: undefined, key: parts[0] as string, id: parts[1] as string }
    : {
        sibling: parts[0] as string,
        key: parts[1] as string,
        id: parts[2] as string,
      };
}
