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
import { type AgentClient, mirrorOnce } from "@kolu/surface-nix-host";
import {
  type ConnectionInfo,
  DEFAULT_CONNECTION,
} from "@kolu/surface-nix-host/connection";
import {
  connectTerminalWorkspace,
  type TerminalWorkspaceSocket,
} from "@kolu/terminal-workspace/connect";
import { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import type { PulamContract, PulamHandler } from "./hostEntry.ts";
import type { HostHandle } from "./hostPlane.ts";
import { buildReServe, type ReServe } from "./reserve.ts";

export type { PulamContract };

/**
 * A live link to the local kolu's `terminalWorkspaceSurface` — the source the
 * mirror folds into the re-serve. Abstracted so the production path (a reconnecting
 * WebSocket to kolu, via `connectTerminalWorkspace`) and the hermetic test path (an
 * in-process `directLink` to a stand-in kolu) plug into the SAME pump.
 */
export interface KoluLink {
  /** The surface client `mirrorRemoteSurface` reads structurally as
   *  `client.surface.<primitive>.<verb>` (awareness/version/activity/fs/git). For
   *  the WS path this is `connectTerminalWorkspace`'s `terminalWorkspace`-scoped
   *  client; in-process it's a plain `directLink` client. */
  client: AgentClient<PulamContract>;
  /** Resolve once the link is ready to mirror (the socket is OPEN). Immediate for
   *  an in-process link. Rejects if `signal` aborts while waiting. */
  ready(signal: AbortSignal): Promise<void>;
  /** Is the transport currently OPEN? After a mirror pass ENDS, the loop reads this
   *  to tell a genuine link close (the socket dropped — let it reconnect on its own,
   *  paced by partysocket) from a mirror that DRAINED while the socket stayed open
   *  (a wrong/old kolu that rejects every primitive, so every subscription settles
   *  with no `version` handshake). The latter must NOT be re-mirrored on the same
   *  dead-but-open socket — `ready()` would resolve at once and hot-spin the loop. */
  isOpen(): boolean;
  /** Force a fresh connect — the `/api/reconnect` button's re-arm, and the loop's
   *  break for a mirror that drained on a still-open socket (partysocket's backoff
   *  then paces the retry). A no-op for an always-live in-process link. */
  reconnect(): void;
  /** Tear the transport down (server shutdown). */
  dispose(): void;
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
    } catch (err) {
      if (signal.aborted) return; // aborted while waiting for the link — clean stop
      // `link.ready()` is contracted to reject ONLY on abort (the production
      // `waitForOpen` does). A rejection while NOT aborted is an unexpected fault —
      // SURFACE it (not just a stderr line a dashboard user never sees): flip the
      // browser-facing card to `disconnected` so the fault is visible, then end the
      // loop. Silently logging + returning would freeze the localhost card on its
      // last state with no on-screen trace (the no-silent-swallow convention).
      const reason = err instanceof Error ? err.message : String(err);
      log(
        `local kolu mirror: link.ready() rejected without an abort: ${reason}`,
      );
      reServe.setConnection(
        disconnected(`kolu link could not be reached: ${reason}`),
      );
      return;
    }
    if (signal.aborted) return;
    seq += 1;
    reServe.setConnection(CONNECTING);
    log(`local kolu mirror #${seq}: link ready — mirroring awareness`);
    // The first `version` frame is the link-live handshake; it flips the card to
    // `connected`. We also remember whether it ever arrived this pass, so a mirror
    // that drained WITHOUT one can be reported as an incompatible-kolu skew rather
    // than a normal link drop.
    let sawVersion = false;
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
        sawVersion = true;
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
    if (signal.aborted) return;
    // `mirrorOnce` returns when every subscription has settled. Normally that means
    // the socket CLOSED: `link.ready()` at the top then blocks until partysocket
    // reopens, so the loop is paced by the reconnect. But the mirror ALSO drains
    // while the socket stays OPEN — a link to a wrong/old kolu that rejects (or
    // never serves) the `terminalWorkspace` sibling, so every per-primitive `get`
    // errors out, each subscription settles, and `done` resolves with no `version`
    // handshake ever seen. Re-entering the mirror on that same dead-but-open socket
    // would hot-spin (its `link.ready()` resolves immediately). So force a fresh
    // connect: partysocket's backoff then paces the retry (and grows it on repeat),
    // turning a tight loop into the same "reconnecting" cadence a down host shows.
    if (link.isOpen()) {
      log(
        `local kolu mirror #${seq}: mirror drained on a still-OPEN link${
          sawVersion
            ? ""
            : " (no version handshake — wrong or incompatible kolu?)"
        } — forcing reconnect`,
      );
      link.reconnect();
    } else {
      log(`local kolu mirror #${seq}: link closed — awaiting reconnect`);
    }
  }
}

/**
 * Build the production kolu link: a reconnecting WebSocket to the running kolu's
 * `/rpc/ws`, scoped to the `terminalWorkspace` sibling.
 *
 * How kolu serves `terminalWorkspaceSurface` — the `terminalWorkspace` sibling on
 * its multiplexed `/rpc/ws`, the non-browser no-Origin/no-pid posture, the
 * `system.live` half-open watchdog — is composition knowledge owned by the SERVE
 * side, so it lives in `@kolu/terminal-workspace`'s `connectTerminalWorkspace` (the
 * client twin of `serveTerminalWorkspace`). This wrapper only adapts that
 * connection's transport into the `KoluLink` lifecycle the pump drives; it names no
 * sibling, no `/rpc/ws`, and never reconstructs `composeSurfaceContracts`. The
 * returned `client` is the SAME `AgentClient` the remote `getHostSession` dial
 * yields, so the local mirror is uniform with the remote one.
 */
function connectKoluOverWs(
  koluUrl: string,
  log: (line: string) => void,
): KoluLink {
  const conn = connectTerminalWorkspace(koluUrl, {
    onStale: () => log("local kolu link half-open — forcing reconnect"),
  });
  return {
    // `TerminalWorkspaceClient` IS `AgentClient<terminalWorkspaceSurface.contract>`
    // (= `AgentClient<PulamContract>`), so the local and remote mirror take the
    // same client type — no re-cast here.
    client: conn.client,
    ready: (signal) => waitForOpen(conn.socket, signal),
    isOpen: () => conn.socket.readyState === conn.socket.OPEN,
    reconnect: () => conn.socket.reconnect(),
    dispose: () => conn.dispose(),
  };
}

/** Resolve once the socket is OPEN — immediately if it already is, else on the
 *  next `open` event (rejecting if `signal` aborts first). The partysocket
 *  auto-reconnects on its own; this just gates each (re)mirror so a `get()` never
 *  fires at a closed socket and busy-loops the pump. */
function waitForOpen(
  ws: TerminalWorkspaceSocket,
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
 * `HostHandle` `main.ts` registers as the `localhost` host — the SAME uniform face
 * the ssh registry adapts into, so `main` registers it with no field-copy re-wrap.
 * A static local mirror is never removed, so it omits `tracking` (nothing to close
 * on a removal that can't happen).
 *
 * `connect` is injectable so the differential test drives the WHOLE path with an
 * in-process `directLink` stand-in for kolu (no socket, no Nix) — the production
 * default opens the real WebSocket.
 */
export function startLocalKoluMirror(opts: {
  /** The local kolu's WS URL — read + validated by `config.ts`'s `readKoluUrl`
   *  (default `@kolu/terminal-workspace`'s `DEFAULT_KOLU_WS_URL`). Passed opaque to
   *  `connectTerminalWorkspace`, which owns the endpoint path. */
  koluUrl: string;
  log?: (line: string) => void;
  /** Transport factory — defaults to the real reconnecting WebSocket link. */
  connect?: (koluUrl: string, log: (line: string) => void) => KoluLink;
}): HostHandle {
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
