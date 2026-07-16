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

import {
  firstFrameOfCollectionItem,
  firstFrameOrThrow,
} from "@kolu/surface/first-frame";
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
  //
  // The `mutates → annotations` projection lives HERE, once, so the two tool
  // sources (procedure-derived + bespoke) can't drift on the mapping or on the
  // undefined edge case. Each source normalizes its own `mutates` to a concrete
  // boolean BEFORE calling: procedure tools already carry one (`expose.ts`'s
  // `?? true`), bespoke tools apply the same conservative `?? true` at the call.
  const toolAnnotations = (mutates: boolean) => ({
    readOnlyHint: !mutates,
    destructiveHint: mutates,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...resolved.tools.map((t) => ({
        name: t.name,
        inputSchema: t.inputSchema,
        annotations: toolAnnotations(t.mutates),
      })),
      ...[...bespokeTools].map(([name, { tool, schema }]) => ({
        name,
        description: tool.description,
        inputSchema: schema,
        // Conservative default (see `BespokeTool.mutates`): an absent `mutates`
        // is treated as MUTATING, so an unannotated tool is never advertised as
        // auto-approvable read-only. A genuinely read-only tool opts in with an
        // explicit `mutates: false`. Mirrors `expose.ts`'s `?? true` for
        // procedure tools, so both sources default the same way.
        annotations: toolAnnotations(tool.mutates ?? true),
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
        // `await`, not a bare `return`: a returned promise's REJECTION does not
        // route through this try/catch, so a failing procedure call (e.g. the
        // transport down mid-call) would surface as a protocol-level -32603
        // instead of the `isError` tool result the contract promises.
        return await withClient(async (client) => {
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
        // `await` for the same reason as the exposed-procedure branch above: a
        // rejecting handler must land in `failFrom`, never escape as -32603.
        return await withClient(async (client) => {
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
  // Thread the MCP request's abort signal all the way to the client calls so a
  // one-shot read is bounded by request lifetime — cancelling the read tears
  // down the underlying held-open subscription instead of leaking it.
  server.setRequestHandler(ReadResourceRequestSchema, async (req, extra) => {
    const { uri } = req.params;
    const result = await withClient((client) =>
      readSnapshot(client, uri, byUri, keySchemaByCollection, extra.signal),
    );
    if (isMiss(result)) {
      // A not-yet-present collection key is a well-formed but empty resource, NOT
      // an unknown URI — distinct messages so an agent can tell "this address is
      // wrong" from "this value hasn't arrived yet" (it may appear once its
      // producer reports in; watch it via `resources/subscribe`).
      throw new Error(
        result.miss === "not-present"
          ? `surface-mcp: resource "${uri}" has no value yet — its collection key is not present`
          : `surface-mcp: unknown resource "${uri}"`,
      );
    }
    return {
      contents: [
        {
          uri,
          mimeType: result.mimeType,
          text: JSON.stringify(result.value, null, 2),
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

/** A one-shot read that produced no snapshot, and WHY — so the handler tells a
 *  genuinely unaddressable URI (`unresolved`) apart from a well-formed
 *  collection-item URI whose key is simply not present yet (`not-present`, the
 *  #1681 held-open case). Collapsing both to a bare `undefined` + one "unknown
 *  resource" message hid that distinction (invalid-states-unrepresentable). */
type ReadMiss = { miss: "unresolved" | "not-present" };
function isMiss(r: Snapshot | ReadMiss): r is ReadMiss {
  return "miss" in r;
}

/** Read a one-shot snapshot for a resource URI: pull the first frame of the
 *  primitive's streaming source and return immediately.
 *
 *  The empty-open POLICY depends on the kind's snapshot guarantee:
 *
 *    - **cell / collection / stream** are SNAPSHOT-FIRST
 *      (`@kolu/surface/server` opens a cell/collection with a current-value frame,
 *      and `StreamHandlerDeps` REQUIRES "first yield is a fresh full snapshot"), so
 *      an empty open is a dead/dropped bridge link, NOT an empty value — it
 *      `firstFrameOrThrow`s, never collapses to `null` (the green-dot lie in MCP
 *      form; caught-error-must-not-collapse-to-empty).
 *    - **collection-item** is snapshot-first ONLY when the key currently EXISTS.
 *      A collection's membership is dynamic (a key can be born later), and the
 *      collection `get` now HOLDS OPEN for an absent key instead of throwing (it
 *      yields nothing until the first upsert — the fix for the gray-chip #1681).
 *      That held-open semantic is correct for a LIVE subscription but would make a
 *      one-shot read block forever on a not-yet-born key, so the read resolves
 *      membership from the collection's `keys` snapshot FIRST: an absent key is an
 *      honest not-found (`undefined`), not an indefinite hang; a present key reads
 *      its `get` first frame (which arrives immediately, since present).
 *    - **event** is the ONE kind with no snapshot by contract (`EventHandlerDeps`
 *      explicitly carries no snapshot obligation — it may yield zero frames, and a
 *      late subscriber misses past occurrences — which is what distinguishes Event
 *      from Stream). Awaiting its first frame would block `resources/read` forever or
 *      until the next occurrence, so an event reads as an immediate explicit `null`
 *      — its live value is the `notifications/resources/updated` stream, delivered
 *      via `resources/subscribe`, not a readable snapshot.
 *
 *  `signal` (the MCP request's abort signal) bounds every client call to the
 *  request's lifetime so a cancelled read tears down the underlying subscription. */
async function readSnapshot<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  keySchemaByCollection: Map<string, ZodType>,
  signal: AbortSignal | undefined,
): Promise<Snapshot | ReadMiss> {
  const call = resolveCall(client, uri, byUri, keySchemaByCollection);
  if (call === undefined) return { miss: "unresolved" };
  switch (call.kind) {
    case "event":
      return { value: null, mimeType: call.mimeType };
    // A collection-item read must not lean on the held-open `get` to signal
    // absence — an absent key yields nothing forever — so it gets a BOUNDED read
    // that races the `get` first frame against a live `keys`-absence watch.
    case "collection-item":
      return readCollectionItemSnapshot(
        client,
        uri,
        call,
        keySchemaByCollection,
        signal,
      );
    case "cell":
    case "collection":
    case "stream":
      return readFirstFrameSnapshot(call, uri, signal);
    default: {
      // Exhaustiveness guard: a new `ResolvedCall` kind must add its own case
      // rather than silently falling through to the snapshot-first reader.
      const unreachable: never = call.kind;
      throw new Error(`surface-mcp: unhandled resource kind "${unreachable}"`);
    }
  }
}

/** Open a snapshot-first source (cell / collection / stream / a PRESENT
 *  collection-item) and return its first frame.
 *
 *  cell / collection / collection-item / STREAM are ALL snapshot-first by the
 *  surface contract: `@kolu/surface/server` opens a cell/collection with a
 *  current-value frame, and `StreamHandlerDeps` REQUIRES "first yield is a fresh
 *  full snapshot" — only `Event` carries no snapshot obligation (handled by the
 *  caller as an immediate `null`). So an empty open for any of these is NOT an
 *  empty value — it is a dead/dropped bridge link, and collapsing it to JSON
 *  `null` would hand an MCP agent `surface://<kind>/<x> => null` as if it were
 *  real (the green-dot lie in MCP form, the snapshot-then-delta class). Fail
 *  loudly per caught-error-must-not-collapse-to-empty: a nullish source (the proc
 *  returned nothing) and an empty stream (no snapshot frame) both throw. */
async function readFirstFrameSnapshot(
  call: ResolvedCall,
  uri: string,
  signal: AbortSignal | undefined,
): Promise<Snapshot> {
  const source = await call.proc(call.input, { signal });
  if (source === undefined || source === null) {
    throw new Error(
      `surface-mcp: ${uri} (${call.kind}) resolved no streaming source — the ` +
        `surface contract guarantees a snapshot-first open, so this is a link/` +
        `protocol failure, not an empty value.`,
    );
  }
  const value = await firstFrameOrThrow(
    source as AsyncIterable<unknown>,
    `surface-mcp: ${uri} (${call.kind}) yielded no snapshot frame — the surface ` +
      `contract opens a cell/collection/stream with a current-value snapshot, so an ` +
      `empty open means the bridge link dropped, not that the value is null.`,
  );
  return { value, mimeType: call.mimeType };
}

/** Hard upper bound on a one-shot collection-item read of a **keys-LESS**
 *  collection — one with no `keys` verb, so there is no membership signal to
 *  resolve an absent key against. The read is bounded by this deadline so an
 *  absent key on such a collection is a prompt, explicit not-present (logged),
 *  never the indefinite hang the held-open `get` would otherwise cause. A
 *  keys-bearing collection is bounded by its `keys`-absence watch and never
 *  reaches this. */
const KEYSLESS_ITEM_READ_DEADLINE_MS = 5_000;

/** One-shot read of a collection-item URI. The item `get` HOLDS OPEN for a
 *  not-yet-born key (the #1681 fix), so a one-shot read can't await it blindly —
 *  it delegates to the framework's `firstFrameOfCollectionItem`, which races the
 *  item `get` against a live `keys`-absence watch (or, for a keys-less collection,
 *  a hard deadline) so a present key reads its snapshot and an absent/deleted key
 *  resolves not-found instead of hanging. This wrapper decodes the URI→key, maps
 *  the framework's typed `CollectionItemFrame` onto the MCP `Snapshot | ReadMiss`,
 *  and LOGS the keys-less `"deadline"` absence (an uncertain not-present) so it is
 *  never a silent degrade. */
async function readCollectionItemSnapshot<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  call: ResolvedCall,
  keySchemaByCollection: Map<string, ZodType>,
  signal: AbortSignal | undefined,
): Promise<Snapshot | ReadMiss> {
  const item = parseCollectionItem(uri);
  if (item === null) {
    // Unreachable by construction: `readCollectionItemSnapshot` is called only for
    // a `call.kind === "collection-item"`, which `resolveCall` sets ONLY after
    // `parseCollectionItem(uri)` succeeded on this same URI. Fail LOUD if that
    // invariant is ever broken — never a silent fall-through.
    throw new Error(
      `surface-mcp: ${uri} routed as a collection item but does not parse as one`,
    );
  }
  // `null` (not `undefined`) when the collection exposes no `keys` verb — the
  // framework then bounds the read with the deadline instead of a membership watch.
  const keysProc = client.surface[item.key]?.keys ?? null;
  const keySchema = keySchemaByCollection.get(item.key);
  const key = keySchema !== undefined ? decodeKey(keySchema, item.id) : item.id;

  const frame = await firstFrameOfCollectionItem<unknown>(
    (sig) =>
      call.proc(call.input, { signal: sig }) as Promise<
        AsyncIterable<unknown> | null | undefined
      >,
    keysProc === null
      ? null
      : (sig) =>
          keysProc(undefined, { signal: sig }) as Promise<
            AsyncIterable<unknown>
          >,
    key,
    `surface-mcp: ${uri} (collection-item) yielded no snapshot frame — a PRESENT ` +
      `collection item opens with a current-value snapshot, so an empty open means ` +
      `the bridge link dropped, not that the value is null.`,
    `surface-mcp: ${uri} (collection-item) resolved no streaming source — the ` +
      `surface contract guarantees a snapshot-first open for a present item, so ` +
      `this is a link/protocol failure, not an empty value.`,
    KEYSLESS_ITEM_READ_DEADLINE_MS,
    signal,
  );
  if (!frame.present && frame.reason === "deadline") {
    // A keys-less collection gave no membership signal, so the read fell to its
    // deadline: this not-present is UNCERTAIN (the item may exist but never opened
    // a snapshot in time). Surface it loudly rather than degrading silently.
    console.error(
      `surface-mcp: ${uri} — collection "${item.key}" exposes no \`keys\` verb, so an absent item can't be confirmed; the read hit its ${KEYSLESS_ITEM_READ_DEADLINE_MS}ms deadline and reports not-present`,
    );
  }
  return frame.present
    ? { value: frame.value, mimeType: call.mimeType }
    : { miss: "not-present" };
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
