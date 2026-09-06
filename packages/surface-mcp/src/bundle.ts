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

import type { Surface, SurfaceSpec, WireSchemaAny } from "@kolu/surface/define";
import type { ExposeMap } from "@kolu/surface/expose";
import { inputSchema } from "@kolu/surface/verbs";
import {
  COLLECTION_PREFIX,
  type ResourceEntry,
  type ResourceTemplateEntry,
  resolveExpose,
  scopedToolName,
  type SiblingKey,
  type ToolEntry,
} from "./expose";
import { type BespokeTool, brand } from "./tools";

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

/** Everything the server registers, for ONE generation of the roster. */
export interface ResolvedBundle {
  readonly resources: readonly ResourceEntry[];
  readonly resourceTemplates: readonly ResourceTemplateEntry[];
  readonly tools: readonly ToolEntry[];
  readonly bespoke: ReadonlyMap<string, ResolvedBespokeTool>;
  /** The sibling keys this generation serves — what a later reroster diffs
   *  against to know who left. */
  readonly siblings: ReadonlySet<string>;
}

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
  const siblingKeys = Object.keys(siblings);
  if (bundle.core === undefined && siblingKeys.length === 0) {
    throw new Error(
      brand(
        "a bundle with no core and no siblings is not a bundle — pass `core`, at least one entry in `surfaces`, or both",
      ),
    );
  }

  const resources: ResourceEntry[] = [];
  const resourceTemplates: ResourceTemplateEntry[] = [];
  const tools: ToolEntry[] = [];
  const bespoke = new Map<string, ResolvedBespokeTool>();

  const take = (resolved: ReturnType<typeof resolveExpose>): void => {
    resources.push(...resolved.resources);
    resourceTemplates.push(...resolved.resourceTemplates);
    tools.push(...resolved.tools);
  };

  if (bundle.core !== undefined) {
    take(resolveExpose(bundle.core.surface.spec, bundle.core.expose));
  }
  // Sorted, so the tables — and therefore `tools/list` and `resources/list` —
  // read the same for the same roster however the caller's object was built.
  // An MCP host renders these in order; a set that reshuffles on a reroster that
  // changed nothing about a given sibling is noise an agent has to re-read.
  for (const key of [...siblingKeys].sort()) {
    const sibling = siblings[key] as McpSibling<SurfaceSpec>;
    take(resolveExpose(sibling.surface.spec, sibling.expose, key));
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
  takeBespoke(undefined, bundle.tools);
  for (const key of [...siblingKeys].sort()) {
    takeBespoke(key, (siblings[key] as McpSibling<SurfaceSpec>).tools);
  }

  return {
    resources,
    resourceTemplates,
    tools,
    bespoke,
    siblings: new Set(siblingKeys),
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
