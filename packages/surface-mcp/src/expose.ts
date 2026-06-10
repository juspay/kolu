/**
 * The curation gate — default-deny `expose` map + the resolver that turns it
 * into the concrete resource/tool lists the server registers.
 *
 * The Atlas note's thesis: the map is a morning, the *selection* is the
 * project. Nothing reaches an agent until the surface author opts it in.
 * Membership is the allowlist — an omitted primitive/procedure is NOT
 * exposed, full stop. The keys are typed against the spec where tractable
 * (procedures key as `"<ns>.<verb>"`, primitives by their surface key), with
 * a runtime existence check so a stringly-typed key that the compiler can't
 * narrow still fails loudly at boot rather than silently registering nothing.
 *
 *   - a Cell      → resource `surface://cells/<key>`
 *   - a Collection→ resource `surface://collections/<key>` (the key set) +
 *                   a template `surface://collections/<key>/{id}`
 *   - a Stream    → resource `surface://streams/<key>`
 *   - an Event    → resource `surface://events/<key>`
 *   - a procedure → tool `<ns>_<verb>` (`.` is illegal in a tool name; the
 *                   wire path stays `<ns>.<verb>`)
 */

import type { SurfaceSpec } from "@kolu/surface/define";
import type { ZodType } from "zod";
import { inputSchema } from "./jsonschema";

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

/** How a procedure is exposed: a plain tool, or a tool flagged as mutating
 *  (the authz bit the host can surface as a write capability). */
export type ToolExposure = "tool" | { tool: { mutates?: boolean } };

/** The default-deny allowlist. Keys are constrained to the spec's own
 *  primitives/procedures; omission means *not exposed*. A primitive maps to
 *  `"resource"`; a procedure to a `ToolExposure`.
 *
 *  Typed against `S` where the compiler can narrow; falls back to a `string`
 *  index so a key the generics can't enumerate (a heavily-composed spec)
 *  still type-checks and is validated at runtime against the live spec. */
export type ExposeMap<S extends SurfaceSpec = SurfaceSpec> = {
  [K in ProcedureName<S>]?: ToolExposure;
} & {
  [K in ResourceCellName<S> | CollectionName<S>]?: "resource";
} & {
  // Loosen-to-string escape hatch (noted in the report): keys the mapped
  // types above can't enumerate stay assignable, and `resolveExpose` checks
  // each against the spec at boot.
  [key: string]: ToolExposure | "resource" | undefined;
};

// ── Resolved registration lists ─────────────────────────────────────────

/** A static resource (cell / collection key-set / stream / event). */
export interface ResourceEntry {
  uri: string;
  /** Which primitive kind backs it — drives how the pusher streams updates
   *  and how `ReadResource` produces a snapshot. */
  kind: "cell" | "collection" | "stream" | "event";
  /** The surface key (e.g. `nodes`), independent of the URI encoding. */
  key: string;
  name: string;
  mimeType: string;
}

/** A `surface://collections/<key>/{id}` template — one per exposed
 *  collection, alongside its key-set `ResourceEntry`. */
export interface ResourceTemplateEntry {
  uriTemplate: string;
  key: string;
  name: string;
  mimeType: string;
  /** The collection's key schema — used to decode an item-template URI's
   *  `<id>` segment (a string) back into the collection's actual key type
   *  before calling `.get({ key })`. A `keySchema: z.number()` collection
   *  must turn the string `"42"` into `42`, not address item `"42"`. */
  // biome-ignore lint/suspicious/noExplicitAny: opaque zod schema carried for runtime key decoding.
  keySchema: ZodType<any>;
}

/** A tool backed by an exposed procedure. */
export interface ToolEntry {
  /** MCP tool name (`<ns>_<verb>`). */
  name: string;
  /** Surface namespace + verb — the wire call `client.surface[ns][verb]`. */
  ns: string;
  verb: string;
  mutates: boolean;
  inputSchema: Record<string, unknown>;
  /** Whether the procedure declares an input. A no-input procedure's contract
   *  is `oc.input(z.void())`, which rejects `{}` — so the dispatcher must call
   *  it with `undefined`, not the empty args object. */
  hasInput: boolean;
  /** Whether the input schema wrapped a non-object (scalar/array/union) input
   *  under a `value` property to satisfy MCP. The dispatcher must unwrap
   *  `args.value` before handing it to the procedure's zod, which expects the
   *  bare value (a `z.string()` input is advertised as `{ value: string }`). */
  wrapped: boolean;
}

export interface ResolvedExpose {
  resources: ResourceEntry[];
  resourceTemplates: ResourceTemplateEntry[];
  tools: ToolEntry[];
}

// ── URI helpers ─────────────────────────────────────────────────────────

export const CELL_PREFIX = "surface://cells/";
export const COLLECTION_PREFIX = "surface://collections/";
export const STREAM_PREFIX = "surface://streams/";
export const EVENT_PREFIX = "surface://events/";

export function cellUri(key: string): string {
  return `${CELL_PREFIX}${encodeURIComponent(key)}`;
}
export function collectionUri(key: string): string {
  return `${COLLECTION_PREFIX}${encodeURIComponent(key)}`;
}
export function collectionItemTemplate(key: string): string {
  return `${COLLECTION_PREFIX}${encodeURIComponent(key)}/{id}`;
}
export function streamUri(key: string): string {
  return `${STREAM_PREFIX}${encodeURIComponent(key)}`;
}
export function eventUri(key: string): string {
  return `${EVENT_PREFIX}${encodeURIComponent(key)}`;
}

/** The tool name for a procedure — `<ns>_<verb>` (`.` is illegal in an MCP
 *  tool name). */
export function toolName(ns: string, verb: string): string {
  return `${ns}_${verb}`;
}

// ── Resolver ─────────────────────────────────────────────────────────────

/** Walk a spec + expose map, producing the concrete lists to register. Every
 *  exposed key is checked against the live spec — a key that names no
 *  primitive/procedure is a boot-time error, not a silent no-op. */
export function resolveExpose<S extends SurfaceSpec>(
  spec: S,
  expose: ExposeMap<S>,
): ResolvedExpose {
  const resources: ResourceEntry[] = [];
  const resourceTemplates: ResourceTemplateEntry[] = [];
  const tools: ToolEntry[] = [];

  const cells = spec.cells ?? {};
  const collections = spec.collections ?? {};
  const streams = spec.streams ?? {};
  const events = spec.events ?? {};
  const procedures = spec.procedures ?? {};

  for (const [key, exposure] of Object.entries(
    expose as Record<string, ToolExposure | "resource" | undefined>,
  )) {
    if (exposure === undefined) continue;

    // A dotted key names a procedure (`<ns>.<verb>`); anything else names a
    // primitive by its surface key.
    const dot = key.indexOf(".");
    if (dot !== -1) {
      const ns = key.slice(0, dot);
      const verb = key.slice(dot + 1);
      const procSpec = procedures[ns]?.[verb];
      if (procSpec === undefined) {
        throw new Error(
          `surface-mcp: expose names procedure "${key}" but the spec has no such procedure`,
        );
      }
      if (exposure === "resource") {
        throw new Error(
          `surface-mcp: procedure "${key}" is exposed as "resource"; procedures map to tools`,
        );
      }
      const mutates =
        typeof exposure === "object" ? (exposure.tool.mutates ?? false) : false;
      const built = inputSchema(procSpec.input);
      tools.push({
        name: toolName(ns, verb),
        ns,
        verb,
        mutates,
        inputSchema: built.schema,
        hasInput: procSpec.input !== undefined,
        wrapped: built.wrapped,
      });
      continue;
    }

    // A primitive — must be exposed as a resource.
    if (exposure !== "resource") {
      throw new Error(
        `surface-mcp: primitive "${key}" must be exposed as "resource", not a tool`,
      );
    }
    if (key in cells) {
      resources.push({
        uri: cellUri(key),
        kind: "cell",
        key,
        name: key,
        mimeType: "application/json",
      });
    } else if (key in collections) {
      const collSpec = collections[key] as { keySchema: ZodType };
      resources.push({
        uri: collectionUri(key),
        kind: "collection",
        key,
        name: key,
        mimeType: "application/json",
      });
      resourceTemplates.push({
        uriTemplate: collectionItemTemplate(key),
        key,
        name: `${key} item`,
        mimeType: "application/json",
        keySchema: collSpec.keySchema,
      });
    } else if (key in streams) {
      // A stream is a static resource only if its input accepts being called
      // with no argument — `surface://streams/<key>` carries no input, so the
      // adapter reads/subscribes it via `.get(undefined)`. A stream whose
      // `inputSchema` *requires* an argument (e.g. `z.object({ id })`) can't
      // be a single static resource; reject it at boot rather than register a
      // resource that fails validation on every read/subscribe. (An
      // input-bearing stream belongs behind a projection that fixes the
      // input, or a future resource-template encoding.)
      const streamSpec = streams[key] as { inputSchema: ZodType };
      const accepts = streamSpec.inputSchema.safeParse(undefined).success;
      if (!accepts) {
        throw new Error(
          `surface-mcp: stream "${key}" requires an input, so it can't be exposed as a static resource ` +
            `(surface://streams/${key} carries no input). Project it to a no-input stream, or expose a fixed-input view.`,
        );
      }
      resources.push({
        uri: streamUri(key),
        kind: "stream",
        key,
        name: key,
        mimeType: "application/json",
      });
    } else if (key in events) {
      resources.push({
        uri: eventUri(key),
        kind: "event",
        key,
        name: key,
        mimeType: "application/json",
      });
    } else {
      throw new Error(
        `surface-mcp: expose names "${key}" but the spec has no such cell/collection/stream/event`,
      );
    }
  }

  // Two distinct procedures whose `<ns>_<verb>` collapse to the same MCP tool
  // name (e.g. `a.b_c` and `a_b.c`, or `a.b` exposed twice) would silently
  // produce duplicate `tools/list` entries and an ambiguous dispatch. Catch it
  // at boot, naming both source procedures.
  const byToolName = new Map<string, string>();
  for (const t of tools) {
    const source = `${t.ns}.${t.verb}`;
    const prior = byToolName.get(t.name);
    if (prior !== undefined) {
      throw new Error(
        `surface-mcp: tool name "${t.name}" is produced by both "${prior}" and "${source}" — rename one procedure`,
      );
    }
    byToolName.set(t.name, source);
  }

  return { resources, resourceTemplates, tools };
}
