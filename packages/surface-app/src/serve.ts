/**
 * `@kolu/surface-app/serve` — a surface app's whole listener, in one call.
 *
 * ## What it owns
 *
 * The HTTP leg and the WebSocket leg of a surface app are not two independent
 * decisions: they are one `http.Server` and one ORDER, and the order is the
 * part that keeps being got wrong. Every consumer that grew a listener by hand
 * — kolu's own `surface-app` example, drishti, olai — wrote the same five steps:
 *
 *   1. **origin gate** on the RAW pre-upgrade socket (`gateWsOrigin`), because
 *      after the upgrade the attacker page has a connection to argue about;
 *   2. **upgrade** (`handleUpgrade`) — and only for the one path a surface
 *      speaks on ({@link SURFACE_WS_PATH}); anything else is destroyed;
 *   3. **stale-tab check** (`gateStaleSocket`, inside `acceptSurfaceSocket`),
 *      before any dispatch, so a tab bound to a PREVIOUS process is closed
 *      rather than allowed to replay dead subscriptions (kolu#1231);
 *   4. **heartbeat enrolment**, so a silently half-open browser is reaped
 *      instead of holding its stream subscriptions open forever;
 *   5. **serve** (`serveSurfaceSocket`) — one Effect `RpcServer` per connection
 *      over the shared handlers.
 *
 * `acceptSurfaceSocket` already sequences 3 → 4 → 5. What stayed hand-copied is
 * everything around it: owning the `http.Server` so the `upgrade` event stays
 * ours, mounting the shell layers on its `request` event, standing up the
 * `WebSocketServer`, binding, and dropping every connection at shutdown. That is
 * what this module owns, and why a consumer's listener collapses to one call.
 *
 * This package's own example (`example/src/server/main.ts`) is the in-tree plug:
 * it calls `serveSurfaceApp` and keeps only its app-specific parts (its live
 * connection count, off {@link SurfaceAppEvent}'s lifecycle arms).
 *
 * ## What still blocks kolu's own listener
 *
 * kolu (`packages/server/src/index.ts`) still hand-wires, and the reason is three
 * named, grounded gaps rather than anything about its routing — it upgrades ONE
 * path over ONE runtime, which is exactly this module's shape:
 *
 *   - it builds an `https.Server` when TLS material is configured, and this
 *     module creates a plaintext `http.Server` unconditionally;
 *   - it passes `middleware: koluHttpMiddleware(log)` to
 *     `NodeHttpServer.makeHandler`, and this module passes only `scope`;
 *   - it mounts the static shell layer ONLY when a built dist exists (its dev
 *     proxy serves the client), and `clientDist` here is required. That is why
 *     kolu composes `pwaManifestLayer` and `freshStaticLayer` by hand rather
 *     than taking `surfaceAppLayer`: it serves the manifest UNCONDITIONALLY and
 *     the statics conditionally, and the convenience layer pairs the two —
 *     a pairing {@link ServeSurfaceAppOptions} inherits by extending
 *     `SurfaceAppLayerOptions`.
 *
 * Each is a real option this interface would have to grow, and none is added
 * speculatively: they land with the migration that needs them, not before.
 * drishti is a different story — its per-host `?host=` dispatch picks WHICH
 * runtime serves a socket, which is the one decision the accept seam deliberately
 * leaves at the call site.
 *
 * ## The Node runtime is the app's, not the package's
 *
 * `ws` and `@effect/platform-node` are PEER dependencies (optional ones), not
 * dependencies. Every consumer of this module already runs Node and already
 * declares both; declaring them here instead would put a Node HTTP server and a
 * Node websocket implementation in the install graph of every browser-facing
 * entry point — `packages/client` depends on `@kolu/surface-app` for `./solid`
 * and `./connect` alone. The arrow reads the right way round: the app supplies
 * its runtime, this module supplies the order.
 *
 * ## Why the `http.Server` is ours and not the platform's
 *
 * `NodeHttpServer.makeHandler` on a server we created keeps the `upgrade` event
 * ours. `HttpServer.serve` registers its OWN `upgrade` listener, and Node fans
 * an event out to EVERY listener — so a framework-owned handler would also try
 * to answer a socket we have already upgraded.
 *
 * ## The frame cap is not a knob
 *
 * `ws`'s `maxPayload` is `RPC_MAX_FRAME_BYTES` — the framework's published byte
 * budget, the same one `exceedsFrameLimit` publishes to every sender — and there
 * is no option to move it. `@kolu/surface/frame-limit` owns the number and the
 * argument: why a transport cap below that budget breaks the promise (olai's
 * 8 MiB, which killed a 10 MiB frame the framework said it would carry) and one
 * above it would accept frames senders were told to refuse.
 *
 * ## What it deliberately does NOT own
 *
 * - **The surface runtime's lifetime.** `serveSurfaceApp` takes the
 *   `{ group, handlers }` pair and never the runtime's `close`/`done`: the
 *   runtime belongs to the composition root that built it, and a transport that
 *   also closed it would be two owners of one thing.
 * - **A port policy.** A bind failure is the typed {@link SurfaceAppListenFailed}
 *   and nothing else. An app that wants "if the port is taken, take any port"
 *   composes that itself (`Effect.catchIf` on the `EADDRINUSE` cause) — it is a
 *   product decision about whose port it is, not a property of serving a shell.
 *   Compose it over the WHOLE call, not over the bind: the retry is a second
 *   `serveSurfaceApp({ …, port: 0 })`, with its own `http.Server` and its own
 *   `WebSocketServer`. There is no `server` handle to re-bind, and there is
 *   nothing to clean up by hand — the abandoned first listener never bound, and
 *   its finalizer is already on the scope.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { NodeHttpServer } from "@effect/platform-node";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import type { SurfaceHandlers } from "@kolu/surface/server";
import { gateWsOrigin } from "@kolu/surface/ws-origin";
import { hostAuthority } from "@kolu/url-shape";
import { Data, Effect, type FileSystem, Layer, type Path, Scope } from "effect";
import { type HttpPlatform, HttpRouter } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { WebSocketServer } from "ws";
import { SURFACE_WS_PATH } from "./index";
import {
  acceptSurfaceSocket,
  type ServableSocket,
  serveSurfaceSocket,
  type SurfaceAppLayerOptions,
  type SurfaceSocketServing,
  surfaceAppLayer,
} from "./server";

/** The listener could not bind. The one failure `serveSurfaceApp` reports, and
 *  it carries the `cause` verbatim so a consumer can classify it (an
 *  `EADDRINUSE` port policy reads `cause.code`) instead of matching on a
 *  message string. */
export class SurfaceAppListenFailed extends Data.TaggedError(
  "SurfaceAppListenFailed",
)<{
  readonly host: string;
  readonly port: number;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `cannot listen on ${this.host}:${this.port}: ${
      this.cause instanceof Error ? this.cause.message : String(this.cause)
    }`;
  }
}

/** One accepted browser connection, as the facts a per-connection `Layer` can
 *  be built from: the upgrade request (its peer address, its forwarded-for
 *  header) and its parsed URL (the `pid` echo, a `?host=` selector). */
export interface SurfaceAppConnection {
  readonly request: IncomingMessage;
  readonly url: URL;
}

/** Something the listener wants narrated. ONE sink, because every consumer has
 *  exactly one logger: the four separate callbacks this replaced were the same
 *  pino / `log` threaded four times, with their defaults scattered across three
 *  modules.
 *
 *  The phase distinction is structural: an arm carries a
 *  {@link SurfaceAppConnection} exactly when it fires after the gates and the
 *  enrolment, because only then is there a connection to describe. The arms in
 *  front of that (`DisallowedOrigin`, `StaleTab`, and `SocketError` — whose
 *  handler the stale gate installs before enrolment) carry the `url` instead,
 *  parsed one line before the origin gate runs, so the sink never has to say
 *  "some upgrade, somewhere". */
export type SurfaceAppEvent =
  /** Gated, enrolled, and about to be served. The place a live-connection count
   *  increments and a consumer writes its `connected` line. */
  | { readonly _tag: "Connected"; readonly connection: SurfaceAppConnection }
  /** That same connection hung up (peer, reaper, or our own teardown). */
  | { readonly _tag: "Disconnected"; readonly connection: SurfaceAppConnection }
  /** A transport error on an accepted socket. */
  | { readonly _tag: "SocketError"; readonly error: Error; readonly url: URL }
  /** A tab bound to a PREVIOUS process, closed at the handshake. */
  | {
      readonly _tag: "StaleTab";
      readonly claimedPid: string;
      readonly url: URL;
    }
  /** A cross-site `Origin` refused BEFORE the upgrade. */
  | {
      readonly _tag: "DisallowedOrigin";
      readonly origin: string | undefined;
      readonly url: URL;
    }
  /** This ONE connection's serving stack faulted. Post-accept by definition, so
   *  it carries the {@link SurfaceAppConnection} the lifecycle arms do — with a
   *  single-path listener the `url` is the same string on every connection, and a
   *  fault nobody can attribute to the entry they keyed on `Connected` is a fault
   *  nobody can act on. */
  | {
      readonly _tag: "ServingFailed";
      readonly cause: unknown;
      readonly connection: SurfaceAppConnection;
    };

/** What a listener says when nobody is listening: loud on every fault, silent on
 *  the ordinary. A restarted server closing a tab bound to the previous process
 *  is ordinary, and so is a connection opening or closing — but a refused hijack
 *  attempt, a transport error, or a faulted serving stack that nobody can see is
 *  the one thing a shared listener must not ship.
 *
 *  Exported so it is readable and testable as a policy, and so a consumer's own
 *  `onEvent` can delegate to it for the arms it does not care about. */
export const reportSurfaceAppEvent = (event: SurfaceAppEvent): void => {
  switch (event._tag) {
    case "Connected":
    case "Disconnected":
    case "StaleTab":
      return;
    case "DisallowedOrigin":
      console.warn(
        `serveSurfaceApp: refused a websocket upgrade to ${event.url.href} from disallowed Origin ${String(event.origin)}.`,
      );
      return;
    case "SocketError":
      console.error(
        `serveSurfaceApp: transport error on ${event.url.href}`,
        event.error,
      );
      return;
    case "ServingFailed":
      console.error(
        `serveSurfaceApp: serving stack faulted for ${event.connection.url.href}`,
        event.cause,
      );
      return;
  }
};

/** Everything `serveSurfaceApp` needs. The required half is the app's identity —
 *  what is served on the wire, what is served over HTTP, and where. Every option
 *  below it is observational or a shell-freshness passthrough. */
export interface ServeSurfaceAppOptions<Svc = never>
  extends SurfaceAppLayerOptions {
  /** The served surface's flat `RpcGroup` — `runtime.group`. */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Every bound member handler keyed by wire tag — `runtime.handlers`. */
  readonly handlers: SurfaceHandlers;
  /** The app's OWN routes, merged alongside the shell — an MCP endpoint, a
   *  media route, anything answering with bytes the bundle does not hold.
   *  MERGED, not ordered: `HttpRouter` ranks by specificity, so a literal or
   *  prefixed route always beats the shell's `GET /*` catch-all whichever way
   *  round they go in. */
  readonly routes?: Layer.Layer<
    never,
    never,
    | HttpRouter.HttpRouter
    | FileSystem.FileSystem
    | Path.Path
    | HttpPlatform.HttpPlatform
  >;
  readonly host: string;
  readonly port: number;
  /** Browser origins allowed to open the websocket, beyond same-origin — the
   *  reverse-proxy / `tailscale serve` escape hatch. `parseAllowedOrigins`
   *  (`@kolu/surface/ws-origin`) of the app's own env var. */
  readonly allowedOrigins: ReadonlyArray<string>;
  /** Services this ONE connection's handlers require — kolu's per-viewer
   *  address, taken off the upgrade request. Effect's socket-server protocol
   *  carries no per-request headers, so a per-connection serving stack simply
   *  provides them. */
  readonly services?: (connection: SurfaceAppConnection) => Layer.Layer<Svc>;
  /** Narrate a listener event — connects, disconnects, and every fault, on ONE
   *  sink. Defaults to {@link reportSurfaceAppEvent}. */
  readonly onEvent?: (event: SurfaceAppEvent) => void;
}

/**
 * Serve a surface app: the shell over HTTP, the surface over ONE websocket, in
 * the one correct order.
 *
 * Binds, and registers its whole teardown on the enclosing scope — so closing
 * that scope closes the sockets and no caller holds a shutdown function it might
 * forget to call. Returns the URL actually bound (the OS's answer, so `port: 0`
 * reports the port it was given).
 */
export const serveSurfaceApp = <Svc = never>(
  options: ServeSurfaceAppOptions<Svc>,
): Effect.Effect<string, SurfaceAppListenFailed, Scope.Scope> =>
  Effect.gen(function* () {
    // The ONE sink, resolved once: every narration below goes through `report`,
    // so "what does this listener do when nobody is listening" has exactly one
    // answer and it is readable in one place.
    const report = options.onEvent ?? reportSurfaceAppEvent;
    // The HTTP handler's own scope: `makeHandler` forks each request as a fiber
    // in it, so it must outlive every in-flight request and die with the
    // listener. `Scope.fork` is the library contract for exactly that —
    // "closing the parent closes the child with the same exit value" — and
    // forking FIRST puts its close last in the parent's LIFO order.
    const httpScope = yield* Scope.fork(yield* Effect.scope);
    // `options` IS a `SurfaceAppLayerOptions` (it extends one), so the shell
    // half is passed straight through: no field is re-spelled here, and adding a
    // shell option is one edit in `server.ts` rather than three.
    const shell = surfaceAppLayer(options);
    const app =
      options.routes === undefined ? shell : Layer.merge(options.routes, shell);

    const server = createServer();
    server.on(
      "request",
      yield* Effect.gen(function* () {
        const httpEffect = yield* HttpRouter.toHttpEffect(app);
        return yield* NodeHttpServer.makeHandler(httpEffect, {
          scope: httpScope,
        });
      }).pipe(
        Scope.provide(httpScope),
        // The platform services the static layer asks for — file system, path,
        // the file-response platform. Provided HERE rather than demanded of the
        // caller: this module already owns `node:http`, so a consumer that had
        // to hand it Node's platform layer would be spelling out a fact the
        // module's existence already settled.
        Effect.provide(NodeHttpServer.layerHttpServices),
      ),
    );

    // The cap is the framework's, and there is no option to lower it — see the
    // module header. `noServer`: we own the upgrade, because the origin gate has
    // to run before a socket exists at all.
    const sockets = new WebSocketServer({
      noServer: true,
      maxPayload: RPC_MAX_FRAME_BYTES,
    });

    // Gate (stale tab) → enrol (liveness reaper) → dispatch, sequenced by the
    // seam so a socket cannot be served without first being gated and enrolled.
    // The gate takes no id from here: it compares against this process's own
    // `surfaceProcessId()`, which is exactly what the reserved `system/identity`
    // member answers and so exactly what a reconnecting tab echoes back.
    // No `intervalMs`: the sweep cadence is PAIRED with the client's watchdog
    // (it must comfortably exceed `createHeartbeat`'s recovery so a reconnect
    // wins the race), which makes it the same class of number as the frame cap —
    // one a consumer who guesses turns into sockets reaped mid-revival, silently.
    const acceptor = acceptSurfaceSocket({
      server: sockets,
      onError: (error, url) => report({ _tag: "SocketError", error, url }),
      onReject: (claimedPid, url) =>
        report({ _tag: "StaleTab", claimedPid, url }),
    });

    // The LIVE population of serving stacks — drained first in the finalizer.
    const servings = new Set<SurfaceSocketServing>();

    server.on("upgrade", (request, socket, head) => {
      const url = requestUrl(request);
      if (url.pathname !== SURFACE_WS_PATH) {
        socket.destroy();
        return;
      }
      // Cross-site websocket hijacking is refused on the RAW socket, before the
      // upgrade — after it, the attacker page has a connection to argue about.
      if (
        gateWsOrigin(request, socket, {
          allowedOrigins: options.allowedOrigins,
          onReject: (origin) =>
            report({ _tag: "DisallowedOrigin", origin, url }),
        })
      ) {
        return;
      }
      sockets.handleUpgrade(request, socket, head, (peer) => {
        acceptor.accept(peer, url, () => {
          // Gated and enrolled — so this is the first instant at which there IS a
          // connection to narrate, and the pair a live-connection count needs.
          const connection: SurfaceAppConnection = { request, url };
          report({ _tag: "Connected", connection });
          peer.once("close", () =>
            report({ _tag: "Disconnected", connection }),
          );
          const serving = serveSurfaceSocket({
            group: options.group,
            handlers: options.handlers,
            // `ws`'s socket satisfies `ServableSocket` structurally; its typings
            // narrow `addEventListener` per event name, which the seam does not.
            socket: peer as unknown as ServableSocket,
            services: options.services?.(connection),
          });
          servings.add(serving);
          // A serving site owns its `done`: it resolves on hang-up and REJECTS if
          // the serving stack failed. An unobserved rejection is an unhandled
          // one, and one dead socket must never take the listener with it.
          // Forgotten the moment it ends, however it ended, so the set stays the
          // LIVE population rather than a log of everything ever served.
          void serving.done
            .catch((cause: unknown) =>
              report({ _tag: "ServingFailed", cause, connection }),
            )
            .finally(() => servings.delete(serving));
        });
      });
    });

    // Registered BEFORE the bind, so a failed bind still tears down everything
    // above it.
    //
    // Shutting down means DROPPING what is connected, not waiting for it.
    // `server.close` refuses to finish while any connection is open, and both
    // kinds a browser holds are open at that moment: the surface's websocket,
    // which by construction stays up for as long as the tab does, and the
    // keep-alive connection the page's own requests left behind. Neither ever
    // closes on its own, so a server with a tab pointed at it hangs forever —
    // Ctrl+C caught, the runtime unwinding, and the process simply never
    // exiting. Nothing is lost by dropping them: a page whose socket goes away
    // is a case the client already handles — it says so and reconnects.
    //
    // `terminate` rather than `close`: a close handshake waits for a reply from
    // a peer we are about to stop being able to answer, which is the same wait
    // in a politer spelling.
    //
    // The serving stacks are drained FIRST, and this is the one part of shutdown
    // that is awaited rather than dropped: each `close()` releases that
    // connection's RPC fibers and every in-flight subscription it opened, and
    // `done` settles when that has finished. Terminating the raw sockets without
    // it would resolve the listener's finalizer while those releases were still
    // running — the listener owning acceptance deterministically and release only
    // by luck. `terminate()` below then reaps what no serving stack owned (a
    // stale tab mid-close), which is what it was for.
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        acceptor.stop();
        // `server.close()` stops ACCEPTING synchronously; only its callback
        // waits. Start it first so nothing new can be built during the drain
        // below — the drain yields the event loop, and an upgrade that landed
        // while it did would build a whole serving stack AFTER the snapshot and
        // never be awaited. (`acceptor.stop()` only clears the heartbeat
        // interval; it does not stop accepting.)
        const closed = new Promise<void>((resolve) =>
          server.close(() => resolve()),
        );
        await Promise.all(
          [...servings].map((serving) => {
            serving.close();
            return serving.done.catch(() => {});
          }),
        );
        for (const client of sockets.clients) client.terminate();
        sockets.close();
        server.closeAllConnections();
        await closed;
      }),
    );

    return yield* bind(server, options);
  });

/** The request target as a URL. The `Host` header only ever supplies the base a
 *  relative target is resolved against — nothing downstream reads it — so an
 *  absent one falls back to a placeholder rather than failing the parse. */
const requestUrl = (request: IncomingMessage): URL =>
  new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

/** Bind, then read the address back. Crash rather than substitute the requested
 *  bind for the bound one: this function's whole job is to say where we actually
 *  landed, and `port: 0` means only the OS knows. */
const bind = (
  server: Server,
  options: { readonly host: string; readonly port: number },
): Effect.Effect<string, SurfaceAppListenFailed> =>
  Effect.callback<string, SurfaceAppListenFailed>((resume) => {
    const failed = (cause: unknown) =>
      resume(
        new SurfaceAppListenFailed({
          host: options.host,
          port: options.port,
          cause,
        }),
      );
    // The error listener is the whole reason this is not a bare `listen`:
    // EADDRINUSE is the realistic failure — a fixed default port, a harness
    // spawning servers — and without it Node raises it as an uncaught event
    // rather than as this fiber's failure. Removed once we are bound, so a LATER
    // server error stays Node's own loud uncaught path instead of being
    // swallowed by a callback that has already settled.
    server.once("error", failed);
    server.listen({ host: options.host, port: options.port }, () => {
      server.removeListener("error", failed);
      const info: AddressInfo | string | null = server.address();
      // NOT a `SurfaceAppListenFailed`: the bind SUCCEEDED. A non-TCP address
      // after a TCP `listen` is this module's own assumption breaking, and a
      // consumer's `EADDRINUSE` port policy must never be handed it as something
      // to retry — it would retry forever against a defect. Throw, as kolu's own
      // listener does in the same spot.
      if (info === null || typeof info === "string") {
        throw new Error(
          `serveSurfaceApp bound a non-TCP address (${JSON.stringify(info)}) — expected a host/port`,
        );
      }
      resume(Effect.succeed(originOf(info)));
    });
  });

/** The origin a browser can be pointed at. The bracketing of an IPv6 literal is
 *  {@link hostAuthority}'s, not re-derived here — `http://::1:7714` is not a URL,
 *  and the one thing this string is for is being pasted somewhere that parses
 *  it. */
const originOf = (info: AddressInfo): string =>
  `http://${hostAuthority(info.address, info.port)}`;
