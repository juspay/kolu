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
 * callback-shaped, so this module is a genuine process boundary. Every request
 * it serves runs its effect through ONE function — {@link runRequest} — and the
 * `ResourcePusher`'s per-URI subscription fibers are the only other run in the
 * package (`Effect.runFork`, in `pusher.ts`).
 *
 * `runRequest` exists because the SDK hands EVERY request an `AbortSignal` and
 * every request is answered with a `Promise`, so the crossing is the same fact
 * twice: `resources/read` opens subscriptions, `tools/call` places a unary
 * member call, and a cancelled request must interrupt either. Handing the
 * signal to the RUN (rather than threading it through the calls) is what makes
 * that one line instead of one per call site — under Effect a member call takes
 * no `signal`, because cancellation IS fiber interruption (D10/#18).
 */

import type { Surface, SurfaceSpec, WireSchemaAny } from "@kolu/surface/define";
import { isDeadTransportError } from "@kolu/surface/errors";
import {
  firstFrameOfCollectionItem,
  firstFrameOrThrow,
  ITEM_READ_DEADLINE_MS,
} from "@kolu/surface/first-frame";
import type { ExposeMap } from "@kolu/surface/expose";
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
import { match } from "ts-pattern";
import { COLLECTION_PREFIX, type ResourceEntry, resolveExpose } from "./expose";
import { type PusherConnection, ResourcePusher } from "./pusher";
import {
  type BespokeTool,
  brand,
  fail,
  failFrom,
  messageOf,
  ok,
  type ToolResult,
} from "./tools";
import type { SurfaceClientCallable } from "@kolu/surface/client";
import { decodeTextValue, inputSchema, unwrapArgs } from "@kolu/surface/verbs";

// The client shape a projecting face holds opaquely is the FRAMEWORK's
// (`@kolu/surface/client`, beside the `buildSurfaceFace` that mints one) — the
// CLI face holds exactly the same one. Re-exported from this module because it
// is part of this module's published vocabulary:
// `OwnedSurfaceConnection` below is that type, and a consumer reading the doc
// has to be able to import the name it names.
export type { SurfaceClientCallable };

/** An *owned connection* the client factory hands over: the bridge case, where
 *  the factory opened a transport (`unixSocketLink` dials a socket) and the
 *  adapter is now responsible for closing it.
 *
 *  Deliberately the pusher's {@link PusherConnection} at this module's client
 *  type, not a re-declaration of its three fields — the read/tool slot and the
 *  pusher's attachment hold the SAME thing, and the same factory feeds both. The
 *  field docs, including why `onClose` is optional and what an absent hook
 *  degrades to, live on the base. */
export type OwnedSurfaceConnection = PusherConnection<SurfaceClientCallable>;

/** What `opts.client()` may return. Either a bare client (the in-process
 *  `directDispatch` case — nothing to dispose) or an {@link OwnedSurfaceConnection}
 *  (the bridge case — `unixSocketLink` opens a socket it owns, so `dispose()`
 *  must close it). The adapter normalizes both, disposes every connection it
 *  opens on teardown, and re-dials after a drop. */
export type ClientOrConnection = SurfaceClientCallable | OwnedSurfaceConnection;

export interface ServeSurfaceAsMcpOptions<S extends SurfaceSpec> {
  surface: Surface<S>;
  /** Live-client factory. Bridge case: dial the served surface (return
   *  `{ client, dispose }` so the adapter can close the socket it owns).
   *  Serve-fresh case: a `directDispatch` over an in-process implementation
   *  (return the bare client — nothing to dispose). Re-invoked on retry after
   *  a drop, and re-dialed for reads/tools after a transport failure. */
  client: () => ClientOrConnection | Promise<ClientOrConnection>;
  /** Default-deny allowlist — what an agent may touch. */
  expose: ExposeMap<S>;
  /** Hand-authored, call-shaped verbs composing over the live client — the
   *  framework record (`SurfaceVerb`) plus this face's own `render`, so the same
   *  table also projects as argv through `@kolu/surface-cli`: a tool that only
   *  fills the shared half is a `SurfaceVerb` and assigns here unchanged. */
  tools?: Record<string, BespokeTool>;
  serverInfo?: { name: string; version: string };
  /** The server's own `instructions`, answered to a host at `initialize` — where
   *  an embedding app teaches an agent the domain the surface is about ("a node
   *  is the smallest thing you can name here; there is no file access"). It is
   *  passed to the SDK's `Server`, which serves `initialize` inside its own
   *  `Protocol`: a consumer cannot re-register that method, so this option is
   *  the ONLY way the field is reachable. The SDK itself treats an empty string
   *  as none (`...(this._instructions && { instructions })`), so there is no
   *  third state to spell here. */
  instructions?: string;
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
        brand(
          `tool name "${name}" is produced by both ${prior} and ${source} — rename one`,
        ),
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
    // Passed bare: the SDK emits `...(this._instructions && { instructions })`,
    // so an absent option and an omitted key are the same value to it, and a
    // spread-guard here would only be a second spelling of that.
    instructions: opts.instructions,
  });

  // Normalize whatever `opts.client()` returns into an owned connection. The
  // bare-client (in-process `directDispatch`) case gets a no-op disposer; the
  // `{ client, dispose }` (bridge) case keeps its socket-closing disposer.
  const dial = async (): Promise<OwnedSurfaceConnection> => {
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
  // bridge case's factory may open a socket each time).
  //
  // A dead connection is dropped by TWO paths, and the order matters:
  //
  //   1. EAGERLY, the moment the transport says it closed (`onClose`, wired in
  //      `dialOnce` below). This is the one that matters in practice — a daemon
  //      restart is announced, so the corpse is discarded while the adapter is
  //      idle and the next request dials fresh. It needs the transport to carry
  //      the announcement all the way to the factory; where a dial does not yet
  //      project one (see {@link OwnedSurfaceConnection}) only (2) is left.
  //   2. LAZILY, in `withClient`'s catch, when a call fails with a recognized
  //      transport death. This remains the backstop for the two cases (1) cannot
  //      cover: a dial that carries no close announcement, and the genuine race
  //      where the socket dies with a request already in flight.
  //
  // (2) alone was the whole of juspay/kolu#2082: a restart could only be
  // discovered by spending a request on the dead socket.
  /** The WHOLE lifetime of that one connection, as ONE value — never a
   *  connection-or-null beside a `closed` flag beside an in-flight-dial cell.
   *
   *  Three independent cells have eight combinations and only four legal ones,
   *  held apart by statement order and by prose — and one writer here runs on a
   *  clock of its own (the transport's `onClose` fires on no request's
   *  schedule), so statement order is not available as a guarantee. Split cells
   *  also make it easy to gate the MIDDLE of a dial without gating its ENTRY,
   *  which lets a request landing after teardown really open a socket and
   *  dispose it on the next line. A tag puts the gate at the front for free, and
   *  every guard below is one tag test rather than a remembered rule. */
  type ConnState =
    | { readonly t: "idle" }
    /** A dial is in flight, memoized so two concurrent callers (a long-blocking
     *  wait tool beside a read — the kolu-mcp case) share ONE dial instead of
     *  each racing an emptiness check across the await and opening (then
     *  leaking) a second socket. */
    | { readonly t: "dialing"; readonly dial: Promise<OwnedSurfaceConnection> }
    | { readonly t: "live"; readonly conn: OwnedSurfaceConnection }
    /** Terminal. Reached only by teardown, and never left. */
    | { readonly t: "closed" };
  let state: ConnState = { t: "idle" };

  /** The in-flight or memoized dial. Coalescing, the closed-gate, and the
   *  fresh-dial decision are one tag test each. */
  const dialShared = (): Promise<OwnedSurfaceConnection> =>
    match(state)
      // Gated at the ENTRY: a post-teardown request must not open a socket
      // only to dispose it on the next line.
      .with({ t: "closed" }, () =>
        Promise.reject(
          new Error("the server is closed — no connection to dial"),
        ),
      )
      .with({ t: "live" }, ({ conn }) => Promise.resolve(conn))
      .with({ t: "dialing" }, ({ dial }) => dial)
      .with({ t: "idle" }, () => {
        const pending = dialOnce();
        state = { t: "dialing", dial: pending };
        return pending;
      })
      .exhaustive();

  const dialOnce = async (): Promise<OwnedSurfaceConnection> => {
    let conn: OwnedSurfaceConnection;
    try {
      conn = await dial();
    } catch (err) {
      if (state.t === "dialing") state = { t: "idle" };
      throw err;
    }
    // Teardown won the race while we dialed: there is no slot to publish into,
    // so dispose the just-opened socket rather than orphan it (the adapter's
    // promise: dispose every connection it opens). Reject so a caller
    // mid-`getConn` fails loud instead of running against a socket about to
    // close. ONE tag test is the whole gate here: "am I still the dial this slot
    // is waiting on" answers both "was the server closed" and "did another dial
    // take the slot", so neither needs a cell of its own to fall out of sync.
    if (state.t !== "dialing") {
      conn.dispose();
      throw new Error(
        "the server closed while this connection was being dialed",
      );
    }
    state = { t: "live", conn };
    // EAGER INVALIDATION (#2082). Registered AFTER the store, so the identity
    // guard in `dropConn` can see this connection as the current one — and on
    // the SUCCESS path only, because a connection the teardown test above
    // already disposed has no slot to invalidate.
    //
    // This call can invoke its callback BEFORE it returns. A transport that
    // died during the dial replays the close at registration — padi's does it
    // on a microtask, and the contract permits a plain synchronous `cb()` — so
    // by the next line the state may already be back at `idle`. `getConn` is
    // what handles that; see the born-dead loop.
    conn.onClose?.(() => dropConn(conn));
    return conn;
  };

  /** How many times `getConn` dials before giving up on a connection that keeps
   *  arriving already dead. Three attempts, not two: the second covers the
   *  ordinary race (a daemon that went down between the dial and its
   *  registration) and the third distinguishes an unlucky moment from a daemon
   *  that cannot hold a connection at all — and saying so beats spinning. */
  const BORN_DEAD_DIAL_ATTEMPTS = 3;
  /** The wall-clock half of the same bound, armed alongside the count so the
   *  guarantee is TRANSPORT-INDEPENDENT: "a request is never delayed more than
   *  this by born-dead redials", whatever a dial costs.
   *
   *  A count alone is only cheap while a dial is. Over a unix socket it nearly
   *  is — though not the "~1ms" it is tempting to claim: each redial re-runs the
   *  factory, and kolu-cli's local one re-resolves the running padi
   *  (`resolveRunningPadiSocket`: a synchronous `readdirSync` over the runtime-dir
   *  regimes plus a `statSync`/manifest-read/`kill(pid, 0)` per candidate) before
   *  the connect and its `hello` round-trip. Bounded and only on a failure path,
   *  but milliseconds each, not one.
   *
   *  This slot ALREADY holds a link where a count would be the wrong unit:
   *  `kolu mcp --host` feeds an ssh dial that provisions a closure on the far
   *  side, seconds to minutes. It never re-dials today only because that dial
   *  supplies no `onClose` — transport luck, not a guarantee, and it evaporates
   *  the day the remote leg projects its close signal.
   *
   *  Ten seconds, and the deadline is only ever read BETWEEN attempts — it never
   *  cuts a dial short. So it is generous next to a socket dial (all three
   *  attempts finish inside it, and the count is what trips) and tight next to an
   *  ssh provision (the first one runs to completion; a second and third cannot
   *  stack behind one MCP request). Not a knob: a better-chosen invariant. */
  const BORN_DEAD_DIAL_BUDGET_MS = 10_000;
  /** Hand out a LIVE shared connection.
   *
   *  A dial can land already dead: the transport announces its close during
   *  registration, so `dropConn` disposes the connection before the awaiting
   *  caller ever resumes. Returning it anyway would spend that caller's request
   *  on a corpse — #2082's exact symptom, reintroduced through the door opened
   *  to fix it. So the slot is re-checked by identity after the dial settles,
   *  and a connection that is no longer current is re-dialed rather than handed
   *  out.
   *
   *  Re-dialing here is safe in the way re-REQUESTING is not, and the
   *  distinction is the whole reason this loop is allowed to exist: a dial
   *  carries no caller intent, so repeating one replays nothing. Repeating the
   *  REQUEST is what would resend a mutation into a fresh daemon generation,
   *  and that is still never done. */
  const getConn = async (): Promise<OwnedSurfaceConnection> => {
    const started = Date.now();
    const deadline = started + BORN_DEAD_DIAL_BUDGET_MS;
    let attempts = 0;
    while (attempts < BORN_DEAD_DIAL_ATTEMPTS && Date.now() < deadline) {
      attempts += 1;
      const conn = await dialShared();
      // Still the current connection ⇒ it did not announce a close on the way
      // out, so it is live as far as anything here can know.
      if (state.t === "live" && state.conn === conn) return conn;
    }
    throw linkFailure(
      `the served surface's transport closed immediately on each of ${attempts} consecutive dials over ${
        Date.now() - started
      }ms — it is not staying up long enough to carry a request`,
      "retry once the served daemon is holding connections",
    );
  };
  /** The connection died — ANNOUNCED by its transport, or discovered by a call
   *  that failed on it. Both funnel here, and the identity guard is the single
   *  invariant: a drop is inert unless `conn` is still the current one, so a
   *  late/duplicate announcement from a disposed predecessor can never dispose
   *  the fresh successor another call already redialed. */
  const dropConn = (conn: OwnedSurfaceConnection): void => {
    if (state.t !== "live" || state.conn !== conn) return;
    state = { t: "idle" };
    // Fire and forget: the framework's `dispose` may be async (one shape for
    // both faces), and this slot has already stopped pointing at the connection.
    void conn.dispose();
  };
  // Teardown: move to the terminal state FIRST (so a still-pending dial finds
  // no slot to publish into and disposes its own result — see `dialOnce`), then
  // dispose whatever connection is current (identity-agnostic — the server is
  // closing, so there is no successor to protect).
  const disposeSharedConn = (): void => {
    const prev = state;
    state = { t: "closed" };
    if (prev.t === "live") prev.conn.dispose();
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
      if (!isDeadTransportError(e)) throw e;
      dropConn(conn);
      // The genuine race: the socket died with this request in flight, plus any
      // dial whose close announcement never reached us. Framed by the shared
      // link-failure policy rather than here, because a BORN-DEAD connection
      // fails a request too (`getConn`'s bounded loop) and both must read alike.
      throw linkFailure(
        "the connection to the served surface dropped while this request was in " +
          `flight (${messageOf(e)})`,
        "retry, and the next request re-dials",
        e,
      );
    }
  };

  /** THE request edge: answer one MCP request by running its effect under the
   *  request's own `AbortSignal`.
   *
   *  Every handler below funnels through here, so the package's Promise boundary
   *  is one function rather than one per request kind. Handing the signal to the
   *  RUN interrupts the request's fiber on cancellation, and that interrupt tears
   *  down everything the request opened — a `resources/read`'s subscriptions
   *  through the streams' own finalizers, a `tools/call`'s in-flight dispatch —
   *  which is the bound the threaded `AbortSignal` used to give, expressed once
   *  instead of at every call site. */
  const runRequest = <A>(
    effect: Effect.Effect<A, unknown>,
    signal: AbortSignal,
  ): Promise<A> => Effect.runPromise(effect, { signal });

  // Index resources by URI for O(1) read/subscribe dispatch.
  const byUri = new Map<string, ResourceEntry>();
  for (const r of resolved.resources) byUri.set(r.uri, r);
  // Index collection key schemas by surface key for item-template key decode.
  const keySchemaByCollection = new Map<string, WireSchemaAny>();
  for (const t of resolved.resourceTemplates) {
    keySchemaByCollection.set(t.key, t.keySchema);
  }

  // ── ResourcePusher (subscribe/teardown lifecycle) ──────────────────────
  // The pusher dials its OWN connection (one per attach) rather than sharing
  // the read/tool one: a subscription holds its transport for as long as the
  // subscription lives, which is not the read path's lifetime.
  //
  // It is handed the whole `OwnedSurfaceConnection` — `dial` is the factory,
  // verbatim — and that must stay the whole wiring. Shredding the connection to
  // pass a bare client with its disposer filed in a side table keyed by that
  // client drops `onClose` on the floor (the pusher then heals the old #2082
  // way, by its stream failing) AND leaks a socket whenever two concurrent
  // attaches dial connections sharing one client object, because the second
  // entry overwrites the first's disposer.
  const pusher = new ResourcePusher<SurfaceClientCallable>({
    notify: (uri) => {
      server.sendResourceUpdated({ uri }).catch((err) => {
        // Transport may already be closed (e.g. client disconnected between the
        // delta arriving and the notification send). Swallow silently — the
        // client is gone and can't receive the update anyway.
        console.error(brand("sendResourceUpdated failed"), err);
      });
    },
    client: dial,
    stream: (client, uri) =>
      streamForUri(client, uri, byUri, keySchemaByCollection),
    // A swallowed dial/stream failure here would otherwise be invisible; the
    // pusher still retries, but surface it to stderr so a perpetually-failing
    // bridge is diagnosable. (stdout is the MCP protocol channel — never log
    // there.)
    onError: (err) => {
      console.error(brand("pusher stream/dial error"), err);
    },
  });

  // ── tools/list ─────────────────────────────────────────────────────────
  // `annotations` carry the read/write distinction to the host: a read-only
  // tool (`readOnlyHint`) can be auto-approved or surfaced separately from a
  // mutating one (`destructiveHint`). Without these the `mutates` flag the API
  // and docs promise never reaches the host.
  //
  // NO `outputSchema` is advertised, and adding one is not the free win it
  // looks like. The SDK's client validates `structuredContent` against a
  // declared `outputSchema` whenever the field is PRESENT — including on an
  // `isError` result, despite the comment beside that code claiming otherwise
  // (`client/index.js`: the validate branch sits outside the `isError` guard).
  // A refusal's `ToolFailure.detail` is a different shape from the success it
  // refused, so declaring a success schema would make every structured refusal
  // throw inside the client's SDK instead of reaching the agent. Whoever adds
  // `outputSchema` owes that case a home first — a union with the refusal shape,
  // or no structured arm on the error side.
  //
  // `mutates` reaches the host through ONE `mutates → annotations` projection,
  // so the two tool sources cannot drift on the mapping or on the undefined
  // edge case. Each normalizes `mutates` to a concrete boolean before calling:
  // procedure tools already carry one (`expose.ts`'s `?? true`), bespoke tools
  // apply the same conservative `?? true` at the call.
  //
  // `title` and `description` are bespoke-only TODAY because `ToolExposure` has
  // no field for either — a gap in the consumer's authoring map, not in this
  // projection.
  const toolAnnotations = (mutates: boolean) => ({
    readOnlyHint: !mutates,
    destructiveHint: mutates,
  });
  // Built ONCE, at boot: nothing here reads request state, and `tools/list` is
  // answered from the finished array rather than re-projecting per call.
  const advertisedTools = [
    ...resolved.tools.map((t) => ({
      name: t.name,
      inputSchema: t.inputSchema,
      annotations: toolAnnotations(t.mutates),
    })),
    ...[...bespokeTools].map(([name, { tool, schema }]) => ({
      name,
      // MCP's display name, distinct from `description`: a host renders it in a
      // tool list, and without one it renders `name` — the machine spelling
      // (`lifecycle_sendInput`) rather than a phrase.
      title: tool.title,
      description: tool.description,
      inputSchema: schema,
      // Conservative default (see `SurfaceVerb.mutates`, the shared half): an absent `mutates`
      // is treated as MUTATING, so an unannotated tool is never advertised as
      // auto-approvable read-only. A genuinely read-only tool opts in with an
      // explicit `mutates: false`.
      annotations: toolAnnotations(tool.mutates ?? true),
    })),
  ];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: advertisedTools,
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
              brand(`client has no procedure "${exposed.ns}.${exposed.verb}"`),
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
          // A unary member call is an `Effect`; it runs at the request edge, so
          // a cancelled `tools/call` interrupts the dispatch instead of leaving
          // it in flight with nobody to answer. A DECLARED failure rejects with
          // the squashed error, which the `catch` below turns into the `isError`
          // tool result the contract promises — the same route a rejecting
          // procedure took before.
          return ok(await runRequest(proc(callArgs), extra.signal));
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
        // failing handler must land in `failFrom`, never escape as -32603. The
        // handler DESCRIBES its work; it runs at the same request edge every
        // other handler does, so a cancelled `tools/call` interrupts it.
        return await withClient(async (client) => {
          const out = await runRequest(
            tool.handler(parsed, client, extra.signal),
            extra.signal,
          );
          // The tool's own renderer when it declared one (an image face),
          // else the JSON default every other tool uses.
          return tool.render ? tool.render(out) : ok(out);
        });
      }
      return fail(brand(`unknown tool "${name}"`));
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
  server.setRequestHandler(ReadResourceRequestSchema, async (req, extra) => {
    const { uri } = req.params;
    // THE `resources/read` edge's branding — the mirror of `failFrom` on the
    // tools/call side (see {@link brand}). Without it the same link failure
    // named this adapter or didn't depending on which request kind hit it.
    const result = await withClient((client) =>
      runRequest(
        readSnapshot(client, uri, byUri, keySchemaByCollection),
        extra.signal,
      ),
    ).catch((e: unknown): never => {
      // `messageOf`, the SAME derivation `failFrom` uses on the tools/call side
      // — which is what makes the comment above a mirror rather than a claim.
      // Spelled inline, a `Schema.TaggedError` procedure failure (empty
      // `message`, identity in `_tag`) reached the host as the bare brand.
      throw new Error(brand(messageOf(e)), { cause: e });
    });
    if (isMiss(result)) {
      // A not-yet-present collection key is a well-formed but empty resource, NOT
      // an unknown URI — distinct messages so an agent can tell "this address is
      // wrong" from "this value hasn't arrived yet" (it may appear once its
      // producer reports in; watch it via `resources/subscribe`).
      throw new Error(
        result.miss === "not-present"
          ? brand(
              `resource "${uri}" has no value yet — its collection key is not present`,
            )
          : brand(`unknown resource "${uri}"`),
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
      throw new Error(brand(`cannot subscribe to unknown resource "${uri}"`));
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
        `${uri} (${kind}) resolved no streaming source — the ` +
          "surface contract guarantees a snapshot-first open, so this is a link/" +
          "protocol failure, not an empty value.",
      ),
    );
  }
  return source as Stream.Stream<unknown, unknown>;
}

/** Decode a collection item URI's string `<id>` segment into the collection's
 *  declared key type — {@link decodeTextValue}'s rule ("a schema-less caller
 *  hands scalars over as text"), at this face's policy: a token that lands in
 *  neither the verbatim nor the JSON reading returns `undefined`, so the caller
 *  treats it as an unaddressable item rather than calling `.get` with a
 *  wrong-typed key.
 *
 *  The DECODED key is what comes back, which is what the face's collection
 *  payloads are built from (`{ key }` carries decoded keys — client.ts). */
function decodeKey(keySchema: WireSchemaAny, id: string): unknown {
  return Option.getOrUndefined(
    Option.map(decodeTextValue(keySchema, id), (landed) => landed.decoded),
  );
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
      return Effect.die(new Error(`unhandled resource kind "${unreachable}"`));
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
 *  The read is the FRAMEWORK's {@link firstFrameOrThrow}, which is exactly this
 *  pair: `Stream.runHead` (it takes the first element and then ENDS the stream,
 *  releasing the subscription through the stream's own finalizers — the Effect
 *  equivalent of the old `for await … return`) with this empty-open policy over
 *  it. Hand-rolled here, it left the shared reader with one consumer while its
 *  own doc claimed two, and reported the empty open as a bare `Error` that no
 *  caller could tell from the source's own failure — which is the condition
 *  `NoSnapshotFrame` was minted for, and the one the argv face reads its exit-3
 *  arm off. The MESSAGE stays this face's: the URI and the kind are MCP's
 *  words. */
function readFirstFrameSnapshot(
  call: ResolvedCall,
  uri: string,
): Effect.Effect<Snapshot, unknown> {
  return Effect.map(
    firstFrameOrThrow(
      call.open(),
      `${uri} (${call.kind}) yielded no snapshot frame — the surface ` +
        "contract opens a cell/collection/stream with a current-value snapshot, so an " +
        "empty open means the bridge link dropped, not that the value is null.",
    ),
    (value) => ({ value, mimeType: call.mimeType }),
  );
}

/** One-shot read of a collection-item URI, BOUNDED against `collectionHandlers.get`'s
 *  held-open-on-absent semantic (#1681): the item `get` yields nothing until the key
 *  is a member, so taking its first frame ALONE hangs forever on a not-yet-present
 *  key.
 *
 *  The bounded race itself — the item's first frame against BOTH a live
 *  `keys`-absence watch AND a deadline, neither subsuming the other — is the
 *  FRAMEWORK's, `@kolu/surface/first-frame`'s `firstFrameOfCollectionItem`, which
 *  lives beside the held-open `get` footgun it guards. This function is the MCP
 *  vocabulary over it: which streams to hand it, and how each outcome reads as a
 *  `Snapshot` or a `ReadMiss`. It stays an EFFECT all the way down so the whole
 *  read runs inside the request's fiber — `resources/read` runs it under the MCP
 *  request's abort signal, and a Promise edge in the middle would detach the
 *  subscriptions from that interruption. */
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
      new Error(`${uri} routed as a collection item but does not parse as one`),
    );
  }
  const keysProc = client.surface[item.key]?.keys;
  const keySchema = keySchemaByCollection.get(item.key);
  const key = keySchema !== undefined ? decodeKey(keySchema, item.id) : item.id;

  return Effect.flatMap(
    firstFrameOfCollectionItem(
      call.open(),
      keysProc === undefined
        ? null
        : asStream(keysProc(undefined), uri, "collection"),
      key,
      `${uri} (collection-item) yielded no snapshot frame — a PRESENT ` +
        "collection item opens with a current-value snapshot, so an empty open means " +
        "the bridge link dropped, not that the value is null.",
      // The hard upper bound, so a quiet producer can never hang this read: a
      // collection with no `keys` verb has no membership signal to resolve an
      // absent key against at all, and one WITH a `keys` verb can still keep
      // saying "still a member" while the item stream says nothing. Both bounds
      // are always armed. The NUMBER is the framework's, beside the reader it
      // bounds — this adapter knows nothing about "how long may a local read
      // wait" that the CLI face does not, and the two spelled the same `5_000`
      // independently until the constant existed.
      ITEM_READ_DEADLINE_MS,
    ),
    (frame): Effect.Effect<Snapshot | ReadMiss, unknown> => {
      if (frame.present)
        return Effect.succeed({ value: frame.value, mimeType: call.mimeType });
      if (frame.reason === "absent")
        return Effect.succeed({ miss: "not-present" });
      // The read ran out of time. Either the collection has no membership
      // signal to resolve against, or it has one that kept saying "still a
      // member" while the item stream said nothing — the race arms BOTH
      // bounds, so a deadline no longer implies keys-lessness and this must
      // not claim it does. Either way the not-present is UNCERTAIN (the item
      // may exist but never opened a snapshot in time), so surface it loudly
      // rather than degrade silently.
      return Effect.sync(() => {
        console.error(
          brand(
            `${uri} — the read of "${item.key}" hit its ${ITEM_READ_DEADLINE_MS}ms deadline before the item produced a snapshot, so this not-present is UNCONFIRMED rather than a known absence`,
          ),
        );
        return { miss: "not-present" };
      });
    },
  );
}

/** EVERY failure this adapter reports for a LINK problem, framed for a host
 *  standing on its own stdio channel. The policy, in one place:
 *
 *    1. name the layer that actually died — the raw error is the LINK's own
 *       vocabulary ("stdio transport closed … the peer process exited"), true
 *       of the link and badly false of everything above it;
 *    2. say THIS MCP SERVER IS STILL RUNNING and has discarded the corpse. An
 *       MCP host reads a link-death message on its own stdio channel and
 *       concludes the MCP server exited, so it stops calling — exactly what
 *       happened in juspay/kolu#2082, where one such message cost the rest of
 *       an agent's session;
 *    3. say what retrying does, since the caller's next move is the whole point.
 *
 *  A `cause` is kept where there is one, so the underlying reason survives the
 *  re-frame (a re-frame must add context, never swallow it).
 *
 *  TEARDOWN is the one link failure this policy does NOT cover, and deliberately:
 *  when the server really is shutting down, "this MCP server is still running"
 *  would be a lie. Those two throws (`dialShared`'s closed gate and `dialOnce`'s
 *  lost race) say plainly that the server closed, and nothing more. */
function linkFailure(what: string, retry: string, cause?: unknown): Error {
  return new Error(
    `${what}. This MCP server is still running and has discarded the dead ` +
      `connection — ${retry}.`,
    cause === undefined ? undefined : { cause },
  );
}
