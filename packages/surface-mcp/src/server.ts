/**
 * `serveSurfaceAsMcp` — re-expose any `@kolu/surface` as an MCP server.
 *
 * Built on the SDK's low-level `Server` (not `McpServer`) for the same two
 * reasons odu's hand-built face was: full control over `resources/subscribe`
 * + `notifications/resources/updated` (McpServer doesn't manage per-resource
 * subscriptions), and JSON-Schema tool inputs driven by the surface's own zod
 * (no coupling to the SDK's schema layer, which has regressed to emitting
 * `$ref`).
 *
 * Default-deny: ONLY the primitives/procedures named in `expose`, plus the
 * hand-authored `tools`, reach the host. An omitted primitive is unreachable.
 *
 * The generic spine does the heavy lifting:
 *   - `resolveExpose` → the concrete resource/template/tool lists.
 *   - `ResourcePusher` → the subscribe/teardown lifecycle.
 *   - `toInputSchema` (inside `resolveExpose`) → each tool's JSON Schema.
 */

import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ZodType } from "zod";
import {
  COLLECTION_PREFIX,
  type ExposeMap,
  type ResourceEntry,
  resolveExpose,
} from "./expose";
import { inputSchema } from "./jsonschema";
import { ResourcePusher } from "./pusher";
import { type BespokeTool, fail, ok, type ToolResult } from "./tools";

/** The structural shape of a served-surface client the adapter needs. The
 *  concrete client is `ContractRouterClient<typeof surface.contract>` (what
 *  `directLink` / the wire links return) — `.surface.<key>.<verb>(...)`.
 *
 *  Declared locally rather than reusing `@kolu/surface`'s `SurfaceClientLike`
 *  because dispatch string-indexes then *calls* the leaves
 *  (`client.surface[key].get(...)`), which `SurfaceClientLike`'s `unknown`
 *  leaves forbid; and re-materializing the precise `SurfaceClientOf<S>` here
 *  overflows TS's union budget (the TS2590 dodge — cf. compose.test.ts:70-73).
 *  Hence a callable-leaved structural shape: permissive enough that a concrete
 *  `ContractRouterClient` assigns without a cast, yet callable at the leaf. */
export type SurfaceClientCallable = {
  // biome-ignore lint/suspicious/noExplicitAny: the per-key call shape is the consumer's typed client; opaque here.
  surface: Record<string, Record<string, (...args: any[]) => any>>;
};

/** What `opts.client()` may return. Either a bare client (the in-process
 *  `directLink` case — nothing to dispose) or an *owned connection*
 *  `{ client, dispose }` (the bridge case — `unixSocketLink` opens a socket it
 *  owns, so `dispose()` must close it). The adapter normalizes both, disposes
 *  every connection it opens on teardown, and re-dials after a drop. */
export type ClientOrConnection<_S extends SurfaceSpec> =
  | SurfaceClientCallable
  | { client: SurfaceClientCallable; dispose: () => void };

export interface ServeSurfaceAsMcpOptions<S extends SurfaceSpec> {
  surface: Surface<S>;
  /** Live-client factory. Bridge case: dial the served surface (return
   *  `{ client, dispose }` so the adapter can close the socket it owns).
   *  Serve-fresh case: a `directLink` over an in-process implementation
   *  (return the bare client — nothing to dispose). Re-invoked on retry after
   *  a drop, and re-dialed for reads/tools after a transport failure. */
  client: () => ClientOrConnection<S> | Promise<ClientOrConnection<S>>;
  /** Default-deny allowlist — what an agent may touch. */
  expose: ExposeMap<S>;
  /** Hand-authored, call-shaped MCP tools composing over the live client. */
  tools?: Record<string, BespokeTool>;
  serverInfo?: { name: string; version: string };
  /** Transport to connect. Defaults to a `StdioServerTransport`; injectable
   *  for tests (an `InMemoryTransport` half). */
  transport?: Transport;
}

const DEFAULT_SERVER_INFO = { name: "surface-mcp", version: "0.1.0" };

/** Build + connect an MCP server that re-exposes `surface`. Returns the
 *  low-level `Server` and a `close()` that stops the pusher and disconnects
 *  the transport. */
export async function serveSurfaceAsMcp<S extends SurfaceSpec>(
  opts: ServeSurfaceAsMcpOptions<S>,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const resolved = resolveExpose(opts.surface.spec, opts.expose);
  const bespoke = opts.tools ?? {};
  // Resolve each bespoke tool to a record carrying its computed `inputSchema`
  // result alongside the tool — the same way `ToolEntry` carries its schema for
  // exposed procedures — so both tools/list and dispatch read one shape. The
  // `inputSchema(t.input)` pass (zod→JSON-Schema + dereference) runs once here:
  // `tools/list` reads `schema`, and dispatch reads `wrapped` (a scalar/array/
  // union input is advertised wrapped under `value`, so dispatch unwraps
  // `args.value` before parsing). Computing it per request would re-run the full
  // pass each time.
  const bespokeTools = new Map<
    string,
    { tool: BespokeTool; schema: Record<string, unknown>; wrapped: boolean }
  >(
    Object.entries(bespoke).map(([name, t]) => [
      name,
      { tool: t, ...inputSchema(t.input) },
    ]),
  );

  // The whole tool namespace's uniqueness invariant in one place: the union of
  // generated tool names (`resolveExpose`) and bespoke tool names must have no
  // duplicate. A collision would put two entries in `tools/list` and make
  // dispatch order-dependent. This single pass subsumes proc-vs-proc (two
  // procedures whose `<ns>_<verb>` collapse to one name, e.g. `a.b_c` / `a_b.c`,
  // or `a.b` exposed twice), proc-vs-bespoke, and bespoke-vs-bespoke — each
  // candidate tagged by its origin so the error names both colliding sources.
  const sourceByToolName = new Map<string, string>();
  const assertUniqueToolName = (name: string, source: string): void => {
    const prior = sourceByToolName.get(name);
    if (prior !== undefined) {
      throw new Error(
        `surface-mcp: tool name "${name}" is produced by both ${prior} and ${source} — rename one`,
      );
    }
    sourceByToolName.set(name, source);
  };
  for (const t of resolved.tools)
    assertUniqueToolName(t.name, `procedure ${t.ns}.${t.verb}`);
  for (const name of Object.keys(bespoke))
    assertUniqueToolName(name, `bespoke ${name}`);

  const server = new Server(opts.serverInfo ?? DEFAULT_SERVER_INFO, {
    capabilities: { tools: {}, resources: { subscribe: true } },
  });

  // Normalize whatever `opts.client()` returns into an owned connection. The
  // bare-client (in-process `directLink`) case gets a no-op disposer; the
  // `{ client, dispose }` (bridge) case keeps its socket-closing disposer.
  const dial = async (): Promise<{
    client: SurfaceClientCallable;
    dispose: () => void;
  }> => {
    const result = await opts.client();
    if (
      typeof result === "object" &&
      result !== null &&
      "client" in result &&
      "dispose" in result
    ) {
      return result;
    }
    return { client: result as SurfaceClientCallable, dispose: () => {} };
  };

  // ── A single shared connection for reads + bespoke tools ───────────────
  // The pusher manages its own (re-)attaching connection for the streaming
  // subscription face; reads and tool calls dial on demand. We memoize one
  // connection for the lifetime so reads/tools don't re-dial per call (the
  // bridge case's factory may open a socket each time). On a read/tool
  // failure (which a transport drop manifests as) we reset it so the NEXT
  // call re-dials a fresh connection rather than reusing a dead socket.
  let sharedConn: {
    client: SurfaceClientCallable;
    dispose: () => void;
  } | null = null;
  const getClient = async (): Promise<SurfaceClientCallable> => {
    if (sharedConn === null) sharedConn = await dial();
    return sharedConn.client;
  };
  const resetSharedConn = (): void => {
    const conn = sharedConn;
    sharedConn = null;
    conn?.dispose();
  };
  // The failure-reset policy in one place: any shared-connection use that
  // throws (a transport drop manifests as a thrown call) drops the connection
  // so the NEXT call re-dials a fresh one rather than reusing a dead socket.
  // Every read/tool path goes through here, so the policy can't be omitted at a
  // new call site.
  const withClient = async <R>(
    fn: (client: SurfaceClientCallable) => Promise<R>,
  ): Promise<R> => {
    const client = await getClient();
    try {
      return await fn(client);
    } catch (e) {
      resetSharedConn();
      throw e;
    }
  };

  // Index resources by URI for O(1) read/subscribe dispatch.
  const byUri = new Map<string, ResourceEntry>();
  for (const r of resolved.resources) byUri.set(r.uri, r);
  // Index collection key schemas by surface key for item-template key decode.
  const keySchemaByCollection = new Map<string, ZodType>();
  for (const t of resolved.resourceTemplates) {
    keySchemaByCollection.set(t.key, t.keySchema);
  }

  // ── ResourcePusher (subscribe/teardown lifecycle) ──────────────────────
  // The pusher dials its own connections (one per attach). We track each
  // connection's disposer by client identity so the pusher's `dispose(client)`
  // hook can close the socket it opened — without this the bridge case leaks a
  // socket on every detach.
  const pusherDisposers = new WeakMap<object, () => void>();
  const pusher = new ResourcePusher<SurfaceClientCallable>({
    notify: (uri) => {
      server.sendResourceUpdated({ uri }).catch((err) => {
        // Transport may already be closed (e.g. client disconnected between the
        // delta arriving and the notification send). Swallow silently — the
        // client is gone and can't receive the update anyway.
        console.error("surface-mcp: sendResourceUpdated failed", err);
      });
    },
    client: async () => {
      const conn = await dial();
      pusherDisposers.set(conn.client as object, conn.dispose);
      return conn.client;
    },
    stream: (client, uri, signal) =>
      streamForUri(client, uri, byUri, keySchemaByCollection, signal),
    dispose: (client) => {
      const d = pusherDisposers.get(client as object);
      if (d !== undefined) {
        pusherDisposers.delete(client as object);
        d();
      }
    },
    // A swallowed dial/stream failure here would otherwise be invisible; the
    // pusher still retries, but surface it to stderr so a perpetually-failing
    // bridge is diagnosable. (stdout is the MCP protocol channel — never log
    // there.)
    onError: (err) => {
      console.error("surface-mcp: pusher stream/dial error", err);
    },
  });

  // ── tools/list ─────────────────────────────────────────────────────────
  // `annotations` carry the read/write distinction to the host: a read-only
  // tool (`readOnlyHint`) can be auto-approved or surfaced separately from a
  // mutating one (`destructiveHint`). Without these the `mutates` flag the API
  // and docs promise never reaches the host.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...resolved.tools.map((t) => ({
        name: t.name,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: !t.mutates, destructiveHint: t.mutates },
      })),
      ...[...bespokeTools].map(([name, { tool, schema }]) => ({
        name,
        description: tool.description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: !(tool.mutates ?? false),
          destructiveHint: tool.mutates ?? false,
        },
      })),
    ],
  }));

  // ── tools/call ───────────────────────────────────────────────────────--
  const toolByName = new Map(resolved.tools.map((t) => [t.name, t]));
  const callTool = async (
    req: { params: { name: string; arguments?: Record<string, unknown> } },
    extra: { signal: AbortSignal },
  ): Promise<ToolResult> => {
    const { name, arguments: rawArgs } = req.params;
    const args = rawArgs ?? {};
    try {
      const exposed = toolByName.get(name);
      if (exposed !== undefined) {
        return withClient(async (client) => {
          const proc = client.surface[exposed.ns]?.[exposed.verb];
          if (proc === undefined) {
            return fail(
              `surface-mcp: client has no procedure "${exposed.ns}.${exposed.verb}"`,
            );
          }
          // A no-input procedure's contract is `oc.input(z.void())`, which
          // rejects an empty `{}` — call it with `undefined` instead. A
          // scalar/array/union input was advertised wrapped under `value`
          // (`toInputSchema`), so unwrap it back to the bare value the
          // procedure's zod expects.
          const callArgs = exposed.hasInput
            ? unwrapArgs(exposed.wrapped, args)
            : undefined;
          const out = await proc(callArgs, { signal: extra.signal });
          return ok(out);
        });
      }
      const entry = bespokeTools.get(name);
      if (entry !== undefined) {
        const { tool } = entry;
        // Bespoke inputs are advertised through the same `toInputSchema`, so a
        // scalar/array/union input is also wrapped under `value` — unwrap
        // before parsing with the tool's own zod.
        const rawInput = unwrapArgs(entry.wrapped, args);
        const parsed =
          tool.input !== undefined ? tool.input.parse(rawInput) : rawInput;
        return withClient(async (client) => {
          const out = await tool.handler(parsed, client, extra.signal);
          return ok(out);
        });
      }
      return fail(`surface-mcp: unknown tool "${name}"`);
    } catch (e) {
      return failFrom(e);
    }
  };
  server.setRequestHandler(
    CallToolRequestSchema,
    // `ToolResult` is the closed, public result shape; the SDK's
    // `CallToolResult` adds a `[x: string]: unknown` loose index (and a
    // task-result union branch) our value satisfies structurally.
    (req, extra) =>
      callTool(req, { signal: extra.signal }) as Promise<CallToolResult>,
  );

  // ── resources/list ─────────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resolved.resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mimeType,
    })),
  }));

  // ── resources/templates/list ───────────────────────────────────────────
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: resolved.resourceTemplates.map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      mimeType: t.mimeType,
    })),
  }));

  // ── resources/read ─────────────────────────────────────────────────────
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;
    const snapshot = await withClient((client) =>
      readSnapshot(client, uri, byUri, keySchemaByCollection),
    );
    if (snapshot === undefined) {
      throw new Error(`surface-mcp: unknown resource "${uri}"`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: snapshot.mimeType,
          text: JSON.stringify(snapshot.value, null, 2),
        },
      ],
    };
  });

  // ── resources/subscribe + unsubscribe ──────────────────────────────────
  server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    const { uri } = req.params;
    // Only the resources we actually serve. Storing an unknown URI would
    // leave the pusher attached/retrying for something it can never push.
    if (!isSubscribable(uri, byUri)) {
      throw new Error(
        `surface-mcp: cannot subscribe to unknown resource "${uri}"`,
      );
    }
    pusher.subscribe(uri);
    return {};
  });
  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    pusher.unsubscribe(req.params.uri);
    return {};
  });

  // ── Connect ────────────────────────────────────────────────────────────
  const transport = opts.transport ?? new StdioServerTransport();
  await server.connect(transport);

  const close = async (): Promise<void> => {
    pusher.stop();
    resetSharedConn();
    await server.close();
  };
  server.onclose = () => {
    pusher.stop();
    resetSharedConn();
  };

  return { server, close };
}

// ── URI → stream / snapshot resolution ───────────────────────────────────

/** Parse a collection-item template URI (`surface://collections/<key>/<id>`)
 *  into its `(key, id)` — or `null` for any other URI. */
function parseCollectionItem(uri: string): { key: string; id: string } | null {
  if (!uri.startsWith(COLLECTION_PREFIX)) return null;
  const rest = uri.slice(COLLECTION_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  try {
    const key = decodeURIComponent(rest.slice(0, slash));
    const id = decodeURIComponent(rest.slice(slash + 1));
    if (key === "" || id === "") return null;
    return { key, id };
  } catch {
    return null;
  }
}

/** Whether `uri` resolves to something the pusher can subscribe to: a listed
 *  static resource, or a well-formed collection-item template instance. */
function isSubscribable(
  uri: string,
  byUri: Map<string, ResourceEntry>,
): boolean {
  if (byUri.has(uri)) return true;
  const item = parseCollectionItem(uri);
  if (item === null) return false;
  // Only subscribable if its collection is exposed (its key-set resource is
  // in the index under the collection prefix).
  return byUri.has(`${COLLECTION_PREFIX}${encodeURIComponent(item.key)}`);
}

interface ResolvedCall {
  proc: (
    // biome-ignore lint/suspicious/noExplicitAny: an opaque method on the consumer's typed client — args are bivariant here by design.
    ...args: any[]
  ) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
  input: unknown;
  mimeType: string;
  /** Which primitive kind backs the URI — `event` has no snapshot, so a
   *  one-shot read must not block on a first frame. */
  kind: ResourceEntry["kind"] | "collection-item";
}

/** Resolve a resource URI to its streaming call on the client: which key, the
 *  verb (`get`/`keys`), the input, and the mime type — one source of truth for
 *  both the live subscription (`streamForUri`) and the one-shot read
 *  (`readSnapshot`). Returns `undefined` for a URI that doesn't resolve.
 *
 *  Cells/streams/events read via `.get(undefined)` (their contract has either
 *  no input or `z.void()` — an empty `{}` would fail validation); a
 *  collection's key-set via `.keys(undefined)`; a collection item via
 *  `.get({ key })`, where `key` is the URI's `<id>` segment decoded through the
 *  collection's key schema (so a `z.number()` key addresses item `42`, not
 *  `"42"`). */
function resolveCall<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  keySchemaByCollection: Map<string, ZodType>,
): ResolvedCall | undefined {
  const entry = byUri.get(uri);
  if (entry !== undefined) {
    const ns = client.surface[entry.key];
    if (ns === undefined) return undefined;
    const proc = entry.kind === "collection" ? ns.keys : ns.get;
    if (proc === undefined) return undefined;
    return {
      proc,
      input: undefined,
      mimeType: entry.mimeType,
      kind: entry.kind,
    };
  }
  const item = parseCollectionItem(uri);
  if (item !== null) {
    const ns = client.surface[item.key];
    const proc = ns?.get;
    if (proc === undefined) return undefined;
    const keySchema = keySchemaByCollection.get(item.key);
    // Decode the URI's string `<id>` into the collection's key type via the one
    // rule keyed off the schema's type: a string key passes straight through; a
    // `z.number()` / `z.boolean()` key parses from its JSON form (`"42"` → `42`).
    // A value that fails its key schema is an addressing error — leave it
    // `undefined` so the call resolves nothing.
    const key =
      keySchema !== undefined ? decodeKey(keySchema, item.id) : item.id;
    if (key === undefined) return undefined;
    return {
      proc,
      input: { key },
      mimeType: "application/json",
      kind: "collection-item",
    };
  }
  return undefined;
}

/** Decode a collection item URI's string `<id>` segment into the collection's
 *  declared key type. Always tries the segment verbatim first — this covers
 *  `z.string()`, `z.literal("foo")`, `z.enum(["a","b"])`, and any other
 *  string-accepting schema. If the verbatim parse fails, falls back to
 *  `JSON.parse(id)` and re-validates — this covers numeric (`z.number()`) and
 *  boolean keys whose URI encoding is their JSON form (`"42"` → `42`). A value
 *  that fails both paths returns `undefined` so the caller treats it as an
 *  unaddressable item rather than calling `.get` with a wrong-typed key. */
function decodeKey(keySchema: ZodType, id: string): unknown {
  const direct = keySchema.safeParse(id);
  if (direct.success) return direct.data;
  let parsed: unknown;
  try {
    parsed = JSON.parse(id);
  } catch {
    return undefined; // not JSON — unaddressable for a non-string key
  }
  const decoded = keySchema.safeParse(parsed);
  return decoded.success ? decoded.data : undefined;
}

/** Open the streaming source for a subscribed URI (the pusher's `StreamFor`).
 *  Returns `undefined` for a URI that doesn't resolve so the pusher drops it. */
function streamForUri<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  keySchemaByCollection: Map<string, ZodType>,
  signal: AbortSignal | undefined,
): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown> | undefined {
  const call = resolveCall(client, uri, byUri, keySchemaByCollection);
  if (call === undefined) return undefined;
  return call.proc(call.input, { signal });
}

interface Snapshot {
  value: unknown;
  mimeType: string;
}

/** Read a one-shot snapshot for a resource URI: pull the first frame of the
 *  primitive's streaming source and return immediately.
 *
 *  An **event** has no snapshot by contract (`EventHandlerDeps` may yield zero
 *  frames, and a late subscriber misses past occurrences). Awaiting its first
 *  frame would block `resources/read` forever or until the next occurrence, so
 *  an event reads as an immediate explicit `null` — its live value is the
 *  `notifications/resources/updated` stream, delivered via `resources/subscribe`,
 *  not a readable snapshot. */
async function readSnapshot<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  keySchemaByCollection: Map<string, ZodType>,
): Promise<Snapshot | undefined> {
  const call = resolveCall(client, uri, byUri, keySchemaByCollection);
  if (call === undefined) return undefined;
  if (call.kind === "event") return { value: null, mimeType: call.mimeType };
  const source = await call.proc(call.input);
  // An MCP snapshot reads as JSON `null` (never `undefined`) when the source has
  // no current value, so coerce the empty-stream `undefined` to `null` here.
  const value =
    source === undefined || source === null
      ? null
      : ((await firstFrameOrUndefined(source as AsyncIterable<unknown>)) ??
        null);
  return { value, mimeType: call.mimeType };
}

/** Undo the `enforceObject` wrapping before handing args to a procedure/tool's
 *  zod. A non-object input (scalar/array/union) is advertised wrapped under a
 *  single `value` property; `wrapped` is the bit `inputSchema` reports for that
 *  case. The one place this rule lives, called by both dispatch branches. */
function unwrapArgs(wrapped: boolean, args: Record<string, unknown>): unknown {
  return wrapped ? args.value : args;
}

/** Coerce an unknown thrown value into a failed `ToolResult`. */
function failFrom(e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return fail(`surface-mcp: ${message}`);
}
