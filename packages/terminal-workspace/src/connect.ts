/**
 * `@kolu/terminal-workspace/connect` — the CLIENT twin of `serveTerminalWorkspace`.
 *
 * `serveTerminalWorkspace` assembles the surface a host SERVES; this assembles the
 * client that CONSUMES it from a kolu that multiplexes its surfaces over one WS.
 * The two belong together: how kolu mounts `terminalWorkspaceSurface` (the
 * `terminalWorkspace` SIBLING key, the `/rpc/ws` endpoint, the non-browser
 * no-Origin/no-pid posture, the half-open `system.live` watchdog) is composition
 * knowledge authored on the SERVE side, so it lives HERE — not duplicated into
 * every consumer. A consumer (pulam-web's localhost mirror) calls
 * `connectTerminalWorkspace(url)` and is handed the SAME `AgentClient` shape the
 * remote `getHostSession` dial produces, so a local and a remote mirror are
 * uniform and neither names a sibling, reconstructs `composeSurfaceContracts`, or
 * knows kolu multiplexes.
 *
 * Lives in `@kolu/terminal-workspace` (the shared surface's home), so it adds no
 * dependency on `@kolu/surface-nix-host` and is reachable by any consumer of the
 * surface. Node-side (the mirror runs in a server): the browser-safe `./surface`
 * and `./schema` subpaths do not import this.
 */

import type { composeSurfaceContracts } from "@kolu/surface/define";
import { websocketLink } from "@kolu/surface/links/websocket";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import {
  createHeartbeat,
  createSurfaceSocket,
  type HeartbeatSocket,
} from "@kolu/surface-app/connect";
import type { terminalWorkspaceSurface } from "./surface.ts";

/** kolu's default loopback endpoint, where it multiplexes its surfaces (the
 *  `terminalWorkspace` sibling among them). The `7681` pairs by value with
 *  `kolu-common`'s `DEFAULT_PORT` — this library sits BELOW `kolu-common`, so it
 *  can't import it — and `/rpc/ws` is kolu's surface mount. Owning the default +
 *  path here is what keeps a consumer from hard-coding either. */
export const DEFAULT_KOLU_WS_URL = "ws://127.0.0.1:7681/rpc/ws";

/** The reconnecting socket a {@link TerminalWorkspaceConnection} rides — the
 *  generic WS lifecycle a consumer drives (poll `readyState`/`OPEN`, await the
 *  `open` event before a (re)mirror, `reconnect()` a half-open link, `close()` on
 *  teardown). It carries NO kolu-composition knowledge — just the transport — so
 *  a consumer's reconnect loop reads it without naming a surface. The
 *  `readyState`/`OPEN`/`reconnect` triple is the shared {@link HeartbeatSocket}. */
export interface TerminalWorkspaceSocket extends HeartbeatSocket {
  close(): void;
  addEventListener(type: "open", cb: () => void): void;
  removeEventListener(type: "open", cb: () => void): void;
}

/** A raw `terminalWorkspaceSurface` client — `client.surface.<primitive>.<verb>`,
 *  the shape `mirrorRemoteSurface` (and a CLI) consume. Derived as exactly what a
 *  `websocketLink` over the surface's contract yields (a `ContractRouterClient<…,
 *  ClientRetryPluginContext>`) — which is the SAME type
 *  `AgentClient<typeof terminalWorkspaceSurface.contract>` the remote
 *  `getHostSession` path produces, so a local mirror and a remote mirror take the
 *  same client. Deriving it off `websocketLink` keeps this lib free of a direct
 *  `@orpc/client`/`@orpc/contract` dependency. */
export type TerminalWorkspaceClient = ReturnType<
  typeof websocketLink<typeof terminalWorkspaceSurface.contract>
>;

/** A live connection to a kolu-served `terminalWorkspaceSurface`. */
export interface TerminalWorkspaceConnection {
  /** The terminalWorkspace-scoped client — feed it to `mirrorRemoteSurface`. */
  client: TerminalWorkspaceClient;
  /** The reconnecting socket the client rides (transport lifecycle only). */
  socket: TerminalWorkspaceSocket;
  /** Stop the liveness watchdog and close the socket. */
  dispose(): void;
}

/** The keyed contract kolu serves the `terminalWorkspace` sibling under
 *  (`surface.terminalWorkspace.*`) — the SAME keying kolu's `implementSurfaces`
 *  produces around `serveTerminalWorkspace`. Type-only (no runtime contract value
 *  is built); the client is the `terminalWorkspace` slice of a link over it. */
type KoluKeyedContract = ReturnType<
  typeof composeSurfaceContracts<{
    terminalWorkspace: typeof terminalWorkspaceSurface;
  }>
>;

/**
 * Connect to a kolu-served `terminalWorkspaceSurface` over its multiplexed
 * `/rpc/ws`, scope the `terminalWorkspace` sibling, and arm the half-open
 * watchdog. `url` is the kolu WS endpoint (default {@link DEFAULT_KOLU_WS_URL}).
 *
 * The socket carries no `pid` echo and a non-browser client sends no `Origin`, so
 * kolu's stale-tab and CSWSH gates both pass it (the no-pid/no-Origin posture).
 * The returned `client` is the sibling slice of the composed-contract link — the
 * SAME `surface[k]` scoping `connectSurfaces`/`surfaceClients` do for a Solid
 * client, encapsulated here once for the raw client so no consumer reconstructs
 * it. `createHeartbeat` probes the framework-reserved `system.live` so a silently
 * half-open socket (kolu wedged, TCP alive) is force-reconnected, not hung.
 */
export function connectTerminalWorkspace(
  url: string,
  opts: { onStale?: () => void } = {},
): TerminalWorkspaceConnection {
  const socket = createSurfaceSocket({ url });
  const link = websocketLink<KoluKeyedContract>(
    socket.ws as unknown as WebSocket,
  );
  // The `terminalWorkspace` sibling slice — `client.surface.<primitive>` over the
  // multiplexed link. The cast is the documented sibling-scope cast (the runtime
  // shape is a valid client of `terminalWorkspaceSurface`); it is the raw twin of
  // the `(link as any).surface[key]` walk `surfaceClients` does for Solid clients.
  const client = {
    surface: (link as { surface: Record<string, unknown> }).surface
      .terminalWorkspace,
  } as TerminalWorkspaceClient;
  const heartbeat = createHeartbeat({
    ws: socket.ws,
    probe: () => probeSurfaceLive(client),
    onStale: opts.onStale,
  });
  return {
    client,
    socket: socket.ws as unknown as TerminalWorkspaceSocket,
    dispose: () => {
      heartbeat.dispose();
      socket.ws.close();
    },
  };
}
