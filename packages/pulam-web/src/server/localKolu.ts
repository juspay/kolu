/**
 * `localKolu` — the localhost dedup (R9a): mirror the LOCAL kolu's already-served
 * awareness instead of spawning a second `pulam`.
 *
 * Under `PULAM_WEB_HOSTS=localhost`, the ssh dial path (`hostEntry.makeBuildEntry`
 * → `getHostSession({ binary: "pulam" })`) would run `pulam --stdio` against this
 * box's kaval and start its OWN sensor set — a SECOND set of observers watching
 * the same terminals kolu's in-process sensors already watch. The two caches never
 * reconcile, so a terminal reads `working` in pulam-web while the Dock (reading
 * kolu's own awareness) reads `idle` — the desync R9a fixes.
 *
 * The fix: don't sense twice. kolu serves the generic `terminalWorkspaceSurface`
 * cross-process as of R8 (the same surface `pulam` serves remotely), multiplexed
 * as the `terminalWorkspace` sibling on kolu's `/rpc/ws`. So for localhost we MIRROR
 * that served surface into the SAME `buildReServe` shell the ssh path uses — only
 * the SOURCE changes (a WebSocket to the running kolu, not an ssh-spawned pulam).
 * **One sensor (kolu's in-process sink), two readers (kolu's Dock + this dashboard).**
 *
 * The browser leg is byte-identical to a remote host's: it still connects to
 * pulam-web's `/rpc/ws?host=localhost` and reads the re-served `pulamSurface`. Only
 * the parent-side source differs — this module is the local-link dual of
 * `pumpRemoteSurface` (which is `HostSession`-coupled and always spawns a
 * subprocess, so it can't point at an already-running local server).
 */

import { RPCHandler } from "@orpc/server/ws";
import type { composeSurfaceContracts } from "@kolu/surface/define";
import { websocketLink } from "@kolu/surface/links/websocket";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import {
  createHeartbeat,
  createSurfaceSocket,
} from "@kolu/surface-app/connect";
import { type AgentClient, mirrorOnce } from "@kolu/surface-nix-host";
import {
  type ConnectionInfo,
  DEFAULT_CONNECTION,
} from "@kolu/surface-nix-host/connection";
import { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import type { PulamContract, PulamHandler } from "./hostEntry.ts";
import { buildReServe, type ReServe } from "./reserve.ts";

export type { PulamContract };

/** The keyed contract kolu serves the `terminalWorkspace` sibling under
 *  (`surface.terminalWorkspace.*`) — the same keying kolu's `implementSurfaces`
 *  produces, and the type `websocketLink`'s client is generic over. Derived off
 *  `composeSurfaceContracts` so it can't drift from how kolu composes the sibling;
 *  only the TYPE is needed, so no runtime contract value is allocated. */
type KoluKeyedContract = ReturnType<
  typeof composeSurfaceContracts<{
    terminalWorkspace: typeof terminalWorkspaceSurface;
  }>
>;

/** The minimal partysocket face this module touches — the same two verbs
 *  `createHeartbeat`'s `HeartbeatSocket` reads, plus the `open` event the pump
 *  awaits before each (re)mirror and `close()` for teardown. Kept structural so a
 *  test's fake link needs no real socket. */
interface ReconnectingSocket {
  readyState: number;
  readonly OPEN: number;
  reconnect(): void;
  close(): void;
  addEventListener(type: "open", cb: () => void): void;
  removeEventListener(type: "open", cb: () => void): void;
}

/**
 * A live link to the local kolu's `terminalWorkspaceSurface` — the source the
 * mirror folds into the re-serve. Abstracted so the production path (a reconnecting
 * WebSocket to kolu's `/rpc/ws`) and the hermetic test path (an in-process
 * `directLink` to a stand-in kolu) plug into the SAME pump.
 */
export interface KoluLink {
  /** The surface client `mirrorRemoteSurface` reads structurally as
   *  `client.surface.<primitive>.<verb>` (awareness/version/activity/fs/git). For
   *  the WS path this is the `terminalWorkspace` sibling slice of the multiplexed
   *  link; in-process it's a plain `directLink` client. */
  client: AgentClient<PulamContract>;
  /** Resolve once the link is ready to mirror (the socket is OPEN). Immediate for
   *  an in-process link. Rejects if `signal` aborts while waiting. */
  ready(signal: AbortSignal): Promise<void>;
  /** Force a fresh connect — the `/api/reconnect` button's re-arm. A no-op for an
   *  always-live in-process link. */
  reconnect(): void;
  /** Tear the transport down (server shutdown). */
  dispose(): void;
}

/** What `startLocalKoluMirror` returns — the slice `main.ts` registers alongside
 *  the ssh `HostRegistry` (the handler the `?host=` dispatcher upgrades onto, plus
 *  the reconnect/destroy lifecycle the route and shutdown drive). */
export interface LocalKoluMirror {
  handler: PulamHandler;
  /** The `/api/reconnect?host=localhost` re-arm — re-opens the kolu link. */
  reconnect(): void;
  /** Server shutdown — stop the mirror loop and close the link. */
  destroy(): void;
}

// ── Connection-health frames ──────────────────────────────────────────────
// The browser-facing `connection` cell carries the localhost card's health, the
// same way `pipeSessionStateToCell` carries an ssh host's. A local link has no
// `copying` (nix copy) or `connecting`-over-ssh phase and never gives up into the
// terminal `failed` (it retries forever via partysocket, like a `"network"` ssh
// fault), so only three states are reachable.
//
// `connecting` is byte-identical to the gate-closed seed every mirrored surface
// starts at, so reuse the canonical `DEFAULT_CONNECTION` rather than re-spreading
// its fields here (one home for the gate-closed seed).
const CONNECTING: ConnectionInfo = DEFAULT_CONNECTION;
const CONNECTED: ConnectionInfo = {
  state: "connected",
  lastError: null,
  failureCause: null,
  progressLines: [],
};
function disconnected(reason: string): ConnectionInfo {
  // `"network"` (not `"remote"`): the kolu link is never a bounded → terminal
  // fault — it retries until kolu is back, so the card shows "reconnecting", not
  // a dead-end "failed".
  return {
    state: "disconnected",
    lastError: reason,
    failureCause: "network",
    progressLines: [],
  };
}

/**
 * The local mirror pump — the local-link dual of `pumpRemoteSurface`. Loop: wait
 * for the link, then run ONE link-up's mirror lifecycle through the shared
 * `mirrorOnce` body (mirror the whole `terminalWorkspaceSurface` into the
 * re-serve's sink, publish the live client/procedures for the re-serve's forwards,
 * block until the link dies, then clear the holders and run `onLinkDown`). This
 * loop owns the two edges that genuinely differ from the ssh pump: the client
 * source (this one reconnecting link, not a `HostSession` cursor) and the
 * connection-state model (inline CONNECTING/CONNECTED/disconnected, not
 * `pipeSessionStateToCell`). `onLinkDown` drops the remote-derived fold so the
 * next mirror rebuilds from kolu's fresh snapshot (never paints a stale row across
 * a kolu restart — #1549's invariant, here for the local link). Exits only when
 * `signal` aborts (server shutdown).
 *
 * Fire-and-forget (`void`), matching `hostEntry`'s `pumpRemoteSurface` call: a
 * broken local fold rejects `mirror.done` (a `SinkError`) and must surface
 * loudly, never be swallowed — the project's no-fallback rule.
 *
 * Exported (the local dual of the exported `pumpRemoteSurface`) so the differential
 * test drives it with an in-process stand-in for kolu and reads the re-serve.
 */
export async function runLocalMirror(opts: {
  reServe: ReServe;
  link: KoluLink;
  signal: AbortSignal;
  log: (line: string) => void;
}): Promise<void> {
  const { reServe, link, signal, log } = opts;
  let seq = 0;
  while (!signal.aborted) {
    try {
      await link.ready(signal);
    } catch {
      return; // aborted while waiting for the link
    }
    if (signal.aborted) return;
    seq += 1;
    reServe.setConnection(CONNECTING);
    log(`local kolu mirror #${seq}: link ready — mirroring awareness`);
    // One link-up's mirror lifecycle, through the SAME shared body the ssh pump
    // uses (`mirrorOnce`): publish the live holders, await the mirror, then clear
    // them and run `onLinkDown`. Only the OUTER loop differs from the pump — the
    // client source is this one reconnecting link (not a `HostSession` cursor) and
    // the connection state is set inline (not via `pipeSessionStateToCell`).
    await mirrorOnce({
      source: terminalWorkspaceSurface,
      client: link.client,
      // The first `version` frame is the link-live handshake — flip the card to
      // `connected` there (the local analogue of `session.markConnected()`).
      sink: reServe.makeSink(() => {
        reServe.setConnection(CONNECTED);
        log(`local kolu mirror #${seq}: first version frame — connected`);
      }),
      // The re-serve's input-param streams (`subscribe*Change`) and `fs.*`/`git.*`
      // procedures reach kolu through these holders; `mirrorOnce` clears them the
      // instant the link dies so a forward in the gap fails honestly.
      liveProcedures: reServe.liveProcedures,
      liveClient: reServe.liveClient,
      // On link death: drop the awareness cache + activity live-set so the next
      // mirror rebuilds from kolu's authoritative snapshot rather than pinning a
      // stale row across the reconnect (the pump's `onLinkDown` contract, #1549),
      // then flip the card to disconnected (unless we're shutting down).
      onLinkDown: () => {
        reServe.resetRemoteFold();
        if (!signal.aborted) {
          reServe.setConnection(
            disconnected("kolu link closed — reconnecting"),
          );
        }
      },
      signal,
      log,
    });
    log(`local kolu mirror #${seq}: link closed — awaiting reconnect`);
  }
}

/**
 * Build the production kolu link: a reconnecting WebSocket to the running kolu's
 * `/rpc/ws`, scoped to the `terminalWorkspace` sibling.
 *
 * kolu multiplexes three sibling surfaces over `/rpc/ws` (`kolu`, `surfaceApp`,
 * `terminalWorkspace`), so the client must address `surface.terminalWorkspace.*`.
 * `composeSurfaceContracts({ terminalWorkspace })` mints exactly that keying (the
 * same keying kolu's `implementSurfaces` serves), and the per-sibling slice
 * `{ surface: link.surface.terminalWorkspace }` is the `client.surface.<primitive>`
 * shape `mirrorRemoteSurface` reads — the server-side twin of how
 * `connectSurfaces` scopes each browser sibling client.
 *
 * pulam-web is a non-browser client: it sends no `Origin` (kolu's CSWSH gate
 * passes it) and no `pid` (kolu's stale-tab gate passes a first/echo-less connect),
 * so no `ProcessIdEcho` is wired — `createSurfaceSocket` just gives the reconnecting
 * partysocket. `createHeartbeat` turns a SILENTLY half-open socket (kolu wedged, TCP
 * alive) into a real reconnect via the reserved `system.live` probe, so the mirror
 * can't hang forever on a dead-but-open link.
 */
function connectKoluOverWs(
  koluUrl: string,
  log: (line: string) => void,
): KoluLink {
  const socket = createSurfaceSocket({ url: koluUrl });
  const link = websocketLink<KoluKeyedContract>(
    socket.ws as unknown as WebSocket,
  );
  // The `terminalWorkspace` sibling slice — `client.surface.<primitive>` over the
  // multiplexed link. The cast is the documented sibling-scope cast (`connectSurfaces`
  // does the same `(link as any).surface[key]` internally); the runtime shape is a
  // valid surface client of `terminalWorkspaceSurface`.
  const client = {
    surface: (link as { surface: Record<string, unknown> }).surface
      .terminalWorkspace,
  } as unknown as AgentClient<PulamContract>;
  const heartbeat = createHeartbeat({
    ws: socket.ws,
    probe: () => probeSurfaceLive(client),
    onStale: () => log("local kolu link half-open — forcing reconnect"),
  });
  return {
    client,
    ready: (signal) => waitForOpen(socket.ws, signal),
    reconnect: () => socket.ws.reconnect(),
    dispose: () => {
      heartbeat.dispose();
      socket.ws.close();
    },
  };
}

/** Resolve once the socket is OPEN — immediately if it already is, else on the
 *  next `open` event (rejecting if `signal` aborts first). The partysocket
 *  auto-reconnects on its own; this just gates each (re)mirror so a `get()` never
 *  fires at a closed socket and busy-loops the pump. */
function waitForOpen(
  ws: ReconnectingSocket,
  signal: AbortSignal,
): Promise<void> {
  if (ws.readyState === ws.OPEN) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onAbort = (): void => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = (): void => {
      ws.removeEventListener("open", onOpen);
      signal.removeEventListener("abort", onAbort);
    };
    ws.addEventListener("open", onOpen);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Start mirroring the local kolu's awareness into a fresh re-serve, and return the
 * `{ handler, reconnect, destroy }` `main.ts` registers as the `localhost` host.
 *
 * `connect` is injectable so the differential test drives the WHOLE path with an
 * in-process `directLink` stand-in for kolu (no socket, no Nix) — the production
 * default opens the real WebSocket.
 */
export function startLocalKoluMirror(opts: {
  /** kolu's `/rpc/ws` URL (e.g. `ws://127.0.0.1:7681/rpc/ws`). */
  koluUrl: string;
  log?: (line: string) => void;
  /** Transport factory — defaults to the real reconnecting WebSocket link. */
  connect?: (koluUrl: string, log: (line: string) => void) => KoluLink;
}): LocalKoluMirror {
  const log = opts.log ?? (() => {});
  const reServe = buildReServe({ log });
  // The browser-facing oRPC handler over the flattened re-serve router — the same
  // construction `hostEntry` uses for an ssh host. The documented fragment→router
  // cast lands here (RPCHandler's input type doesn't accept the Lazy<Router> spread;
  // the runtime shape is a valid router).
  // biome-ignore lint/suspicious/noExplicitAny: documented fragment→router cast — runtime shape is a valid router.
  const handler = new RPCHandler(reServe.router as any) as PulamHandler;
  const abort = new AbortController();
  const link = (opts.connect ?? connectKoluOverWs)(opts.koluUrl, log);
  void runLocalMirror({ reServe, link, signal: abort.signal, log });
  return {
    handler,
    reconnect: () => link.reconnect(),
    destroy: () => {
      abort.abort();
      link.dispose();
    },
  };
}
