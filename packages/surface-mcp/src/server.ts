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
 *  Declared locally (not imported) because `@orpc/contract` is not a direct
 *  dependency of this sibling package, and `projectSurface`'s public
 *  `SurfaceClientOf<S>` export isn't available yet. INTEGRATOR NOTE: when
 *  `@kolu/surface` exports `SurfaceClientOf<S>`, swap this alias for it. The
 *  structural shape below is intentionally permissive so a concrete
 *  `ContractRouterClient` assigns to it without a cast. */
export type SurfaceClientOf<_S extends SurfaceSpec> = {
  // biome-ignore lint/suspicious/noExplicitAny: the per-key call shape is the consumer's typed client; opaque here.
  surface: Record<string, Record<string, (...args: any[]) => any>>;
};

/** What `opts.client()` may return. Either a bare client (the in-process
 *  `directLink` case — nothing to dispose) or an *owned connection*
 *  `{ client, dispose }` (the bridge case — `unixSocketLink` opens a socket it
 *  owns, so `dispose()` must close it). The adapter normalizes both, disposes
 *  every connection it opens on teardown, and re-dials after a drop. */
export type ClientOrConnection<S extends SurfaceSpec> =
  | SurfaceClientOf<S>
  | { client: SurfaceClientOf<S>; dispose: () => void };

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
  // Precompute each bespoke tool's wrap flag once (running `z.toJSONSchema` per
  // call would be wasteful): a scalar/array/union input is advertised wrapped
  // under `value`, so dispatch must unwrap `args.value` before parsing.
  const bespokeWrap = new Map<string, boolean>();
  for (const [name, t] of Object.entries(bespoke)) {
    bespokeWrap.set(name, bespokeWrapped(t));
  }

  const server = new Server(opts.serverInfo ?? DEFAULT_SERVER_INFO, {
    capabilities: { tools: {}, resources: { subscribe: true } },
  });

  // Normalize whatever `opts.client()` returns into an owned connection. The
  // bare-client (in-process `directLink`) case gets a no-op disposer; the
  // `{ client, dispose }` (bridge) case keeps its socket-closing disposer.
  const dial = async (): Promise<{
    client: SurfaceClientOf<S>;
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
    return { client: result as SurfaceClientOf<S>, dispose: () => {} };
  };

  // ── A single shared connection for reads + bespoke tools ───────────────
  // The pusher manages its own (re-)attaching connection for the streaming
  // subscription face; reads and tool calls dial on demand. We memoize one
  // connection for the lifetime so reads/tools don't re-dial per call (the
  // bridge case's factory may open a socket each time). On a read/tool
  // failure (which a transport drop manifests as) we reset it so the NEXT
  // call re-dials a fresh connection rather than reusing a dead socket.
  let sharedConn: { client: SurfaceClientOf<S>; dispose: () => void } | null =
    null;
  const getClient = async (): Promise<SurfaceClientOf<S>> => {
    if (sharedConn === null) sharedConn = await dial();
    return sharedConn.client;
  };
  const resetSharedConn = (): void => {
    const conn = sharedConn;
    sharedConn = null;
    conn?.dispose();
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
  const pusher = new ResourcePusher<SurfaceClientOf<S>>({
    notify: (uri) => {
      void server.sendResourceUpdated({ uri });
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

  // A generated tool name that collides with a bespoke tool name would put two
  // entries in `tools/list` and make dispatch order-dependent. Reject at boot.
  for (const t of resolved.tools) {
    if (t.name in bespoke) {
      throw new Error(
        `surface-mcp: tool name "${t.name}" is produced by both the exposed procedure "${t.ns}.${t.verb}" and a bespoke tool — rename one`,
      );
    }
  }

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
      ...Object.entries(bespoke).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: toolInputSchema(t),
        annotations: {
          readOnlyHint: !(t.mutates ?? false),
          destructiveHint: t.mutates ?? false,
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
        const client = await getClient();
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
          ? exposed.wrapped
            ? (args as Record<string, unknown>).value
            : args
          : undefined;
        try {
          const out = await proc(callArgs, { signal: extra.signal });
          return ok(out);
        } catch (e) {
          // A transport drop surfaces here — drop the shared connection so the
          // next call re-dials rather than reusing a dead socket.
          resetSharedConn();
          throw e;
        }
      }
      const tool = bespoke[name];
      if (tool !== undefined) {
        // Bespoke inputs are advertised through the same `toInputSchema`, so a
        // scalar/array/union input is also wrapped under `value` — unwrap
        // before parsing with the tool's own zod.
        const rawInput = bespokeWrap.get(name)
          ? (args as Record<string, unknown>).value
          : args;
        const parsed =
          tool.input !== undefined ? tool.input.parse(rawInput) : rawInput;
        const client = await getClient();
        try {
          const out = await tool.handler(parsed, client, extra.signal);
          return ok(out);
        } catch (e) {
          resetSharedConn();
          throw e;
        }
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
    const client = await getClient();
    let snapshot: Snapshot | undefined;
    try {
      snapshot = await readSnapshot(client, uri, byUri, keySchemaByCollection);
    } catch (e) {
      resetSharedConn();
      throw e;
    }
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
function resolveCall<Client extends SurfaceClientOf<SurfaceSpec>>(
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
    // Decode the URI's string `<id>` into the collection's key type. A string
    // key passes straight through; a `z.number()` / `z.boolean()` key parses
    // from its JSON form (`"42"` → `42`). A key that decodes to neither is an
    // addressing error — leave it `undefined` so the call resolves nothing.
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
 *  declared key type. Tries the raw string first (the common case — string
 *  keys), then its JSON form (so a numeric/boolean key round-trips). Returns
 *  `undefined` when neither parses, so the caller treats it as an unaddressable
 *  item rather than calling `.get` with a wrong-typed key. */
function decodeKey(keySchema: ZodType, id: string): unknown {
  const asString = keySchema.safeParse(id);
  if (asString.success) return asString.data;
  try {
    const asJson = keySchema.safeParse(JSON.parse(id));
    if (asJson.success) return asJson.data;
  } catch {
    // not JSON — fall through
  }
  return undefined;
}

/** Open the streaming source for a subscribed URI (the pusher's `StreamFor`).
 *  Returns `undefined` for a URI that doesn't resolve so the pusher drops it. */
function streamForUri<Client extends SurfaceClientOf<SurfaceSpec>>(
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
async function readSnapshot<Client extends SurfaceClientOf<SurfaceSpec>>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  keySchemaByCollection: Map<string, ZodType>,
): Promise<Snapshot | undefined> {
  const call = resolveCall(client, uri, byUri, keySchemaByCollection);
  if (call === undefined) return undefined;
  if (call.kind === "event") return { value: null, mimeType: call.mimeType };
  const source = await call.proc(call.input);
  const value = await firstFrame(source);
  return { value, mimeType: call.mimeType };
}

/** The first frame of a snapshot-then-deltas stream — its current snapshot. */
async function firstFrame(source: unknown): Promise<unknown> {
  if (source === undefined || source === null) return null;
  for await (const frame of source as AsyncIterable<unknown>) {
    return frame;
  }
  return null;
}

/** Compute a bespoke tool's `inputSchema` from its optional zod input. */
function toolInputSchema(tool: BespokeTool): Record<string, unknown> {
  return inputSchema(tool.input).schema;
}

/** Whether a bespoke tool's input was wrapped under `value` (a non-object
 *  scalar/array/union). The dispatcher unwraps `args.value` before parsing. */
function bespokeWrapped(tool: BespokeTool): boolean {
  return inputSchema(tool.input).wrapped;
}

/** Coerce an unknown thrown value into a failed `ToolResult`. */
function failFrom(e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return fail(`surface-mcp: ${message}`);
}
