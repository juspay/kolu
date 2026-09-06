/**
 * `serveSurfaceAsMcp` — re-expose a `@kolu/surface` ROOTED BUNDLE as an MCP
 * server.
 *
 * **The fourth seam.** `@kolu/surface` composes on one shape everywhere else — a
 * bare core beside a keyed set of siblings, the roster changing live: the serve
 * seam (`implementRootedSurfaces`), the consume seam (`connectSurfaces`) and the
 * gate (`exposeRootedFaces`) all take it. This face now takes it too, so a host
 * whose surface is a set of siblings hands the bundle over instead of curating a
 * flat spec that copies members out of each one and keeping its own book of which
 * sibling is standing. `./bundle.ts` owns the composition; this module owns the
 * serving of it, and {@link ServedSurfaceMcp.reroster} owns the move.
 *
 * A single-surface face is the degenerate bundle — a `core` and no siblings — and
 * every name it mints is exactly what it minted before.
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
 * ## What is NOT here, and why
 *
 * This module used to hold five concerns and six closure-held mutables in one
 * 640-line factory, with the legality of each combination kept by prose. Four of
 * them are separable without inventing anything, and each is now a module that
 * depends on far less than an MCP server does — which is what makes each of them
 * testable without a transport:
 *
 *   - `./bundle.ts` — the COMPOSITION and every refusal it owes, plus the indices
 *     over one resolved generation.
 *   - `./connection.ts` — the LIFETIME of the one dialled connection: the tagged
 *     state, the coalesced dial, the roster epoch, the identity-guarded drop, the
 *     born-dead retry. It knows about `dial()` and nothing else.
 *   - `./departed.ts` — the RETIREMENT policy: what a departed name is remembered
 *     as, and when a tombstone is cleared.
 *   - `./read.ts` — ADDRESSING (`uri × generation → address`), BINDING (`address ×
 *     bundle → call | no-leg | no-member`) and the one-shot snapshot readers.
 *
 * What stays is the SDK wiring, the generation, `reroster`, and the one rule that
 * is genuinely about this face's own time: a request's names and its client must
 * belong to the same generation ({@link withGeneration}).
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

import type { SurfaceSpec } from "@kolu/surface/define";
import { isDeadTransportError } from "@kolu/surface/errors";
import {
  type McpBundle,
  type McpSibling,
  type ResolvedBundle,
  resolveBundle,
} from "./bundle";
import { linkFailure, makeSharedConnection } from "./connection";
import { DepartedNames } from "./departed";
import {
  addressOf,
  isMiss,
  isSubscribable,
  noLegFor,
  readSnapshot,
  type ReadMiss,
  type Snapshot,
  streamForUri,
} from "./read";
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
import { Effect, Schema } from "effect";
import { type PusherConnection, ResourcePusher } from "./pusher";
import { brand, fail, failFrom, messageOf, ok, type ToolResult } from "./tools";
import {
  clientAt,
  declarationTarget,
  type RootedSurfaceClients,
  type SurfaceClientCallable,
} from "@kolu/surface/client";
import { unwrapArgs } from "@kolu/surface/verbs";

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
export type OwnedSurfaceConnection = PusherConnection<RootedSurfaceClients>;

/** What `opts.client()` may return. Either a bare client BUNDLE (the in-process
 *  `directDispatch` case — nothing to dispose) or an {@link OwnedSurfaceConnection}
 *  (the bridge case — `unixSocketLink` opens a socket it owns, so `dispose()`
 *  must close it). The adapter normalizes both, disposes every connection it
 *  opens on teardown, and re-dials after a drop.
 *
 *  ONE connection carrying the WHOLE bundle, not one per sibling: a rooted
 *  bundle is one wire with a client per sibling over it, which is the same
 *  arrangement `connectSurfaces` makes on the browser side. So a roster move
 *  replaces the bundle a single dial hands back — see
 *  {@link ServedSurfaceMcp.reroster}. */
export type ClientOrConnection = RootedSurfaceClients | OwnedSurfaceConnection;

export interface ServeSurfaceAsMcpOptions<
  C extends SurfaceSpec = SurfaceSpec,
  M extends Record<string, SurfaceSpec> = Record<string, SurfaceSpec>,
> extends McpBundle<C, M> {
  /** Live-client factory. Bridge case: dial the served bundle (return
   *  `{ client, dispose }` so the adapter can close the socket it owns).
   *  Serve-fresh case: a `directDispatch` over an in-process implementation
   *  (return the bare bundle — nothing to dispose). Re-invoked on retry after
   *  a drop, after a transport failure, and after every
   *  {@link ServedSurfaceMcp.reroster} — so it must read the host's CURRENT
   *  roster rather than close over the one it was built with. */
  client: () => ClientOrConnection | Promise<ClientOrConnection>;
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

/** A served bundle: the low-level `Server`, the roster move, and teardown. */
export interface ServedSurfaceMcp {
  server: Server;
  /** TAKE A NEW SIBLING ROSTER, IN PLACE — the fourth seam's half of
   *  juspay/kolu#2225: the serve side already reads its generation at each accept
   *  and the consume side already follows a roster without rebuilding the page, so
   *  an MCP endpoint over a bundle whose siblings come and go must be able to say
   *  so rather than be restarted.
   *
   *  What moves and what does not:
   *
   *    - **The siblings move.** The whole map is REPLACED, not merged: what is
   *      absent from `surfaces` has left. Every refusal the boot composition owes
   *      is re-made here on the new roster (`resolveBundle`), so a move cannot
   *      smuggle past the gate a first call was held to.
   *    - **The core does not.** It is the member on every generation this endpoint
   *      can serve — the same reason `connectSurfaces.redial` leaves its root
   *      alone. Serving a different core is a different endpoint.
   *    - **The connection is re-dialled.** `client()` is invoked again, so the
   *      bundle it hands back carries the arriving siblings' clients; a request
   *      in flight across the move fails rather than being answered off the old
   *      one.
   *    - **Departed subscriptions END.** A `resources/subscribe` standing on a URI
   *      the new roster does not serve is torn down here, because nothing will ever
   *      push it again and a silently-quiet subscription is the worst of the three
   *      possible answers.
   *
   *  Afterwards the adapter sends `notifications/tools/list_changed` and
   *  `notifications/resources/list_changed`, which is why it advertises both
   *  `listChanged` capabilities from the start — a host that never heard the list
   *  could change has no reason to re-read it.
   *
   *  A call to a DEPARTED sibling's tool or URI is refused BY NAME (the same
   *  sentence `SurfaceSiblingDropped` gives on the wire), not answered with a bare
   *  "unknown" — an agent holding a stale tool list needs to know the difference
   *  between a name it got wrong and one that went away. */
  /** METHOD-generic, exactly as {@link McpBundle.surfaces} is, and for exactly
   *  its reason: `Record<string, McpSibling<SurfaceSpec>>` collapses every map to
   *  the loosest `ExposeMap`, whose index signature accepts a key naming nothing.
   *  Spelled that way the two doors were held to different gates — the boot call
   *  rejected a misspelled member where the author wrote it, and the reroster
   *  call took it and failed at runtime instead. `ServedSurfaceMcp` itself stays
   *  concrete; only this method binds `M2`. */
  reroster: <M2 extends Record<string, SurfaceSpec>>(
    surfaces: { [K in keyof M2]: McpSibling<M2[K]> },
  ) => Promise<void>;
  /** Stop the pusher, release the shared connection, disconnect the transport. */
  close: () => Promise<void>;
}

/** Build + connect an MCP server that re-exposes a rooted bundle. */
export async function serveSurfaceAsMcp<
  C extends SurfaceSpec,
  M extends Record<string, SurfaceSpec>,
>(opts: ServeSurfaceAsMcpOptions<C, M>): Promise<ServedSurfaceMcp> {
  let gen = resolveBundle(opts);
  /** WHAT this endpoint has served and no longer does, and WHO owned it — the
   *  retirement policy, which is an axis of its own and has its own module
   *  (`./departed.ts`, where the retention rule is stated out loud). It was two
   *  bare maps here and four module-level functions that took them as
   *  parameters. */
  const departed = new DepartedNames();

  const server = new Server(opts.serverInfo ?? DEFAULT_SERVER_INFO, {
    // `listChanged` on BOTH lists, from the first `initialize`: the roster can
    // move under any bundle this face serves, and the SDK refuses to send a
    // notification for a capability the server never advertised. A face whose
    // roster happens to be fixed advertises it too rather than deriving the
    // capability from today's arguments — a host reads capabilities once, and a
    // server that grew the ability to change its list later could never say so.
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
    },
    // Passed bare: the SDK emits `...(this._instructions && { instructions })`,
    // so an absent option and an omitted key are the same value to it, and a
    // spread-guard here would only be a second spelling of that.
    instructions: opts.instructions,
  });

  // Normalize whatever `opts.client()` returns into an owned connection. The
  // bare-bundle (in-process `directDispatch`) case gets a no-op disposer; the
  // `{ client, dispose }` (bridge) case keeps its socket-closing disposer.
  //
  // The two are told apart by `dispose`, not by `client`: a bare bundle carries
  // `core` and `clients`, never those two fields, so the test is exact.
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
    return { client: result as RootedSurfaceClients, dispose: () => {} };
  };

  // ── A single shared connection for reads + bespoke tools ───────────────
  // The pusher manages its own (re-)attaching connection for the streaming
  // subscription face; reads and tool calls dial on demand. ONE connection is
  // memoized for the lifetime so reads/tools don't re-dial per call (the bridge
  // case's factory may open a socket each time).
  //
  // Its whole lifetime — the tagged state, the coalesced dial, the epoch that
  // makes a dial crossing a reroster refuse to publish, the identity-guarded
  // drop, the born-dead retry loop — is `./connection.ts`. That is one axis of
  // change and it is nothing to do with MCP, so it is not six mutable bindings
  // in the middle of the SDK wiring. What stays HERE is the pairing rule below,
  // which is about this face's generations and about nothing else.
  const shared = makeSharedConnection(dial);

  // The failure-reset policy in one place. Reset ONLY on a recognized TRANSPORT
  // death — an application error (a bad tool arg, an unknown key, a wrong
  // terminal id) must NOT tear down the shared socket, because a concurrent
  // in-flight tool (a blocking wait_* holding this same connection for its whole
  // duration) would lose its live subscription mid-call. A real transport drop
  // still resets so the next call re-dials rather than reusing a dead socket;
  // the identity guard above keeps that reset from nuking a successor.
  const withClient = async <R>(
    /** The generation the caller resolved its NAMES against. */
    current: ResolvedBundle,
    fn: (client: RootedSurfaceClients) => Promise<R>,
  ): Promise<R> => {
    const conn = await shared.get();
    // The names and the client must belong to ONE generation, and this is where
    // that stops being a convention. Reading `gen` once per request buys the
    // caller a consistent set of TABLES; it does not reach the client, which
    // comes from a slot of its own that a reroster empties and a redial refills.
    //
    // the shared slot's epoch guard closes the wide, I/O-shaped window — a reroster
    // landing DURING a dial makes that dial refuse to publish. What it cannot
    // close is its born-dead retry: written for a connection that
    // announces its own close, the loop re-dials after the identity
    // re-check fails, and a second dial that starts AFTER the move carries the
    // new bundle honestly — to a caller still holding the old tables.
    //
    // One identity test settles it, because the generation IS the value: if the
    // server has swapped it since this request read it, the pair this request
    // would answer with was never served together. Refusing is the same answer
    // the slot's own dial guard gives for the same fact, and it makes `reroster`'s promise true
    // in both directions — an in-flight request fails rather than being answered
    // off the wrong roster, whichever side moved first.
    //
    // It bounds the pairing at the moment the call is PLACED, which is the whole
    // of what it claims: a move landing while the member call is already in
    // flight is the ordinary in-flight case, whose outcome is unknown rather than
    // wrong (see {@link linkFailure}).
    if (current !== gen) {
      throw linkFailure(
        "the sibling roster moved between this request resolving its names and " +
          "reaching the served surface, so the two describe different generations",
        "retry, and the next request resolves both against the new roster",
      );
    }
    try {
      return await fn(conn.client);
    } catch (e) {
      if (!isDeadTransportError(e)) throw e;
      shared.drop(conn);
      // The genuine race: the socket died with this request in flight, plus any
      // dial whose close announcement never reached us. Framed by the shared
      // link-failure policy rather than here, because a BORN-DEAD connection
      // fails a request too (the slot's bounded loop) and both must read alike.
      throw linkFailure(
        "the connection to the served surface dropped while this request was in " +
          `flight (${messageOf(e)})`,
        "retry, and the next request re-dials",
        e,
      );
    }
  };

  /** THE entry point for a request that resolves names AND may reach a client.
   *
   *  {@link withClient} proves the two belong to one generation — but OBTAINING
   *  the generation was each handler's own `const current = gen;`, so the
   *  invariant was enforced at the check and left to memory at the read, and
   *  nothing stopped a handler from reading the module-level `gen` a second time
   *  mid-request and passing the other one. Here the generation and the ONLY door
   *  to a client are handed over together, so a handler that goes through this
   *  never names `gen` at all and cannot spell the mismatch.
   *
   *  The client is behind `withBundle` rather than handed over, because a request
   *  that resolves NO name (an unknown tool) must be refused without dialling —
   *  a daemon that is down would otherwise turn "unknown tool" into a link
   *  failure. Resolution happens against `current`; the dial happens only if it
   *  landed.
   *
   *  The three LIST handlers still read `gen` directly, and honestly: they have no
   *  client leg to pair it with, so there is no pair for them to get wrong. */
  const withGeneration = <R>(
    fn: (
      /** The generation this request resolves EVERY name against. */
      current: ResolvedBundle,
      withBundle: <A>(
        use: (bundle: RootedSurfaceClients) => Promise<A>,
      ) => Promise<A>,
    ) => Promise<R>,
  ): Promise<R> => {
    const current = gen;
    return fn(current, (use) => withClient(current, use));
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
  const pusher = new ResourcePusher<RootedSurfaceClients>({
    notify: (uri) => {
      server.sendResourceUpdated({ uri }).catch((err) => {
        // Transport may already be closed (e.g. client disconnected between the
        // delta arriving and the notification send). Swallow silently — the
        // client is gone and can't receive the update anyway.
        console.error(brand("sendResourceUpdated failed"), err);
      });
    },
    client: dial,
    // `gen` is read at the moment the stream is opened, not captured at
    // construction: the pusher re-attaches after a reroster, and it must resolve
    // its surviving URIs against the roster that is actually being served.
    stream: (client, uri) => streamForUri(client, uri, gen),
    // A swallowed dial/stream failure here would otherwise be invisible; the
    // pusher still retries, but surface it to stderr so a perpetually-failing
    // bridge is diagnosable. (stdout is the MCP protocol channel — never log
    // there.)
    onError: (err) => {
      console.error(brand("pusher stream/dial error"), err);
    },
  });

  // ── tools/list ─────────────────────────────────────────────────────────
  // Answered from the CURRENT generation's own projection (`resolveBundle`
  // indexes the tables it composes), read per request so a rerostered list is the
  // one a host is told about.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: gen.advertisedTools,
  }));

  // ── tools/call ───────────────────────────────────────────────────────--
  const callTool = async (
    req: { params: { name: string; arguments?: Record<string, unknown> } },
    extra: { signal: AbortSignal },
  ): Promise<ToolResult> => {
    const { name, arguments: rawArgs } = req.params;
    const args = rawArgs ?? {};
    try {
      // ONE generation for this whole request, and the only door to a client is
      // already paired with it — a mid-request reroster cannot have this call
      // resolve its name against one roster and its client against another, and
      // the handler never names `gen` to get it wrong.
      return await withGeneration(async (current, withBundle) => {
        const exposed = current.toolByName.get(name);
        if (exposed !== undefined) {
          // `await`, not a bare `return`: a returned promise's REJECTION does not
          // route through this try/catch, so a failing procedure call (e.g. the
          // transport down mid-call) would surface as a protocol-level -32603
          // instead of the `isError` tool result the contract promises.
          return await withBundle(async (bundle) => {
            const client = clientAt(bundle, exposed.sibling);
            if (client === undefined) {
              return fail(brand(noLegFor(exposed.sibling, `tool "${name}"`)));
            }
            const proc = client.surface[exposed.ns]?.[exposed.verb];
            if (proc === undefined) {
              return fail(
                brand(
                  `client has no procedure "${exposed.ns}.${exposed.verb}"`,
                ),
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
        const entry = current.bespoke.get(name);
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
          return await withBundle(async (bundle) => {
            // THE rule for every bespoke table this face takes — the FRAMEWORK's,
            // beside `clientAt`, because the argv face implements the same one and
            // neither face owns it: a tool receives the client of the thing it was
            // DECLARED on.
            const target = declarationTarget(bundle, entry.sibling);
            if (target === undefined) {
              return fail(
                brand(noLegFor(entry.sibling, `bespoke tool "${name}"`)),
              );
            }
            const out = await runRequest(
              tool.handler(parsed, target, extra.signal),
              extra.signal,
            );
            // The tool's own renderer when it declared one (an image face),
            // else the JSON default every other tool uses.
            return tool.render ? tool.render(out) : ok(out);
          });
        }
        return fail(brand(departed.toolMessage(name)));
      });
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
    resources: gen.resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mimeType,
    })),
  }));

  // ── resources/templates/list ───────────────────────────────────────────
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: gen.resourceTemplates.map((t) => ({
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
    const result = await withGeneration((current, withBundle) => {
      // ADDRESS FIRST, dial second — the rule `withGeneration` states and the
      // one `tools/call` and `resources/subscribe` already keep. `addressOf` is
      // pure over `(uri, generation)`; asking it costs no connection, and asking
      // it AFTER the dial is what turned an unknown or retired URI into a link
      // failure whenever the served daemon happened to be down. A caller who
      // typed a URI wrong, or held one from a roster ago, would then be told the
      // connection dropped — the one answer that is about neither.
      if (addressOf(uri, current) === undefined) {
        return Promise.resolve<Snapshot | ReadMiss>({ miss: "unresolved" });
      }
      return withBundle((bundle) =>
        runRequest(readSnapshot(bundle, uri, current), extra.signal),
      );
    }).catch((e: unknown): never => {
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
          : brand(departed.resourceMessage(uri)),
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
    if (!isSubscribable(uri, gen)) {
      throw new Error(
        brand(`cannot subscribe to ${departed.resourceMessage(uri)}`),
      );
    }
    pusher.subscribe(uri);
    return {};
  });
  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    pusher.unsubscribe(req.params.uri);
    return {};
  });

  // ── The roster move ────────────────────────────────────────────────────
  const reroster = async <M2 extends Record<string, SurfaceSpec>>(
    surfaces: { [K in keyof M2]: McpSibling<M2[K]> },
  ): Promise<void> => {
    // Resolved BEFORE anything is retired: a new roster that the composition
    // refuses must leave this endpoint exactly as it was, still serving the
    // generation it was serving. A half-applied move is the one outcome nothing
    // downstream could recover from.
    const next = resolveBundle({ ...opts, surfaces });
    const previous = gen;
    gen = next;
    departed.record(previous, next);

    // A subscription the new roster cannot serve ends HERE — the alternative is a
    // stream nothing will ever push again, which reads to a host exactly like a
    // quiet one. The survivors stay subscribed and are re-opened on the new
    // connection by `reattach`, so a sibling that did not move keeps its stream.
    // Read off the pusher, which OWNS the set — the adapter asks the one question
    // the pusher cannot ("does the new roster still serve this") and ends the
    // rest. It used to keep a mirror of the set and align the two by hand at four
    // paired call sites.
    for (const uri of [...pusher.subscriptions]) {
      if (isSubscribable(uri, next)) continue;
      pusher.unsubscribe(uri);
    }
    shared.retire();
    pusher.reattach();

    // Told LAST, so a host that immediately re-lists is answered from the roster
    // this call has finished applying.
    await Promise.all([
      server.sendToolListChanged(),
      server.sendResourceListChanged(),
    ]);
  };

  // ── Connect ────────────────────────────────────────────────────────────
  const transport = opts.transport ?? new StdioServerTransport();
  await server.connect(transport);

  const close = async (): Promise<void> => {
    pusher.stop();
    shared.dispose();
    await server.close();
  };
  server.onclose = () => {
    pusher.stop();
    shared.dispose();
  };

  return { server, reroster, close };
}
