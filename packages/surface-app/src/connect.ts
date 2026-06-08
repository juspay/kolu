/**
 * @kolu/surface-app/connect — the client transport assembly for a surface app's
 * stale-tab handshake.
 *
 * Both kolu and drishti hand-rolled the SAME two pieces on top of partysocket:
 *
 *   1. the `pid`-echo mutable + URL-param threading (`lastServerProcessId` +
 *      `rememberServerProcessId` + appending `?pid=` on every reconnect), and
 *   2. the `new PartySocket(urlThunk, …)` construction with that echo'd URL plus
 *      — for a socket NO lifecycle watches — the stale-close → `retireSocket`
 *      listener.
 *
 * This module owns both, so a consumer brings only its URL, its reconnect
 * options, and whether the socket self-retires. The lifecycle + clients assembly
 * stays with the consumer ON PURPOSE: kolu derives its lifecycle in `rpc.ts`,
 * drishti via `<SurfaceAppProvider>`, and drishti runs MANY sockets (per-host +
 * one admin) sharing ONE echo — so a single god-factory bundling socket + clients
 * + lifecycle would fit neither. The shared duplication is the echo and the
 * socket; that is what graduates here.
 *
 * Framework-free (no SolidJS): pure transport, like its sibling `./lifecycle`.
 * This is where @kolu/surface-app's commitment to partysocket becomes explicit —
 * the one `new PartySocket(...)` in the package (see the surface-connection note).
 */

import { WebSocket as PartySocket } from "partysocket";
import { SERVER_PROCESS_ID_PARAM, STALE_PROCESS_CLOSE_CODE } from "./index";
import { retireSocket } from "./lifecycle";

/** The `pid` handshake echo: the client's record of the last server `processId`
 *  it observed, threaded back as the `pid` query param on every (re)connect so a
 *  RESTARTED server can recognize and reject a stale tab at the handshake. One
 *  echo per app — kolu has a single socket so it owns one implicitly; drishti
 *  shares ONE echo across its per-host + admin sockets, all fed by the admin
 *  socket's lifecycle. */
export interface ProcessIdEcho {
  /** Record the latest observed server `processId`. Wire this to
   *  `createServerLifecycle`'s `onProcessId` (or `<SurfaceAppProvider onProcessId>`)
   *  so each probe result updates the echo. Closure-based (no `this`), so the
   *  bound method is safe to detach and pass as a callback. */
  remember: (processId: string) => void;
  /** Append `?pid=<last>` (or `&pid=`) to a URL — respecting an existing query
   *  string (drishti's `?host=`). A no-op until the first id is observed, so the
   *  first-ever connect omits the param. */
  appendTo: (url: string) => string;
}

/** A fresh `pid` echo. Pass the SAME instance to every `createSurfaceSocket` that
 *  must echo one server's identity (drishti's per-host + admin sockets); omit it
 *  and `createSurfaceSocket` builds a private one (kolu's single socket). */
export function createProcessIdEcho(): ProcessIdEcho {
  let last: string | null = null;
  return {
    remember: (processId) => {
      last = processId;
    },
    appendTo: (url) => {
      if (last === null) return url;
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}${SERVER_PROCESS_ID_PARAM}=${encodeURIComponent(last)}`;
    },
  };
}

/** The structural socket `retireOnStaleClose` drives — a partysocket, reduced to
 *  the verbs it touches (observe `close`, then `retireSocket`'s `{ close, send }`). */
type RetireableSocket = {
  addEventListener: (
    type: "close",
    listener: (event: { code?: number }) => void,
  ) => void;
} & Parameters<typeof retireSocket>[0];

/** Retire a socket the server closed as stale — for a socket NO lifecycle watches
 *  (drishti's per-host sockets, which have no provider/`createServerLifecycle`).
 *  On a close whose code is `restartCloseCode`, run `retireSocket(ws)` so neither
 *  partysocket's offline buffer nor oRPC's pending peers grow unbounded; other
 *  close codes are ordinary transient drops partysocket reconnects through. A
 *  socket OWNED by `createServerLifecycle` / `<SurfaceAppProvider>` leaves this
 *  off and lets the lifecycle's `onStaleRestart` do the retiring (one decode
 *  site, no double-retire). Exported for direct testing; `createSurfaceSocket`
 *  wires it when `retireOnStaleClose` is set. */
export function retireOnStaleClose(
  ws: RetireableSocket,
  restartCloseCode: number,
): void {
  ws.addEventListener("close", (event) => {
    if (event.code === restartCloseCode) retireSocket(ws);
  });
}

/** Options for `createSurfaceSocket`. */
export interface SurfaceSocketOptions {
  /** Base WS URL — a string (kolu's fixed `/rpc/ws`), or a thunk re-evaluated on
   *  every reconnect when the base itself varies (drishti's per-host `?host=`).
   *  The `pid` echo is appended on top, so don't add it here. */
  url: string | (() => string);
  /** The shared `pid` echo. Omit to build a private one (returned as `.echo`);
   *  pass a shared instance when several sockets echo one server (drishti). */
  echo?: ProcessIdEcho;
  /** partysocket reconnect options (e.g. a longer `connectionTimeout` for a
   *  cold-starting server — drishti's 60s agent-provision window). */
  socketOptions?: ConstructorParameters<typeof PartySocket>[2];
  /** Self-retire on the server's stale-close (a socket with no lifecycle/provider
   *  watching it). See `retireOnStaleClose`. */
  retireOnStaleClose?: boolean;
  /** The stale-close code to match when `retireOnStaleClose` is set. Defaults to
   *  `STALE_PROCESS_CLOSE_CODE` (the code surface-app's server gate closes with). */
  restartCloseCode?: number;
}

/** A constructed surface socket and the echo feeding its `pid` param. */
export interface SurfaceSocket {
  /** The reconnecting partysocket. Build the oRPC link over it
   *  (`websocketLink(ws as unknown as WebSocket)`) and, if it carries the
   *  lifecycle, hand it to `createServerLifecycle` / `<SurfaceAppProvider>`. */
  ws: PartySocket;
  /** The echo this socket reads. When the caller passed one in, this is that same
   *  instance; otherwise it's the private one created here — wire its `remember`
   *  to the lifecycle's `onProcessId`. */
  echo: ProcessIdEcho;
}

/** Construct a surface app's reconnecting WebSocket with the `pid` handshake
 *  wired in: the URL thunk appends the echo'd `pid` on every reconnect, and (when
 *  `retireOnStaleClose` is set) a stale-close retires the socket. Owns the one
 *  `new PartySocket(...)` both consumers used to hand-roll; the link + clients +
 *  lifecycle stay with the caller. */
export function createSurfaceSocket(opts: SurfaceSocketOptions): SurfaceSocket {
  const echo = opts.echo ?? createProcessIdEcho();
  const resolveBase =
    typeof opts.url === "function" ? opts.url : () => opts.url as string;
  // The URL is a THUNK so partysocket re-reads the latest echo'd `pid` on every
  // reconnect — that's how a tab that was live across a restart re-presents the
  // (now stale) id and is re-rejected until a fresh page resets it.
  const ws = new PartySocket(
    () => echo.appendTo(resolveBase()),
    undefined,
    opts.socketOptions,
  );
  if (opts.retireOnStaleClose) {
    retireOnStaleClose(ws, opts.restartCloseCode ?? STALE_PROCESS_CLOSE_CODE);
  }
  return { ws, echo };
}
