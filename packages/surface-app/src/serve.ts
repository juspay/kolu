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
 * ## Why the `http.Server` is ours and not the platform's
 *
 * `NodeHttpServer.makeHandler` on a server we created keeps the `upgrade` event
 * ours. `HttpServer.serve` registers its OWN `upgrade` listener, and Node fans
 * an event out to EVERY listener — so a framework-owned handler would also try
 * to answer a socket we have already upgraded.
 *
 * ## The frame cap is not a knob
 *
 * `ws`'s `maxPayload` and the RPC decoder's `maxBufferSize` police the SAME
 * inbound leg, so if they disagree the tighter one silently governs. An app that
 * set `maxPayload` to 8 MiB while `@kolu/surface`'s `RPC_MAX_FRAME_BYTES` says
 * 16 MiB got exactly that: a 10 MiB frame the framework promises to carry — and
 * that `exceedsFrameLimit` (and every margin derived from it, e.g. padi's
 * `UPLOAD_CHUNK_BYTES`) reports as fine — died at the raw `ws` layer instead of
 * on the framework's handled path. So the cap is read from the framework
 * constant here, and there is no option to undercut it: one number, one leg.
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
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { NodeHttpServer } from "@effect/platform-node";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import type { SurfaceHandlers } from "@kolu/surface/server";
import { gateWsOrigin } from "@kolu/surface/ws-origin";
import {
  Data,
  Effect,
  Exit,
  type FileSystem,
  Layer,
  type Path,
  Scope,
} from "effect";
import { type HttpPlatform, HttpRouter } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { WebSocketServer } from "ws";
import { type FreshnessPaths, SURFACE_WS_PATH } from "./index";
import {
  acceptSurfaceSocket,
  type ManifestOptions,
  type ServableSocket,
  type ServiceWorkerMode,
  serveSurfaceSocket,
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

/** Everything `serveSurfaceApp` needs. The required half is the app's identity —
 *  what is served on the wire, what is served over HTTP, and where. Every option
 *  below it is observational or a shell-freshness passthrough. */
export interface ServeSurfaceAppOptions<Svc = never> extends FreshnessPaths {
  /** The served surface's flat `RpcGroup` — `runtime.group`. */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Every bound member handler keyed by wire tag — `runtime.handlers`. */
  readonly handlers: SurfaceHandlers;
  /** The built browser bundle, served fresh (`surfaceAppLayer`). */
  readonly clientDist: string;
  /** The web app manifest, if this app installs. */
  readonly manifest?: ManifestOptions;
  /** Which `/sw.js` worker to serve (default `"retire"`). */
  readonly serviceWorker?: ServiceWorkerMode;
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
  /** Liveness sweep cadence (defaults to `startWsHeartbeat`'s 30s). */
  readonly heartbeatIntervalMs?: number;
  /** Standing transport-error handler for every accepted socket. Defaults to
   *  `gateStaleSocket`'s loud `console.error`. */
  readonly onSocketError?: (err: Error, requestUrl: URL) => void;
  /** A tab bound to a previous process, closed at the handshake. Silent by
   *  default — a server that restarted while a tab was open is ordinary, not a
   *  fault — but every real consumer logs it. */
  readonly onStaleTab?: (claimedPid: string, requestUrl: URL) => void;
  /** A cross-site `Origin` refused before the upgrade. Defaults to a loud
   *  `console.warn`: a blocked hijack attempt that nobody can see is the one
   *  thing a shared gate must not ship. */
  readonly onDisallowedOrigin?: (origin: string | undefined) => void;
  /** This ONE connection's serving stack faulted. Defaults to a loud
   *  `console.error` — `SurfaceSocketServing.done` MUST be observed, and an
   *  ignored rejection is an unhandled one. */
  readonly onServingFailed?: (cause: unknown, requestUrl: URL) => void;
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
    // The HTTP handler's own scope. `makeHandler` forks each request as a fiber
    // in it, so it must outlive every in-flight request and die with the
    // listener — which is what the finalizer below does, last.
    const httpScope = Scope.makeUnsafe();
    const shell = surfaceAppLayer({
      clientDist: options.clientDist,
      manifest: options.manifest,
      serviceWorker: options.serviceWorker,
      assetPrefix: options.assetPrefix,
      shellPaths: options.shellPaths,
    });
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
    const acceptor = acceptSurfaceSocket({
      server: sockets,
      intervalMs: options.heartbeatIntervalMs,
      onError: options.onSocketError,
      onReject: options.onStaleTab,
    });

    sockets.on("connection", (peer, request: IncomingMessage) => {
      const url = requestUrl(request);
      acceptor.accept(peer, url, () => {
        const serving = serveSurfaceSocket({
          group: options.group,
          handlers: options.handlers,
          // `ws`'s socket satisfies `ServableSocket` structurally; its typings
          // narrow `addEventListener` per event name, which the seam does not.
          socket: peer as unknown as ServableSocket,
          services: options.services?.({ request, url }),
        });
        // A serving site owns its `done`: it resolves on hang-up and REJECTS if
        // the serving stack failed. An ignored rejection is an unhandled one,
        // and one dead socket must never take the listener with it.
        serving.done.catch((cause: unknown) => {
          if (options.onServingFailed) options.onServingFailed(cause, url);
          else
            console.error(
              `serveSurfaceApp: serving stack faulted for ${url.href} (pass \`onServingFailed\` to handle this).`,
              cause,
            );
        });
      });
    });

    server.on("upgrade", (request, socket, head) => {
      if (requestUrl(request).pathname !== SURFACE_WS_PATH) {
        socket.destroy();
        return;
      }
      // Cross-site websocket hijacking is refused on the RAW socket, before the
      // upgrade — after it, the attacker page has a connection to argue about.
      if (
        gateWsOrigin(request, socket, {
          allowedOrigins: options.allowedOrigins,
          onReject:
            options.onDisallowedOrigin ??
            ((origin) =>
              console.warn(
                `serveSurfaceApp: refused a websocket upgrade from disallowed Origin ${String(origin)} (pass \`onDisallowedOrigin\` to handle this).`,
              )),
        })
      ) {
        return;
      }
      sockets.handleUpgrade(request, socket, head, (ws) =>
        sockets.emit("connection", ws, request),
      );
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
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        acceptor.stop();
        for (const client of sockets.clients) client.terminate();
        sockets.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        // Last: the HTTP handler's fibers, once nothing can arrive for them.
        await Effect.runPromise(Scope.close(httpScope, Exit.void));
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
      if (info === null || typeof info === "string") {
        failed(`expected a TCP address, got ${JSON.stringify(info)}`);
        return;
      }
      resume(Effect.succeed(originOf(info)));
    });
  });

/** The origin a browser can be pointed at. An IPv6 literal is bracketed —
 *  `http://::1:7714` is not a URL, and the one thing this string is for is being
 *  pasted somewhere that parses it. */
const originOf = (info: AddressInfo): string =>
  `http://${info.address.includes(":") ? `[${info.address}]` : info.address}:${info.port}`;
