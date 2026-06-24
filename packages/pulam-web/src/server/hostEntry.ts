/**
 * `buildEntry` — turn one host string into the `{ session, handler }` the host
 * registry stores and the `?host=` upgrade dispatcher reads.
 *
 * Three steps, in order:
 *
 *   1. `getHostSession<ArivuContract>({ host, binary: "pulam", … })` — the
 *      pooled, ref-counted ssh subprocess that provisions + dials the pulam
 *      daemon over `pulam --stdio` and owns the HARD volatility (reconnect,
 *      backoff, watchdog). `resolveDrvPath` is the boot-resolved thunk from
 *      `config.ts` (arch probe + drv lookup, deferred per spawn).
 *
 *   2. `buildReServe(...)` — the local `terminalWorkspaceSurface` re-serve: the
 *      router the browser talks to, the `makeSink` that folds remote frames
 *      inward, and the live holders for forwarding.
 *
 *   3. `pumpRemoteSurface(...)` — the background reconnect-mirror loop (void,
 *      fire-and-forget): pins the session, loops over each (re)spawned client,
 *      runs ONE `mirrorRemoteSurface` per client folding into a fresh sink, and
 *      threads the live holders so a dropped link clears the forwarders. The
 *      sink's first `version` frame fires `session.markConnected()` — the
 *      handshake that disarms the connect watchdog.
 *
 * Then `new RPCHandler(router)` wraps the re-serve router for the browser
 * socket. `buildEntry` is SYNC (matching `buildHostRegistry`'s contract): the
 * per-host probe lives inside the session's own spawn cycle, so an unreachable
 * host surfaces as a per-host `failed` connection state, never a throw that
 * takes the whole registry — and the parent's HTTP port — down.
 */

import { RPCHandler } from "@orpc/server/ws";
import {
  getHostSession,
  type HostSession,
  pipeSessionStateToCell,
  pumpRemoteSurface,
} from "@kolu/surface-nix-host";
import { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import { type ArivuContract, buildReServe } from "./reserve.ts";

export type { ArivuContract };

/** The oRPC ws handler over the re-serve router. `RPCHandler<T extends Context>`
 *  where `Context = Record<PropertyKey, any>` (oRPC's default); the router cast
 *  to `any` infers exactly this `T`, so the registry stores the broad shape and
 *  the `?host=` dispatcher calls `.upgrade(ws)` without a per-call context. */
// biome-ignore lint/suspicious/noExplicitAny: oRPC's RPCHandler Context default is Record<PropertyKey, any>; the `as any` router infers this T.
export type ArivuHandler = RPCHandler<Record<PropertyKey, any>>;

/** One host's registry entry: the session (lifecycle) and the oRPC handler the
 *  upgrade dispatcher hands the browser socket to. */
export interface HostEntry {
  session: HostSession<ArivuContract>;
  handler: ArivuHandler;
}

export interface BuildEntryDeps {
  /** Per-host `.drv` resolver — `config.ts`'s boot-resolved thunk (arch probe +
   *  drv lookup). Shared across hosts; called by the session each spawn. */
  resolveDrvPath: (host: string) => Promise<string>;
  /** How long to wait for the first RPC after the ssh child spawns before
   *  treating `connecting` as wedged. Cold `nix copy` can take 30s+, so a
   *  generous default avoids flapping the first connect. Default 60s. */
  connectTimeoutMs?: number;
  /** Per-host kaval socket overrides (`config.ts`'s `PULAM_WEB_KAVAL_SOCKETS`).
   *  When a host names a socket, the dial pins it via `pulam --stdio --kaval
   *  <socket>` — needed where SEVERAL kaval daemons run on the host and pulam's
   *  default discovery is ambiguous. Absent for a host → pulam discovers the one
   *  running kaval. */
  kavalSockets?: ReadonlyMap<string, string>;
  /** Diagnostic sink. Default no-op. A per-host tag is the caller's to add. */
  log?: (line: string) => void;
}

/**
 * Build one host's `{ session, handler }`. Curried over the shared deps so the
 * registry's `buildEntry: (host) => HostEntry` closes over them once.
 */
export function makeBuildEntry(
  deps: BuildEntryDeps,
): (host: string) => HostEntry {
  const log = deps.log ?? (() => {});
  return (host: string): HostEntry => {
    // How this host tags its diagnostic lines — derived once, read by the three
    // log sinks below (session, re-serve, pump), so the `[host] ` format lives
    // in one place.
    const hostLog = (line: string): void => log(`[${host}] ${line}`);

    // 1. The pooled ssh session dialing `pulam --stdio` on this host. Pin the
    //    remote kaval ONLY when this host named a socket (a multi-kaval box);
    //    otherwise leave `extraArgs` undefined and let pulam discover its single
    //    running kaval — the one site that knows the args ARE `--kaval <socket>`,
    //    mirroring pulam-tui's `hostConnect.ts`.
    const kavalSocket = deps.kavalSockets?.get(host);
    const session = getHostSession<ArivuContract>({
      host,
      binary: "pulam",
      // `HostSessionOptions.resolveDrvPath` is a ZERO-arg thunk (the host is
      // fixed per session); the shared resolver is per-host, so close `host`
      // over it here.
      resolveDrvPath: () => deps.resolveDrvPath(host),
      extraArgs: kavalSocket ? ["--kaval", kavalSocket] : undefined,
      connectTimeoutMs: deps.connectTimeoutMs ?? 60_000,
      onLog: hostLog,
    });

    // 2. The local re-serve of this host's awareness surface.
    const reServe = buildReServe({ log: hostLog });

    // Carry the session's link health (copying → connecting → connected →
    // disconnected → failed, + failureCause/log) onto the browser-facing
    // `connection` cell. This is the fix for the "green dot + no terminals"
    // lie: the browser gates on THIS, not on its own ws transport status, so a
    // dead mirror reads honestly. Lives for the session's lifetime (never torn
    // down — the page/process outlives it).
    pipeSessionStateToCell(session, (info) => reServe.setConnection(info));

    // 3. The background reconnect-mirror loop. Void (fire-and-forget): it runs
    //    for the session's life, re-mirroring on each respawn. The sink's first
    //    `version` frame flips the session to `connected` (idempotent after).
    void pumpRemoteSurface({
      source: terminalWorkspaceSurface,
      session,
      makeSink: () => reServe.makeSink(() => session.markConnected()),
      liveProcedures: reServe.liveProcedures,
      liveClient: reServe.liveClient,
      // On each link death, drop the whole remote-derived fold (awareness +
      // activity) so the next spawn rebuilds from the remote's fresh snapshot —
      // never paint a finished agent's stale `working` (or a departed terminal's
      // ghost), nor a dead link's last live dot, across the reconnect (#1549).
      onLinkDown: () => reServe.resetRemoteFold(),
      log: hostLog,
    });

    // The browser-facing oRPC handler over the flattened re-serve router.
    // biome-ignore lint/suspicious/noExplicitAny: matches the repo's documented cast — the implementSurface fragment's router shape isn't accepted by RPCHandler's input type; the runtime is a valid router.
    const handler = new RPCHandler(reServe.router as any);

    return { session, handler };
  };
}
