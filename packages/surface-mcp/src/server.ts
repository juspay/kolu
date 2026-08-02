/**
 * `serveSurfaceAsMcp` — re-expose any `@kolu/surface` as an MCP server.
 *
 * Built on the SDK's low-level `Server` (not `McpServer`) for the same two
 * reasons odu's hand-built face was: full control over `resources/subscribe`
 * + `notifications/resources/updated` (McpServer doesn't manage per-resource
 * subscriptions), and JSON-Schema tool inputs driven by the surface's own
 * Effect Schemas (no coupling to the SDK's schema layer, which has regressed
 * to emitting `$ref`).
 *
 * Default-deny: ONLY the primitives/procedures named in `expose`, plus the
 * hand-authored `tools`, reach the host. An omitted primitive is unreachable.
 *
 * The generic spine does the heavy lifting:
 *   - `resolveExpose` → the concrete resource/template/tool lists.
 *   - `ResourcePusher` → the subscribe/teardown lifecycle.
 *   - `toInputSchema` (inside `resolveExpose`) → each tool's JSON Schema.
 *
 * **The Effect edges, named (PLAN D10/#25).** MCP's SDK is Promise- and
 * callback-shaped, so this module is a genuine process boundary and runs
 * effects at exactly two places: `resources/read` (`Effect.runPromise`, with
 * the MCP request's `AbortSignal` handed straight to the run so a cancelled
 * read INTERRUPTS the subscription it opened), and the `ResourcePusher`'s
 * per-URI subscription fibers (`Effect.runFork`, in `pusher.ts`). Everything
 * else here is already Promise-shaped: a unary member ref returns a Promise
 * (the framework's own `Effect.runPromise` edge on the client face), and a
 * bespoke tool handler is a consumer-supplied async function.
 */

import type { Surface, SurfaceSpec, WireSchemaAny } from "@kolu/surface/define";
import { isDeadTransportError } from "@kolu/surface/errors";
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
import { Effect, Option, Schema, Stream } from "effect";
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
 *  concrete client is what `buildSurfaceFace` mints (`surfaceClientRef`, the
 *  Solid client's `.rpc`, a wire link's face) — `.surface.<key>.<verb>(...)`,
 *  where a streaming verb returns a `Stream` and a unary one a `Promise`.
 *
 *  Declared locally rather than reusing `@kolu/surface`'s `SurfaceFace` because
 *  dispatch string-indexes then *calls* the leaves
 *  (`client.surface[key].get(...)`), which `SurfaceFace`'s `unknown` leaves
 *  forbid; and re-materializing the precise `SurfaceClientOf<S>` here overflows
 *  TS's union budget (the TS2590 dodge — cf. compose.test.ts). Hence a
 *  callable-leaved structural shape: permissive enough that a concrete
 *  `SurfaceClientOf<S>` assigns without a cast, yet callable at the leaf. */
export type SurfaceClientCallable = {
  // biome-ignore lint/suspicious/noExplicitAny: the per-key call shape is the consumer's typed client; opaque here.
  surface: Record<string, Record<string, (...args: any[]) => any>>;
};

/** What `opts.client()` may return. Either a bare client (the in-process
 *  `directDispatch` case — nothing to dispose) or an *owned connection*
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
   *  Serve-fresh case: a `directDispatch` over an in-process implementation
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
  // `inputSchema(t.input)` pass (Schema→JSON-Schema + dereference) runs once
  // here: `tools/list` reads `schema`, and dispatch reads `wrapped` (a
  // scalar/array/union input is advertised wrapped under `value`, so dispatch
  // unwraps `args.value` before decoding). Computing it per request would re-run
  // the full pass each time.
  const bespokeTools = new Map<
    string,
    { tool: BespokeTool; schema: Record<string, unknown>; wrapped: boolean }
  >(
    Object.entries(bespoke).map(([name, t]) => [
      name,
      { tool: t, ...inputSchema(t.input as WireSchemaAny | undefined) },
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
  // bare-client (in-process `directDispatch`) case gets a no-op disposer; the
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
  type OwnedConn = { client: SurfaceClientCallable; dispose: () => void };
  let sharedConn: OwnedConn | null = null;
  // Latched by teardown so a dial that RESOLVES after `close()` disposes its
  // socket instead of publishing an orphan nobody will ever tear down (the
  // adapter's promise: dispose every connection it opens).
  let closed = false;
  // The IN-FLIGHT dial, memoized so two concurrent `getConn()` calls (a
  // long-blocking wait tool beside a read — the kolu-mcp case) share ONE dial
  // instead of each racing `sharedConn === null` across the await and opening
  // (then leaking) a second socket. Cleared once the dial settles.
  let dialing: Promise<OwnedConn> | null = null;
  const getConn = async (): Promise<OwnedConn> => {
    if (sharedConn !== null) return sharedConn;
    if (dialing === null) {
      dialing = dial().then(
        (conn) => {
          dialing = null;
          // Teardown happened while this dial was in flight — dispose the just-
          // opened socket rather than storing it (disposeSharedConn already ran
          // and saw `sharedConn === null`). Reject so a caller mid-`getConn`
          // fails loud instead of running against a socket about to close.
          if (closed) {
            conn.dispose();
            throw new Error("surface-mcp: server closed during dial");
          }
          sharedConn = conn;
          return conn;
        },
        (err) => {
          dialing = null;
          throw err;
        },
      );
    }
    return dialing;
  };
  // Drop a connection ONLY if it is still the current shared one — a concurrent
  // failure must never dispose a fresh successor another call already redialed.
  const resetSharedConn = (conn: OwnedConn): void => {
    if (sharedConn !== conn) return;
    sharedConn = null;
    conn.dispose();
  };
  // Teardown: latch `closed` (so a still-pending dial disposes its own result —
  // see getConn), then dispose whatever connection is current (identity-agnostic
  // — the server is closing, so there is no successor to protect).
  const disposeSharedConn = (): void => {
    closed = true;
    const conn = sharedConn;
    sharedConn = null;
    conn?.dispose();
  };
  // The failure-reset policy in one place. Reset ONLY on a recognized TRANSPORT
  // death — an application error (a bad tool arg, an unknown key, a wrong
  // terminal id) must NOT tear down the shared socket, because a concurrent
  // in-flight tool (a blocking wait_* holding this same connection for its whole
  // duration) would lose its live subscription mid-call. A real transport drop
  // still resets so the next call re-dials rather than reusing a dead socket;
  // the identity guard above keeps that reset from nuking a successor.
  const withClient = async <R>(
    fn: (client: SurfaceClientCallable) => Promise<R>,
  ): Promise<R> => {
    const conn = await getConn();
    try {
      return await fn(conn.client);
    } catch (e) {
      if (isDeadTransportError(e)) resetSharedConn(conn);
      throw e;
    }
  };

  // Index resources by URI for O(1) read/subscribe dispatch.
  const byUri = new Map<string, ResourceEntry>();
  for (const r of resolved.resources) byUri.set(r.uri, r);
  // Index collection key schemas by surface key for item-template key decode.
  const keySchemaByCollection = new Map<string, WireSchemaAny>();
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
    stream: (client, uri) =>
      streamForUri(client, uri, byUri, keySchemaByCollection),
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
          // A no-input procedure's payload schema is `Schema.Void`, which the
          // face calls with `undefined` — an empty `{}` is not the same value. A
          // scalar/array/union input was advertised wrapped under `value`
          // (`toInputSchema`), so unwrap it back to the bare value the
          // procedure's schema expects.
          //
          // The face's unary ref DECODES the argument (D2/#13: a procedure input
          // is a pure argument, so it travels encoded and the face decodes at the
          // edge) — which is exactly where the old `.parse` ran, and is why the
          // MCP host's raw JSON arguments can be handed over verbatim.
          const callArgs = exposed.hasInput
            ? unwrapArgs(exposed.wrapped, args)
            : undefined;
          return ok(await proc(callArgs));
        });
      }
      const entry = bespokeTools.get(name);
      if (entry !== undefined) {
        const { tool } = entry;
        // Bespoke inputs are advertised through the same `toInputSchema`, so a
        // scalar/array/union input is also wrapped under `value` — unwrap
        // before decoding with the tool's own schema. `decodeUnknownSync` throws
        // a `SchemaError` on bad input, which is the fail-fast `.parse` semantic
        // this branch has always had; the catch below turns it into `isError`.
        const rawInput = unwrapArgs(entry.wrapped, args);
        const parsed =
          tool.input !== undefined
            ? Schema.decodeUnknownSync(tool.input)(rawInput)
            : rawInput;
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
  // Hand the MCP request's abort signal to the RUN, not to the calls: under
  // Effect there is no `signal` on a member call, and cancellation is fiber
  // interruption (D10/#18). `Effect.runPromise(_, { signal })` interrupts the
  // read's fiber when the request is cancelled, and the interrupt tears down
  // every subscription the read opened through the streams' own finalizers —
  // the same bound the threaded `AbortSignal` used to provide, expressed once
  // at the edge instead of at every call site.
  server.setRequestHandler(ReadResourceRequestSchema, async (req, extra) => {
    const { uri } = req.params;
    const result = await withClient((client) =>
      Effect.runPromise(
        readSnapshot(client, uri, byUri, keySchemaByCollection),
        { signal: extra.signal },
      ),
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
    disposeSharedConn();
    await server.close();
  };
  server.onclose = () => {
    pusher.stop();
    disposeSharedConn();
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
  /** Open the member's streaming source. LAZY — nothing is dispatched until the
   *  returned stream is run, and the run's fiber owns its lifetime. */
  open: () => Stream.Stream<unknown, unknown>;
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
 *  Cells/streams/events read via `.get(undefined)` (their input is either absent
 *  or `Schema.Void` — an empty `{}` is not that value); a collection's key-set
 *  via `.keys(undefined)`; a collection item via `.get({ key })`, where `key` is
 *  the URI's `<id>` segment decoded through the collection's key schema (so a
 *  `Schema.Finite` key addresses item `42`, not `"42"`). */
function resolveCall<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  keySchemaByCollection: Map<string, WireSchemaAny>,
): ResolvedCall | undefined {
  const entry = byUri.get(uri);
  if (entry !== undefined) {
    const ns = client.surface[entry.key];
    if (ns === undefined) return undefined;
    const proc = entry.kind === "collection" ? ns.keys : ns.get;
    if (proc === undefined) return undefined;
    return {
      open: () => asStream(proc(undefined), uri, entry.kind),
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
    // rule keyed off the schema itself: a string key passes straight through; a
    // numeric/boolean key parses from its JSON form (`"42"` → `42`). A value that
    // fails its key schema is an addressing error — leave it `undefined` so the
    // call resolves nothing.
    const key =
      keySchema !== undefined ? decodeKey(keySchema, item.id) : item.id;
    if (key === undefined) return undefined;
    return {
      open: () => asStream(proc({ key }), uri, "collection-item"),
      mimeType: "application/json",
      kind: "collection-item",
    };
  }
  return undefined;
}

/** Assert that a member ref really handed back a `Stream`.
 *
 *  Every streaming verb on a real face does. What this catches is a DROPPED
 *  BRIDGE: a client whose member resolved to nothing (a stale/partial face over
 *  a dead link) would otherwise reach `Stream.runHead` as `undefined` and blow
 *  up three frames later with a shapeless error, or worse be coerced into an
 *  empty read. The surface contract guarantees a snapshot-first open, so "no
 *  streaming source at all" is a link/protocol failure and is stated as one. */
function asStream(
  source: unknown,
  uri: string,
  kind: ResolvedCall["kind"],
): Stream.Stream<unknown, unknown> {
  if (!Stream.isStream(source)) {
    return Stream.fail(
      new Error(
        `surface-mcp: ${uri} (${kind}) resolved no streaming source — the ` +
          "surface contract guarantees a snapshot-first open, so this is a link/" +
          "protocol failure, not an empty value.",
      ),
    );
  }
  return source as Stream.Stream<unknown, unknown>;
}

/** Decode a collection item URI's string `<id>` segment into the collection's
 *  declared key type. Always tries the segment verbatim first — this covers
 *  `Schema.String`, `Schema.Literal("foo")`, `Schema.Literals(["a","b"])`, and
 *  any other string-accepting schema. If the verbatim decode fails, falls back
 *  to `JSON.parse(id)` and re-decodes — this covers numeric (`Schema.Finite`)
 *  and boolean keys whose URI encoding is their JSON form (`"42"` → `42`). A
 *  value that fails both paths returns `undefined` so the caller treats it as an
 *  unaddressable item rather than calling `.get` with a wrong-typed key.
 *
 *  The DECODED key is what comes back, which is what the face's collection
 *  payloads are built from (`{ key }` carries decoded keys — client.ts). */
function decodeKey(keySchema: WireSchemaAny, id: string): unknown {
  const decode = Schema.decodeUnknownOption(keySchema);
  const direct = decode(id);
  if (Option.isSome(direct)) return direct.value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(id);
  } catch {
    return undefined; // not JSON — unaddressable for a non-string key
  }
  const decoded = decode(parsed);
  return Option.isSome(decoded) ? decoded.value : undefined;
}

/** Open the streaming source for a subscribed URI (the pusher's `StreamFor`).
 *  Returns `undefined` for a URI that doesn't resolve so the pusher drops it. */
function streamForUri<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  keySchemaByCollection: Map<string, WireSchemaAny>,
): Stream.Stream<unknown, unknown> | undefined {
  const call = resolveCall(client, uri, byUri, keySchemaByCollection);
  return call === undefined ? undefined : call.open();
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
 *      an empty open is a dead/dropped bridge link, NOT an empty value — it FAILS,
 *      never collapses to `null` (the green-dot lie in MCP form;
 *      caught-error-must-not-collapse-to-empty).
 *    - **collection-item** is snapshot-first ONLY when the key currently EXISTS.
 *      A collection's membership is dynamic (a key can be born later), and the
 *      collection `get` HOLDS OPEN for an absent key instead of throwing (it
 *      yields nothing until the first upsert — the fix for the gray-chip #1681).
 *      That held-open semantic is correct for a LIVE subscription but would make a
 *      one-shot read block forever on a not-yet-born key, so the read races the
 *      item's first frame against a live `keys`-absence watch and a hard deadline
 *      — see {@link readCollectionItemSnapshot}.
 *    - **event** is the ONE kind with no snapshot by contract (`EventHandlerDeps`
 *      explicitly carries no snapshot obligation — it may yield zero frames, and a
 *      late subscriber misses past occurrences — which is what distinguishes Event
 *      from Stream). Awaiting its first frame would block `resources/read` forever or
 *      until the next occurrence, so an event reads as an immediate explicit `null`
 *      — its live value is the `notifications/resources/updated` stream, delivered
 *      via `resources/subscribe`, not a readable snapshot.
 *
 *  Returns an EFFECT: the caller runs it with the MCP request's `AbortSignal`, so
 *  a cancelled read interrupts every subscription it opened. */
function readSnapshot<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  byUri: Map<string, ResourceEntry>,
  keySchemaByCollection: Map<string, WireSchemaAny>,
): Effect.Effect<Snapshot | ReadMiss, unknown> {
  const call = resolveCall(client, uri, byUri, keySchemaByCollection);
  if (call === undefined)
    return Effect.succeed<Snapshot | ReadMiss>({ miss: "unresolved" });
  switch (call.kind) {
    case "event":
      return Effect.succeed<Snapshot | ReadMiss>({
        value: null,
        mimeType: call.mimeType,
      });
    // A collection-item read must not lean on the held-open `get` to signal
    // absence — an absent key yields nothing forever — so it gets a BOUNDED read
    // that races the `get` first frame against a live `keys`-absence watch.
    case "collection-item":
      return readCollectionItemSnapshot(
        client,
        uri,
        call,
        keySchemaByCollection,
      );
    case "cell":
    case "collection":
    case "stream":
      return readFirstFrameSnapshot(call, uri);
    default: {
      // Exhaustiveness guard: a new `ResolvedCall` kind must add its own case
      // rather than silently falling through to the snapshot-first reader.
      const unreachable: never = call.kind;
      return Effect.die(
        new Error(`surface-mcp: unhandled resource kind "${unreachable}"`),
      );
    }
  }
}

/** Open a snapshot-first source (cell / collection / stream) and return its
 *  first frame.
 *
 *  cell / collection / collection-item / STREAM are ALL snapshot-first by the
 *  surface contract: `@kolu/surface/server` opens a cell/collection with a
 *  current-value frame, and `StreamHandlerDeps` REQUIRES "first yield is a fresh
 *  full snapshot" — only `Event` carries no snapshot obligation (handled by the
 *  caller as an immediate `null`). So an empty open for any of these is NOT an
 *  empty value — it is a dead/dropped bridge link, and collapsing it to JSON
 *  `null` would hand an MCP agent `surface://<kind>/<x> => null` as if it were
 *  real (the green-dot lie in MCP form, the snapshot-then-delta class). Fail
 *  loudly per caught-error-must-not-collapse-to-empty.
 *
 *  `Stream.runHead` takes the first element and then ENDS the stream, which
 *  releases the subscription through the stream's own finalizers — the Effect
 *  equivalent of the old `for await … return`. */
function readFirstFrameSnapshot(
  call: ResolvedCall,
  uri: string,
): Effect.Effect<Snapshot, unknown> {
  return Effect.flatMap(Stream.runHead(call.open()), (head) =>
    Option.isSome(head)
      ? Effect.succeed({ value: head.value, mimeType: call.mimeType })
      : Effect.fail(
          new Error(
            `surface-mcp: ${uri} (${call.kind}) yielded no snapshot frame — the surface ` +
              "contract opens a cell/collection/stream with a current-value snapshot, so an " +
              "empty open means the bridge link dropped, not that the value is null.",
          ),
        ),
  );
}

/** Hard upper bound on a one-shot collection-item read. The read is bounded by
 *  this deadline so a quiet producer can never hang it: a collection with no
 *  `keys` verb has no membership signal to resolve an absent key against at all,
 *  and one WITH a `keys` verb can still keep saying "still a member" while the
 *  item stream says nothing. Both bounds are always armed — see
 *  {@link readCollectionItemSnapshot}. */
const KEYSLESS_ITEM_READ_DEADLINE_MS = 5_000;

/** The outcome of one arm of the bounded collection-item race.
 *
 *  Every arm SUCCEEDS with one of these — including the failure arm. That is
 *  deliberate: `Effect.raceAll` ignores an early FAILURE and keeps waiting for a
 *  success, so a genuinely broken item read expressed as a failure would lose the
 *  race to the 5s deadline and be reported as a benign "not present". Carrying
 *  the failure as a value and re-raising it after the race keeps a dropped link
 *  loud (caught-error-must-not-collapse-to-empty). */
type ItemRead =
  | { readonly kind: "present"; readonly value: unknown }
  | { readonly kind: "absent" }
  | { readonly kind: "deadline" }
  | { readonly kind: "failed"; readonly error: unknown };

/** One-shot read of a collection-item URI, BOUNDED against `collectionHandlers.get`'s
 *  held-open-on-absent semantic (#1681). The item `get` yields nothing until the key
 *  is a member, so taking its first frame ALONE hangs forever on a not-yet-present
 *  key. This races it against BOTH absence bounds — always both, never one or the
 *  other, because they answer different questions and neither subsumes the other:
 *
 *   - **membership** (when the collection has a `keys` verb): a LIVE `keys`
 *     subscription that reports absence — a `keys` frame that OMITS the key (absent
 *     at the snapshot, OR removed at any later instant, which also closes the
 *     DELETE-RACE a one-time check-then-`get` would leave open) resolves `absent`.
 *     Precise and immediate, and the only bound that can say something true about
 *     the ITEM.
 *   - **the deadline** (always): the backstop, and the only thing standing between
 *     a quiet producer and an unbounded read. Wiring these as EITHER/OR left a gap
 *     exactly between them — a key that STAYS a member while its item stream says
 *     nothing matched no bound at all.
 *
 *  `Effect.raceAll` interrupts the losing arms, so whichever bound answers first
 *  tears the others' subscriptions down through their own finalizers.
 *
 *  NOTE for the reconcile pass: this is the Effect-native successor of
 *  `@kolu/surface/first-frame`'s `firstFrameOfCollectionItem`, which is
 *  AsyncIterable/AbortSignal-shaped and therefore unusable against a `Stream`-shaped
 *  face. It lives here only because W2 forbids editing `@kolu/surface`; it belongs
 *  back in the framework, beside the held-open `get` footgun it guards. */
function readCollectionItemSnapshot<Client extends SurfaceClientCallable>(
  client: Client,
  uri: string,
  call: ResolvedCall,
  keySchemaByCollection: Map<string, WireSchemaAny>,
): Effect.Effect<Snapshot | ReadMiss, unknown> {
  const item = parseCollectionItem(uri);
  if (item === null) {
    // Unreachable by construction: `readCollectionItemSnapshot` is called only for
    // a `call.kind === "collection-item"`, which `resolveCall` sets ONLY after
    // `parseCollectionItem(uri)` succeeded on this same URI. Fail LOUD if that
    // invariant is ever broken — never a silent fall-through.
    return Effect.die(
      new Error(
        `surface-mcp: ${uri} routed as a collection item but does not parse as one`,
      ),
    );
  }
  const keysProc = client.surface[item.key]?.keys;
  const keySchema = keySchemaByCollection.get(item.key);
  const key = keySchema !== undefined ? decodeKey(keySchema, item.id) : item.id;

  const itemArm = Effect.catch(
    Effect.map(
      Stream.runHead(call.open()),
      (head): ItemRead =>
        Option.isSome(head)
          ? { kind: "present", value: head.value }
          : {
              kind: "failed",
              error: new Error(
                `surface-mcp: ${uri} (collection-item) yielded no snapshot frame — a PRESENT ` +
                  "collection item opens with a current-value snapshot, so an empty open means " +
                  "the bridge link dropped, not that the value is null.",
              ),
            },
    ),
    (error): Effect.Effect<ItemRead> =>
      Effect.succeed({ kind: "failed", error }),
  );

  // Membership is decided by `Array.includes` (SameValueZero) between the DECODED
  // key and the raw keys in each frame — sound for the primitive key types
  // (string/number/boolean) a `keys` stream carries, because `key` was decoded to
  // that same raw type. A `keys` stream that ends without ever reporting absence
  // only happens on teardown, so it resolves `absent` too rather than leaving the
  // read unbounded.
  const membershipArm =
    keysProc === undefined
      ? []
      : [
          Effect.catch(
            Effect.as(
              Stream.runHead(
                Stream.filter(
                  asStream(keysProc(undefined), uri, "collection"),
                  (frame) => !(Array.isArray(frame) && frame.includes(key)),
                ),
              ),
              { kind: "absent" } as ItemRead,
            ),
            (error): Effect.Effect<ItemRead> =>
              Effect.succeed({ kind: "failed", error }),
          ),
        ];

  const deadlineArm = Effect.as(Effect.sleep(KEYSLESS_ITEM_READ_DEADLINE_MS), {
    kind: "deadline",
  } as ItemRead);

  return Effect.flatMap(
    Effect.raceAll<Effect.Effect<ItemRead>>([
      itemArm,
      ...membershipArm,
      deadlineArm,
    ]),
    (outcome): Effect.Effect<Snapshot | ReadMiss, unknown> => {
      switch (outcome.kind) {
        case "present":
          return Effect.succeed({
            value: outcome.value,
            mimeType: call.mimeType,
          });
        case "failed":
          return Effect.fail(outcome.error);
        case "deadline":
          // The read ran out of time. Either the collection has no membership
          // signal to resolve against, or it has one that kept saying "still a
          // member" while the item stream said nothing — the race arms BOTH
          // bounds, so a deadline no longer implies keys-lessness and this must
          // not claim it does. Either way the not-present is UNCERTAIN (the item
          // may exist but never opened a snapshot in time), so surface it loudly
          // rather than degrade silently.
          return Effect.sync(() => {
            console.error(
              `surface-mcp: ${uri} — the read of "${item.key}" hit its ${KEYSLESS_ITEM_READ_DEADLINE_MS}ms deadline before the item produced a snapshot, so this not-present is UNCONFIRMED rather than a known absence`,
            );
            return { miss: "not-present" };
          });
        case "absent":
          return Effect.succeed({ miss: "not-present" });
      }
    },
  );
}

/** Undo the `enforceObject` wrapping before handing args to a procedure/tool's
 *  schema. A non-object input (scalar/array/union) is advertised wrapped under a
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
