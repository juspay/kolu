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
import {
  COLLECTION_PREFIX,
  type ExposeMap,
  type ResourceEntry,
  resolveExpose,
} from "./expose";
import { toInputSchema } from "./jsonschema";
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

export interface ServeSurfaceAsMcpOptions<S extends SurfaceSpec> {
  surface: Surface<S>;
  /** Live-client factory. Bridge case: dial the served surface. Serve-fresh
   *  case: a `directLink` over an in-process implementation. Re-invoked on
   *  retry after a drop. */
  client: () => SurfaceClientOf<S> | Promise<SurfaceClientOf<S>>;
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

  const server = new Server(opts.serverInfo ?? DEFAULT_SERVER_INFO, {
    capabilities: { tools: {}, resources: { subscribe: true } },
  });

  // ── A single shared client for reads + bespoke tools ───────────────────
  // The pusher manages its own (re-)attaching client for the streaming
  // subscription face; reads and tool calls dial on demand via the factory.
  // We memoize one client for the lifetime so reads/tools don't re-dial per
  // call (the bridge case's factory may open a socket each time).
  let sharedClient: SurfaceClientOf<S> | null = null;
  const getClient = async (): Promise<SurfaceClientOf<S>> => {
    if (sharedClient === null) sharedClient = await opts.client();
    return sharedClient;
  };

  // Index resources by URI for O(1) read/subscribe dispatch.
  const byUri = new Map<string, ResourceEntry>();
  for (const r of resolved.resources) byUri.set(r.uri, r);

  // ── ResourcePusher (subscribe/teardown lifecycle) ──────────────────────
  const pusher = new ResourcePusher<SurfaceClientOf<S>>({
    notify: (uri) => {
      void server.sendResourceUpdated({ uri });
    },
    client: () => opts.client(),
    stream: (client, uri, signal) => streamForUri(client, uri, byUri, signal),
  });

  // ── tools/list ─────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...resolved.tools.map((t) => ({
        name: t.name,
        inputSchema: t.inputSchema,
      })),
      ...Object.entries(bespoke).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: toolInputSchema(t),
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
        // rejects an empty `{}` — call it with `undefined` instead.
        const callArgs = exposed.hasInput ? args : undefined;
        const out = await proc(callArgs, { signal: extra.signal });
        return ok(out);
      }
      const tool = bespoke[name];
      if (tool !== undefined) {
        const parsed = tool.input !== undefined ? tool.input.parse(args) : args;
        const client = await getClient();
        const out = await tool.handler(parsed, client, extra.signal);
        return ok(out);
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
    const snapshot = await readSnapshot(client, uri, byUri);
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
    await server.close();
  };
  server.onclose = () => {
    pusher.stop();
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

/** Resolve a resource URI to its streaming call on the client: which key, the
 *  verb (`get`/`keys`), the input, and the mime type — one source of truth for
 *  both the live subscription (`streamForUri`) and the one-shot read
 *  (`readSnapshot`). Returns `undefined` for a URI that doesn't resolve.
 *
 *  Cells/streams/events read via `.get(undefined)` (their contract has either
 *  no input or `z.void()` — an empty `{}` would fail validation); a
 *  collection's key-set via `.keys(undefined)`; a collection item via
 *  `.get({ key })`. */
function resolveCall<Client extends SurfaceClientOf<SurfaceSpec>>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
):
  | {
      // biome-ignore lint/suspicious/noExplicitAny: an opaque method on the consumer's typed client — args are bivariant here by design.
      proc: (
        ...args: any[]
      ) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
      input: unknown;
      mimeType: string;
    }
  | undefined {
  const entry = byUri.get(uri);
  if (entry !== undefined) {
    const ns = client.surface[entry.key];
    if (ns === undefined) return undefined;
    const proc = entry.kind === "collection" ? ns.keys : ns.get;
    if (proc === undefined) return undefined;
    return { proc, input: undefined, mimeType: entry.mimeType };
  }
  const item = parseCollectionItem(uri);
  if (item !== null) {
    const ns = client.surface[item.key];
    const proc = ns?.get;
    if (proc === undefined) return undefined;
    return { proc, input: { key: item.id }, mimeType: "application/json" };
  }
  return undefined;
}

/** Open the streaming source for a subscribed URI (the pusher's `StreamFor`).
 *  Returns `undefined` for a URI that doesn't resolve so the pusher drops it. */
function streamForUri<Client extends SurfaceClientOf<SurfaceSpec>>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  signal: AbortSignal | undefined,
): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown> | undefined {
  const call = resolveCall(client, uri, byUri);
  if (call === undefined) return undefined;
  return call.proc(call.input, { signal });
}

interface Snapshot {
  value: unknown;
  mimeType: string;
}

/** Read a one-shot snapshot for a resource URI: pull the first frame of the
 *  primitive's streaming source and return immediately. */
async function readSnapshot<Client extends SurfaceClientOf<SurfaceSpec>>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
): Promise<Snapshot | undefined> {
  const call = resolveCall(client, uri, byUri);
  if (call === undefined) return undefined;
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
  return toInputSchema(tool.input);
}

/** Coerce an unknown thrown value into a failed `ToolResult`. */
function failFrom(e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return fail(`surface-mcp: ${message}`);
}
