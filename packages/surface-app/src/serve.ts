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
 * ## kolu rides it too, and that is what shaped the options
 *
 * kolu (`packages/server/src/index.ts`) is the second in-tree plug. It hand-wired
 * until three named gaps closed, and each option below landed with that
 * migration rather than ahead of it:
 *
 *   - {@link ServeSurfaceAppOptions.tls} — kolu serves HTTPS when TLS material is
 *     configured, so the server here is an `https.Server` when TLS options are
 *     given and a plaintext `http.Server` otherwise. TLS OPTIONS and not a
 *     caller-supplied `Server`: this module owning the server is precisely what
 *     keeps the `upgrade` event ours (below), so the one thing it cannot accept
 *     is somebody else's.
 *   - {@link ServeSurfaceAppOptions.middleware} — kolu bridges its HTTP surface
 *     to pino (`koluHttpMiddleware`), which is a `makeHandler` middleware and has
 *     nowhere else to be installed.
 *   - `clientDist` is now OPTIONAL — fixed in `SurfaceAppLayerOptions` itself,
 *     not worked around here. kolu serves its manifest UNCONDITIONALLY (its dev
 *     proxy forwards `/manifest.webmanifest` to a server with no built client)
 *     and its statics only when a dist exists; it hand-composed
 *     `pwaManifestLayer` + `freshStaticLayer` *because* `surfaceAppLayer` paired
 *     the two. Unpairing them at the source dissolves the reason instead of
 *     routing around it.
 *
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
 * ## The upgrade's headers are an ALLOWLIST, and the default is empty
 *
 * A surface app's live wire is one websocket, so its ONE request is the upgrade
 * — and a header a reverse proxy stamps there (`Tailscale-User-Login`) is the
 * only per-connection claim about WHO is calling that the wire can carry. This
 * module owns the upgrade, so on THIS path it is the only thing that can hand
 * one on. (A hand-built path — `acceptSurfaceSocket` + `serveSurfaceSocket`,
 * which drishti's per-host dispatch uses — is standing in its own `upgrade`
 * handler holding the request, so it reads what it needs directly and this
 * option has nothing to offer it. Same split as `expose`: the face that owns
 * the door takes the policy at bind; the hand-built one applies its own.)
 *
 * It hands on the ones the app NAMED (`upgradeHeaders`) and no others, as VALUES
 * on {@link SurfaceAppConnection}. Not the `IncomingMessage`, which is what this
 * used to carry: that is the whole header bag, `Cookie` and `Authorization`
 * included, and a per-connection `Layer` a year from now would reach into it for
 * one field and put the rest one `JSON.stringify` away from a log line. The
 * allowlist is not a filter over a thing you could still get at — it IS the
 * access, so the leak has nowhere to be expressed.
 *
 * What that costs is deliberate too: a header nobody named is not available at
 * all, and adding one is an edit at the app's composition root. That edit is the
 * app saying it trusts the proxy that writes that header, which is the one part
 * of this nothing downstream can decide.
 *
 * ### The allowlist can be LIVE, and a bad live list refuses itself
 *
 * `upgradeHeaders` takes an array OR a thunk of one. The array is the app's own
 * composition root and is checked at the bind. The thunk is a live fact — an app
 * whose identity part offers a header only while it is switched on — and is read,
 * and checked, at each accept, the way the served generation is.
 *
 * A live list that names something this seam cannot read is the OFFERING part's
 * defect, not the wire's, so it does not travel: the socket is accepted and
 * served with NO named headers — every request on it reads as nobody, which is
 * the state an app already defines for "no identity" — and the fault is reported
 * as `UpgradeHeadersRefused`. Terminating instead would let one part's bad list
 * take every connection down with it, and throwing would take the process; both
 * are the failure a live allowlist exists to survive. An app that wants the
 * defect louder calls {@link checkUpgradeHeaders} where it MINTS the list, so
 * that part fails there and the accept-time arm is only the offer/accept race.
 *
 * The ruling is written where it is TAKEN — at the accept, beside the served
 * generation's own refusal, because the difference between the two (a refused
 * generation terminates the socket; a refused allowlist serves it anonymously)
 * is the design. The report fires at EACH accept that reads a bad list, for as
 * long as the offering part keeps minting one: each of those accepts really did
 * serve an anonymous connection, and suppressing repeats would leave a refusal
 * that started after the first one unnarrated.
 *
 * The empty list is NOT a caught error collapsing into "no data": a legitimate
 * empty allowlist and a refused one are distinguishable, because the refused one
 * emits a typed {@link SurfaceAppEvent} arm a consumer's own `onEvent` receives
 * as a value (the `console.error` is only the DEFAULT policy's answer to it).
 * What is deliberately absent is any way to ask for the other behaviours — no
 * knob restores the bind-once read, and no option silences the arm.
 *
 * ### Naming a header says who may WRITE it, and that is a precondition, not a check
 *
 * What arrives on {@link SurfaceAppConnection.headers} is whatever was on the
 * upgrade — this seam reports, it does not authenticate. A client dialling the
 * listener directly can send `Tailscale-User-Login` itself, and it will be
 * handed to `services` as faithfully as a proxy's own. So naming a header is
 * sound ONLY when the proxy OWNS it: strips or overwrites any inbound copy, and
 * is the only way in (the listener bound to loopback or a tailnet). Naming one
 * the proxy merely PASSES THROUGH hands every caller a claim they wrote about
 * themselves.
 *
 * This module cannot check that for you — the deployment is not visible from
 * here, which is exactly why the naming is the app's to do. Where the check CAN
 * live, it does: kolu's `x-forwarded-for` is safe because
 * `viewerAddressOf` (`@kolu/surface/viewer-identity`) weighs the claim against
 * the direct peer, and that gate is in the surface package, NOT at this seam —
 * an app that names an identity header gets the value, never that judgment.
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
 *
 * ## The served set is read at each accept
 *
 * The generation is {@link ServedGenerationSource} (`@kolu/surface/expose`):
 * `{ group, handlers, expose? }` is the generation written at the call, and
 * `{ live: () => ({ group, handlers, expose? }) }` is re-read at each accept,
 * as a pair. The per-connection `serveSurfaceSocket` is built over that
 * generation, so a runtime whose served set MOVES (`implementRootedSurfaces`)
 * is served the roster that is current then — a socket accepted after a mount
 * is indistinguishable from one accepted on a boot that already had that
 * sibling.
 *
 * A connection accepted BEFORE the roster moved keeps the generation it was
 * built over until the client redials. That is the honest half of Effect RPC:
 * an `RpcServer` is baked over a group at construction, and a drop still
 * reaches it (the refusing wrapper rides the captured record). The client's
 * redial is what brings a new accept. `serveOverUnixSocket` takes the same
 * source.
 */

import {
  createServer as createHttpServer,
  type IncomingMessage,
} from "node:http";
import {
  createServer as createHttpsServer,
  type ServerOptions as HttpsServerOptions,
} from "node:https";
import type { AddressInfo, Server as NetServer } from "node:net";
import { NodeHttpServer } from "@effect/platform-node";
import {
  restrictServedGeneration,
  type ServedGenerationSource,
} from "@kolu/surface/expose";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import { gateWsOrigin } from "@kolu/surface/ws-origin";
import { hostAuthority } from "@kolu/url-shape";
import { Data, Effect, type FileSystem, Layer, type Path, Scope } from "effect";
import {
  type HttpPlatform,
  HttpRouter,
  type HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import { WebSocketServer } from "ws";
import { SURFACE_WS_PATH } from "./index";
import { checkUpgradeHeaders, pickUpgradeHeaders } from "./upgradeHeaders";
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
 *  be built from — VALUES read off the upgrade, never the upgrade itself.
 *
 *  Every arm of {@link SurfaceAppEvent} that describes a given connection is
 *  handed the SAME object — so a consumer may key a map on it — but {@link id} is
 *  what a LOG line wants: a listener-scoped ordinal, stable across the arms and
 *  short enough to read, which is what kolu's per-connection `ws:` field has
 *  always been. Not global and not a uuid: it identifies a connection within one
 *  listener's lifetime, which is the only span anything correlates over. */
export interface SurfaceAppConnection<H extends string = never> {
  /** This connection's ordinal within this listener — 1 for the first accepted. */
  readonly id: number;
  /** The upgrade's request target (the `pid` echo, a `?host=` selector) — a
   *  live `URL`, shared by every arm that describes this connection: read it,
   *  do not mutate it. */
  readonly url: URL;
  /** The DIRECT TCP peer of this connection, or `undefined` when the socket
   *  cannot tell. Never a guess. Behind a reverse proxy this is the PROXY, and
   *  the viewer's own address is in a forwarded header — which is why an app
   *  that needs both names the header in {@link
   *  ServeSurfaceAppOptions.upgradeHeaders} and weighs the two itself. */
  readonly remoteAddress: string | undefined;
  /** The headers the app NAMED in {@link ServeSurfaceAppOptions.upgradeHeaders},
   *  as read at upgrade.
   *
   *  The KEYS ARE THE NAMES — `H` is inferred from the allowlist, so reading a
   *  name that was never asked for does not compile. A named header the request
   *  did not carry is ABSENT, so `undefined` means "not sent" and `""` means
   *  "sent empty" — two different facts to a consumer deciding whether to trust
   *  a proxy claim.
   *
   *  Why it is an allowlist, and why an unnamed read must not compile: this
   *  module's header, "The upgrade's headers are an ALLOWLIST". */
  readonly headers: Readonly<Partial<Record<H, string>>>;
}

/** The allowlist's grammar, re-exported at the door an app already imports from
 *  — so an app that ASSEMBLES its list (a part that offers its identity header
 *  when it is switched on) can refuse a bad name where it MINTS the list, loudly,
 *  instead of leaving it to the quiet accept-time refusal below. The rule, and
 *  why an accept cannot afford to throw it, live in `./upgradeHeaders`. */
export { checkUpgradeHeaders } from "./upgradeHeaders";

/** A thrown `cause` as the `Error` an event arm carries. */
const errorOf = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

/** How an accept obtains its allowlist, resolved ONCE at the bind.
 *
 *  A FIXED array is checked HERE and handed back unchanged at every accept: a
 *  name no header can match is a defect the app wrote into its own composition
 *  root, and a defect belongs at the bind rather than at the first upgrade that
 *  happens to arrive hours later. That check THROWS, taking the bind with it —
 *  the array IS the app, so there is nothing else to blame, and this arm can
 *  never throw again.
 *
 *  A THUNK is a LIVE fact, read and checked at each accept — and NOT at the
 *  bind, which is where this parts company with the generation resolved one line
 *  above it (see there for why). It throws AT THE ACCEPT, for the caller to
 *  answer beside the served generation's own refusal, so the one interesting
 *  thing about this pair — a refused generation terminates the socket, a refused
 *  allowlist does not — is legible where both are decided. What a refusal COSTS
 *  is not this function's business; WHEN the list is read, is.
 *
 *  Returned as a closure rather than branched at each accept so the fixed arm
 *  pays its check exactly once. */
const upgradeHeadersReader = <H extends string>(
  asked: ReadonlyArray<H> | (() => ReadonlyArray<H>) | undefined,
): (() => ReadonlyArray<H>) => {
  if (typeof asked !== "function") {
    const checked = checkUpgradeHeaders(asked ?? []);
    return () => checked;
  }
  return () => checkUpgradeHeaders(asked());
};

/** Something the listener wants narrated. ONE sink, because every consumer has
 *  exactly one logger: the four separate callbacks this replaced were the same
 *  pino / `log` threaded four times, with their defaults scattered across three
 *  modules.
 *
 *  What an arm carries says WHOSE fault it describes, and that is structural.
 *  An arm carries a {@link SurfaceAppConnection} when its subject IS that
 *  connection. The arms carrying a `url` instead are two kinds, and neither has
 *  a connection to name: the ones that fire before there is one at all
 *  (`DisallowedOrigin`, `StaleTab`, and `SocketError` — whose handler the stale
 *  gate installs before enrolment), and the ones whose subject is what the
 *  LISTENER was handed rather than the socket in front of it
 *  (`GenerationRefused`, `UpgradeHeadersRefused`). A live generation or a live
 *  allowlist that named something unservable is wrong for every accept, so
 *  filing it against the one socket that happened to arrive would read as that
 *  socket being at fault. Either way the `url` is parsed one line before the
 *  origin gate runs, so the sink never has to say "some upgrade, somewhere". */
export type SurfaceAppEvent<H extends string = never> =
  /** Gated, enrolled, and about to be served. The place a live-connection count
   *  increments and a consumer writes its `connected` line. */
  | { readonly _tag: "Connected"; readonly connection: SurfaceAppConnection<H> }
  /** That same connection hung up (peer, reaper, or our own teardown), with the
   *  close frame's own account of why: a `1006` with no reason is an abrupt drop,
   *  a `1009` is the frame cap (`FRAME_TOO_LARGE_CLOSE_CODE`), and a reaper's
   *  terminate looks different again. Carried because an operator reading
   *  "disconnected" needs the code to tell those apart — `reason` is decoded to a
   *  string here (`ws` hands it over as a `Buffer`) and is `""` when the peer
   *  sent none, which is the ordinary case. */
  | {
      readonly _tag: "Disconnected";
      readonly connection: SurfaceAppConnection<H>;
      readonly code: number;
      readonly reason: string;
    }
  /** A transport error on an accepted socket. */
  | { readonly _tag: "SocketError"; readonly error: Error; readonly url: URL }
  /** A live generation `restrictHandlers` refused — the expose no longer
   *  describes the served group. The socket is TERMINATED: there is no honest
   *  reduced thing to serve when the served set itself is unservable, and a
   *  `Connected` for a socket we then refuse would be a count that cannot pair. */
  | {
      readonly _tag: "GenerationRefused";
      readonly error: Error;
      readonly url: URL;
    }
  /** A live `upgradeHeaders` named something this seam cannot read off an
   *  upgrade. Unlike a refused generation the connection IS served — with no
   *  named headers, so every request on it reads as nobody — because a bad list
   *  is the OFFERING part's defect and must not reach the wire's other tenants.
   *  The `url` rather than the connection for the reason above: what was refused
   *  is the listener's allowlist, not this socket. */
  | {
      readonly _tag: "UpgradeHeadersRefused";
      readonly error: Error;
      readonly url: URL;
    }
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
      readonly connection: SurfaceAppConnection<H>;
    };

/** What a listener says when nobody is listening: loud on every fault, silent on
 *  the ordinary. A restarted server closing a tab bound to the previous process
 *  is ordinary, and so is a connection opening or closing — but a refused hijack
 *  attempt, a transport error, or a faulted serving stack that nobody can see is
 *  the one thing a shared listener must not ship.
 *
 *  Exported so it is readable and testable as a policy, and so a consumer's own
 *  `onEvent` can delegate to it for the arms it does not care about. */
export const reportSurfaceAppEvent = (event: SurfaceAppEvent<string>): void => {
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
    case "GenerationRefused":
      console.error(
        `serveSurfaceApp: live generation refused on ${event.url.href}`,
        event.error,
      );
      return;
    case "UpgradeHeadersRefused":
      console.error(
        `serveSurfaceApp: live upgradeHeaders refused on ${event.url.href} — this connection carries no named headers`,
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

/** An HTTP middleware `serveSurfaceApp` installs on the request handler, spelled
 *  PRECISELY rather than as Effect's own `HttpMiddleware` interface.
 *
 *  `HttpMiddleware` answers `Effect<HttpServerResponse, any, any>` — it erases
 *  the wrapped app's error and service channels. That erasure is not free here:
 *  `NodeHttpServer.makeHandler` derives its own requirement from the MIDDLEWARE's
 *  result, so an `any` there surfaces as an `any` requirement on the whole
 *  handler, which nothing can then discharge (an `any` requirement is not
 *  `never`, so the handler fails to run). Stating the transformation exactly
 *  keeps it honest: a middleware may not change the error type or the response
 *  type, and may add exactly ONE requirement — `HttpServerRequest`, which the
 *  node handler provides per request. */
export type SurfaceAppHttpMiddleware = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
>;

/** Everything `serveSurfaceApp` needs besides the served generation. The
 *  required half is the app's identity — what is served over HTTP, and where.
 *  The generation is {@link ServedGenerationSource}, so `{ group, handlers }`
 *  is today's call and `{ live: () => ({ group, handlers, expose? }) }` is
 *  a live roster. */
type ServeSurfaceAppShell<
  Svc = never,
  H extends string = never,
> = SurfaceAppLayerOptions & {
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
    // A route that can FAIL carries its error as a `Request<"Error", E>` mark on
    // the layer's requirement, and `toHttpEffect` lifts those marks into the
    // handler's error channel — where the 500 path, and any `middleware`, answers
    // them. kolu's artifact-sdk bundle route is the in-tree case. ERROR marks
    // ONLY: a `Request<"Requires", …>` is a per-request service nothing at this
    // seam can discharge, so a route that needs one is a type error here rather
    // than an unsatisfied requirement at runtime.
    | HttpRouter.Request<"Error", unknown>
    | HttpRouter.Request<"GlobalError", unknown>
  >;
  readonly host: string;
  readonly port: number;
  /** TLS material. Present, the listener is an `https.Server` and the URL it
   *  returns is an `https://` one; absent, a plaintext `http.Server`. Resolving
   *  the material — a key pair on disk, a `tailscale cert`, nothing at all — is
   *  the app's decision, and passing `undefined` for "no TLS" is what says so. */
  readonly tls?: HttpsServerOptions;
  /** Wrap every HTTP request — an app's bridge from the serving stack to its own
   *  logger, and where an uncaught route fault gets logged before the 500 goes
   *  out. Only the HTTP leg: the websocket is upgraded off the `upgrade` event,
   *  which never reaches the request handler. */
  readonly middleware?: SurfaceAppHttpMiddleware;
  /** Browser origins allowed to open the websocket, beyond same-origin — the
   *  reverse-proxy / `tailscale serve` escape hatch. `parseAllowedOrigins`
   *  (`@kolu/surface/ws-origin`) of the app's own env var. */
  readonly allowedOrigins: ReadonlyArray<string>;
  /** The request headers this app wants off the upgrade, by name — the only way
   *  a header reaches {@link SurfaceAppConnection.headers}. Empty by default.
   *
   *  Matched case-insensitively (HTTP field names are) and read back under the
   *  spelling used HERE — these strings are the KEYS of the connection's
   *  `headers`, and `H` infers from them, so a read that does not match one does
   *  not compile.
   *
   *  An ARRAY is this app's own composition root, read once: a name outside
   *  HTTP's grammar, or one wire header named twice, takes the bind down. A
   *  THUNK is a LIVE list — an app whose identity part offers a header only
   *  while it is switched on — re-read at each accept, where a bad name refuses
   *  the ALLOWLIST (`UpgradeHeadersRefused`, no named headers on that
   *  connection) rather than the socket or the process. The two arms are told
   *  apart by `typeof`: an array is never callable, so unlike the served
   *  generation there is nothing here to mistake for a thunk.
   *
   *  Why it is an ALLOWLIST, and why a live one refuses itself: this module's
   *  header. */
  readonly upgradeHeaders?: ReadonlyArray<H> | (() => ReadonlyArray<H>);
  /** Services this ONE connection's handlers require — kolu's per-viewer
   *  address, taken off the upgrade request. Effect's socket-server protocol
   *  carries no per-request headers, so a per-connection serving stack simply
   *  provides them. */
  readonly services?: (connection: SurfaceAppConnection<H>) => Layer.Layer<Svc>;
  /** Narrate a listener event — connects, disconnects, and every fault, on ONE
   *  sink. Defaults to {@link reportSurfaceAppEvent}. */
  readonly onEvent?: (event: SurfaceAppEvent<H>) => void;
};

/** Everything `serveSurfaceApp` needs: the shell, plus
 *  {@link ServedGenerationSource} — `{ group, handlers, expose? }` snapshotted
 *  at the call, or `{ live: () => ({ group, handlers, expose? }) }` re-read at
 *  each accept. */
export type ServeSurfaceAppOptions<
  Svc = never,
  H extends string = never,
> = ServeSurfaceAppShell<Svc, H> & ServedGenerationSource;

/**
 * Serve a surface app: the shell over HTTP, the surface over ONE websocket, in
 * the one correct order.
 *
 * Binds, and registers its whole teardown on the enclosing scope — so closing
 * that scope closes the sockets and no caller holds a shutdown function it might
 * forget to call. Returns the URL actually bound (the OS's answer, so `port: 0`
 * reports the port it was given).
 */
export const serveSurfaceApp = <Svc = never, H extends string = never>(
  options: ServeSurfaceAppOptions<Svc, H>,
): Effect.Effect<string, SurfaceAppListenFailed, Scope.Scope> =>
  Effect.gen(function* () {
    // The ONE sink, resolved once: every narration below goes through `report`,
    // so "what does this listener do when nobody is listening" has exactly one
    // answer and it is readable in one place.
    const report = options.onEvent ?? reportSurfaceAppEvent;
    // One generation, one turn — `restrictServedGeneration` reads the source
    // as a pair. Snapshot arm is the objects written at this call; live arm
    // is re-read at each accept. Applied here so a static mismatch still
    // fails before anyone connects.
    const servedAtAccept = () => restrictServedGeneration(options);
    servedAtAccept();
    // How an accept obtains its allowlist, resolved once here. A fixed array is
    // checked NOW, for the same reason a snapshot generation is applied now: a
    // name no header can match is a defect, and a defect belongs at the bind and
    // not at the first upgrade that happens to arrive hours later. A LIVE list is
    // NOT probed here, which is where this parts company with the live
    // generation: `restrictServedGeneration` calls its thunk at the bind on the
    // line above and lets a bad one take the bind down, because a generation the
    // listener cannot serve makes the listener pointless. A live allowlist is
    // legitimately EMPTY at the bind — the offering part has not switched on yet
    // — so a bind-time read proves nothing about the list any accept will
    // actually see, and refusing there would fail the very use case a thunk
    // exists for. It is read, and refuses itself, per accept — see there.
    const upgradeHeadersAt = upgradeHeadersReader(options.upgradeHeaders);
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

    // TLS material present ⇒ an `https.Server`. Everything below is written
    // against `net.Server`, which is what the two have in common and all that
    // binding, closing and reading an address needs.
    const server =
      options.tls === undefined
        ? createHttpServer()
        : createHttpsServer(options.tls);
    server.on(
      "request",
      yield* Effect.gen(function* () {
        const httpEffect = yield* HttpRouter.toHttpEffect(app);
        // BRANCHED rather than passed through as `Middleware | undefined`, for
        // two independent reasons. Types: `makeHandler` derives the handler's
        // whole requirement from the middleware's RESULT, and an optional one
        // leaves that inference nothing to read — the requirement lands as
        // `unknown`, which no scope can discharge. Behaviour: `makeHandler` does
        // not treat "no middleware" and "a middleware that returns its argument"
        // alike — it wraps a supplied one in an extra outer failure arm — so an
        // identity default would quietly change the shape of the path every
        // caller that passes no middleware is already on.
        return yield* options.middleware === undefined
          ? NodeHttpServer.makeHandler(httpEffect, { scope: httpScope })
          : NodeHttpServer.makeHandler(httpEffect, {
              scope: httpScope,
              middleware: options.middleware,
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
    let accepted = 0;
    // Teardown has begun. THIS module's own "stop accepting", not the server's:
    // the finalizer closes the listening socket LAST (see there), so between the
    // first finalizer line and that close the server is still listening and an
    // upgrade could still land. Without this flag such an upgrade would build a
    // whole serving stack behind the drain's back and never be awaited.
    let draining = false;

    server.on("upgrade", (request, socket, head) => {
      if (draining) {
        socket.destroy();
        return;
      }
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
          // The generation is read BEFORE there is a connection to narrate: a
          // mismatched live expose is an author defect, and a Connected event
          // for a socket we then refuse to serve would be a count that cannot
          // pair. The socket is terminated rather than left half-upgraded; the
          // error is reported rather than swallowed — existing connections
          // keep the generation they were accepted with.
          let served: ReturnType<typeof restrictServedGeneration>;
          try {
            served = servedAtAccept();
          } catch (cause) {
            peer.terminate();
            report({ _tag: "GenerationRefused", error: errorOf(cause), url });
            return;
          }
          // Gated and enrolled — so this is the first instant at which there IS a
          // connection to narrate, and the pair a live-connection count needs.
          //
          // The allowlist is read HERE, in the same turn as the generation: both
          // are what this listener serves at this accept, and the two refusals
          // are written side by side because their DIFFERENCE is the design. A
          // refused generation leaves nothing honest to serve, so the socket
          // goes. A refused allowlist is the OFFERING part's defect, and one
          // part's bad row must touch no sibling — the transport is a sibling —
          // so the socket is SERVED with no named headers, reading as nobody,
          // which is the state an app already defines for "no identity".
          // Reported before `Connected`, so the log reads in the order it
          // happened: why this connection is anonymous, then the connection.
          let named: ReadonlyArray<H>;
          try {
            named = upgradeHeadersAt();
          } catch (cause) {
            report({
              _tag: "UpgradeHeadersRefused",
              error: errorOf(cause),
              url,
            });
            named = [];
          }
          const connection: SurfaceAppConnection<H> = Object.freeze({
            id: ++accepted,
            url,
            remoteAddress: request.socket.remoteAddress,
            headers: pickUpgradeHeaders(request, named),
          });
          report({ _tag: "Connected", connection });
          peer.once("close", (code: number, reason: Buffer) =>
            report({
              _tag: "Disconnected",
              connection,
              code,
              reason: reason.toString(),
            }),
          );
          const serving = serveSurfaceSocket({
            group: served.group,
            handlers: served.handlers,
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
    //
    // THE ORDER OF THE LAST LINE IS LOAD-BEARING, and it is not a tidiness
    // preference: `server.close()` is called — and its callback awaited — only
    // once every socket is already gone. Registering it EARLIER (to lean on the
    // fact that node stops accepting synchronously) is what this used to do, and
    // it HANGS UNDER BUN: bun's `close` callback does not fire for a server that
    // still had an open socket when close was requested, so the finalizer never
    // settles, the runtime never unwinds, and a SIGINT'd process simply never
    // exits. Found downstream by olai's shutdown fence. Node is happy either way,
    // so nothing here would have caught it — hence this note. The "stop
    // accepting" job that early close was doing is `draining`'s now, which is
    // this module's own flag and therefore true on every runtime.
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        // 1. Refuse anything new. (`acceptor.stop()` only clears the heartbeat
        //    interval — it does not stop accepting, which is why `draining`
        //    exists.)
        draining = true;
        acceptor.stop();
        // 2. Release what is live, and WAIT for it — the drain.
        await Promise.all(
          [...servings].map((serving) => {
            serving.close();
            return serving.done.catch(() => {});
          }),
        );
        // 3. Drop every socket: the websockets, then the keep-alive HTTP
        //    connections a browser's own page requests left behind.
        for (const client of sockets.clients) client.terminate();
        sockets.close();
        server.closeAllConnections();
        // 4. ONLY NOW the listening socket, with nothing left for it to wait on.
        await new Promise<void>((resolve) => server.close(() => resolve()));
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
  server: NetServer,
  options: {
    readonly host: string;
    readonly port: number;
    readonly tls?: HttpsServerOptions;
  },
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
      resume(
        Effect.succeed(
          originOf(info, options.tls === undefined ? "http" : "https"),
        ),
      );
    });
  });

/** The origin a browser can be pointed at. The scheme is the one the listener
 *  ACTUALLY speaks, so an operator handed this string can follow it. The
 *  bracketing of an IPv6 literal is {@link hostAuthority}'s, not re-derived here
 *  — `http://::1:7714` is not a URL, and the one thing this string is for is
 *  being pasted somewhere that parses it. */
const originOf = (info: AddressInfo, scheme: "http" | "https"): string =>
  `${scheme}://${hostAuthority(info.address, info.port)}`;
