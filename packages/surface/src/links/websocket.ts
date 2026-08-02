/**
 * WebSocket link — the BROWSER leg of the link family (`stdioLink` for
 * subprocess/ssh, `unixSocketLink` for a local daemon, `directLink` in-process).
 *
 * It owns the dial, not just the socket: PLAN D5 makes the surface responsible
 * for the three affordances Effect's own socket layer does not expose to a
 * caller, each of which is a recorded incident rather than a nicety:
 *
 *  1. **A URL thunk re-evaluated on EVERY (re)dial** (review #6c). The connect
 *     URL carries the server's process id, and a reconnect that re-presents a
 *     stale pid is closed again immediately. `Socket.fromWebSocket` acquires
 *     its socket per run and the run is retried, so calling `opts.url()` inside
 *     the acquire is precisely "re-evaluated on every dial".
 *  2. **A terminal-close classifier** (review #5). A close code the app calls
 *     terminal (kolu: surface-app's `STALE_PROCESS_CLOSE_CODE`, 4001) RETIRES
 *     the wire: the retry schedule stops, and every in-flight and future call
 *     fails with `SurfaceTransportRetired`. Without it, connection-level
 *     infinite retry turns the stale-tab retirement into a reconnect storm that
 *     re-presents the same stale pid forever. The classifier is a REQUIRED
 *     option, not a default: the close-code vocabulary belongs to the app that
 *     serves the socket (`@kolu/surface-app` — a package this one may not
 *     depend on, the dependency arrow points the other way), and a link that
 *     guessed it would be guessing about when to stop retrying.
 *  3. **A {@link WatchableWire}** (review #4). `createLiveSignal`'s half-open
 *     watchdog needs open/close observability plus an imperative recovery
 *     action; a websocket can sit `open` at the OS level with no bytes flowing,
 *     which is why the dispatch is branded half-open at the seam and why the
 *     watchdog — not the socket — is the source of truth for liveness.
 *
 * There is NO partysocket: reconnect is Effect's socket retry, driven by the
 * schedule below.
 */

import { Cause, Duration, Effect, Layer, Schedule } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { SurfaceTransportRetired } from "../errors";
import type { WireStatus, WireTransport } from "../link";
import { openWireLink, type WireLink } from "./wire";

/** Close code the link itself uses when {@link WatchableWire.forceReconnect}
 *  severs a wedged-but-open socket. A NORMAL closure (1000) on purpose: the
 *  watchdog is recovering the link, so the classifier must see an ordinary
 *  close and the schedule must re-dial. */
const FORCE_RECONNECT_CLOSE_CODE = 1000;

/** Reconnect backoff, reproducing Effect's own socket default (exponential
 *  from 500ms, factor 1.5, capped at 5s) with ONE addition: the schedule HALTS
 *  the moment the wire is retired, which is what makes "a terminal close ⇒
 *  exactly one close, zero re-dials" a property of the mechanism rather than of
 *  a caller remembering to tear the link down. */
function reconnectSchedule(
  isRetired: () => boolean,
): Schedule.Schedule<number, Socket.SocketError> {
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<Socket.SocketError>) =>
      isRetired()
        ? Cause.done(meta.attempt)
        : Effect.succeed([
            meta.attempt,
            Duration.millis(Math.min(500 * 1.5 ** (meta.attempt - 1), 5000)),
          ] as [number, Duration.Duration]),
    ),
  );
}

export interface WebsocketLinkOptions {
  /** The served surface's flat `RpcGroup` (`surface.group`). */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** The connect URL, re-evaluated on EVERY (re)dial — see (1) above. */
  readonly url: () => string;
  /** Does this close code RETIRE the wire? See (2) above. */
  readonly isTerminalClose: (code: number) => boolean;
  /** The platform's WebSocket constructor — the same seam Effect models as
   *  `Socket.WebSocketConstructor`, in the plain-function shape this
   *  Promise-facing API can accept. Omitted in a browser; supplied by a test
   *  (or a Node host) that has no `globalThis.WebSocket`. */
  readonly connect?: (url: string) => WebSocket;
}

/** A {@link WireTransport} (the `{ dispatch, wire }` pair `createLiveSignal`
 *  takes as ONE value, so the watchdog cannot probe a different socket than it
 *  reconnects) plus the link's own `dispose`. */
export interface WebsocketLink extends WireLink, WireTransport {}

/** Open a websocket link to `url()`, returning the branded dispatch, the
 *  watchable wire, and the `dispose` that closes the socket for good. */
export async function websocketLink(
  opts: WebsocketLinkOptions,
): Promise<WebsocketLink> {
  const connect =
    opts.connect ??
    ((url: string) => {
      const ctor = globalThis.WebSocket;
      if (ctor === undefined) {
        throw new Error(
          "websocketLink: no globalThis.WebSocket in this runtime — pass `connect` (the platform's WebSocket constructor).",
        );
      }
      return new ctor(url);
    });

  let status: WireStatus = "connecting";
  const watchers = new Set<(s: WireStatus) => void>();
  const setStatus = (next: WireStatus): void => {
    if (next === status) return;
    status = next;
    for (const watcher of watchers) watcher(next);
  };

  // Set by the close classifier, read by the retry schedule AND by the error
  // vocabulary — ONE flag, so "stopped retrying" and "fails with
  // SurfaceTransportRetired" can never disagree about whether the wire is
  // retired. It is set from the socket's own 'close' listener, registered when
  // the socket is CONSTRUCTED (before Effect adds its own), so it is already
  // true by the time the run's failure reaches an in-flight call.
  let retired = false;
  let retiredCode: number | undefined;
  let currentSocket: WebSocket | undefined;

  const socket = await Effect.runPromise(
    Socket.fromWebSocket(
      Effect.acquireRelease(
        Effect.sync(() => {
          setStatus("connecting");
          const ws = connect(opts.url());
          currentSocket = ws;
          ws.addEventListener("open", () => setStatus("open"), { once: true });
          ws.addEventListener(
            "close",
            (event: Event) => {
              const code = (event as CloseEvent).code;
              if (typeof code === "number" && opts.isTerminalClose(code)) {
                retired = true;
                retiredCode = code;
              }
              // `retired` is TERMINAL and is raised INSTEAD of `closed`: the
              // schedule below will not re-dial, so a watchdog that saw
              // `closed` would sit waiting for a reconnect that can never come.
              setStatus(retired ? "retired" : "closed");
            },
            { once: true },
          );
          ws.addEventListener(
            "error",
            () => setStatus(retired ? "retired" : "closed"),
            { once: true },
          );
          return ws;
        }),
        (ws) =>
          Effect.sync(() => {
            if (currentSocket === ws) currentSocket = undefined;
            // 0 CONNECTING / 1 OPEN — anything else is already closing.
            if (ws.readyState <= 1) ws.close(FORCE_RECONNECT_CLOSE_CODE);
          }),
      ),
    ),
  );

  const protocol = Layer.effect(RpcClient.Protocol)(
    RpcClient.makeProtocolSocket({
      // Suppresses the failure broadcast while a socket that never OPENED is
      // being re-dialled (`SocketOpenError`); a live socket CLOSING still
      // broadcasts, which is what the face's retry fence needs to see.
      retryTransientErrors: true,
      retryPolicy: reconnectSchedule(() => retired),
    }),
  ).pipe(
    Layer.provide([
      Layer.succeed(Socket.Socket)(socket),
      RpcSerialization.layerNdjson,
    ]),
  );

  const link = await openWireLink({
    group: opts.group,
    protocol,
    transportError: (failure) =>
      retired
        ? new SurfaceTransportRetired({
            reason:
              failure.kind === "disposed"
                ? "the link was disposed after the server retired this socket"
                : `the server closed this socket with code ${retiredCode} (${failure.error.message})`,
          })
        : failure.kind === "disposed"
          ? new SurfaceTransportRetired({
              reason: "the link was disposed; request not sent",
            })
          : // NOT retired: hand the transport failure through unchanged. It is
            // the `RpcClientError` the face's per-subscription retry fence
            // (D3/#12) retries on — translating it here would silently make
            // every reconnect permanent.
            failure.error,
  });

  return {
    dispatch: link.dispatch,
    dispose: link.dispose,
    wire: {
      status: () => status,
      onStatus: (cb) => {
        watchers.add(cb);
        return () => {
          watchers.delete(cb);
        };
      },
      // Sever the socket the protocol currently holds; its run fails with a
      // close, the schedule re-dials, and the acquire re-evaluates the URL
      // thunk. (Effect's socket layer exposes no re-dial handle, and
      // interrupting the protocol fiber would kill the transport rather than
      // recycle it — closing the socket IS the re-dial, review #4.) A no-op
      // while a re-dial is already in flight: there is no socket to sever.
      forceReconnect: () => {
        const ws = currentSocket;
        if (ws !== undefined && ws.readyState <= 1) {
          ws.close(FORCE_RECONNECT_CLOSE_CODE);
        }
      },
    },
  };
}
