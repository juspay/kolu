/**
 * The warm host pool (W4 "the switch").
 *
 * kolu-server no longer marries ONE padi at boot (the pre-W4 `remoteHost ?
 * ensureRemotePadiBinding : ensurePadiBinding` composition root). It holds a
 * `buildHostRegistry` — a `Map<host, { session, handler }>` — with one warm
 * `PadiSession` per machine, and each browser connection is dispatched to its
 * host's handler by the `?host=` query param at ws-upgrade. Switching hosts on a
 * tab is one socket closing and another opening; there is no global rebind.
 *
 * Each entry is a full re-serve: the host's `PadiSession` (local endpoint arm for
 * `LOCAL_HOST`, ssh arm otherwise) → `reServeSurface` → a per-host oRPC router
 * (the SHARED kolu+surfaceApp fragment spliced with THIS host's re-served padi)
 * → a per-host `WsRPCHandler`. The registry runs with **no `controls`** — kolu
 * needs no fleet verbs (`pool.reconnect` doesn't even typecheck), unlike drishti.
 *
 * Persistence: the pool's host set (minus the always-present local host) is the
 * user's `recentHosts`, written through `persistRecentHosts` on every add/remove
 * so every device sharing this kolu sees the same picker list.
 *
 * The dependency arrow stays outward: this module imports the two binding arms +
 * the framework registry, never the client.
 */

import { PADI_FORWARDING_POLICY, padiSurface } from "@kolu/padi/surface";
import { surfaceClientRef } from "@kolu/surface/project";
import {
  buildHostRegistry,
  type HostRegistry,
  reServeSurface,
} from "@kolu/surface-nix-host";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { LOCAL_HOST } from "kolu-common/contract";
import { log } from "./log.ts";
import {
  type EnsurePadiBindingOptions,
  ensurePadiBinding,
} from "./padiBinding.ts";
import type { PadiSession } from "./padiSession.ts";
import { ensureRemotePadiBinding } from "./remotePadiBinding.ts";
import { buildAppRouter } from "./router.ts";

// `LOCAL_HOST` (the `"local"` sentinel) is defined once in kolu-common/contract —
// the host wire-contract's home — and re-exported here for the server's callers.
export { LOCAL_HOST };

/** The per-host oRPC WS handler — the registry's `H`. Context is empty at
 *  upgrade (`{ context: {} }`); typed loosely to match the `appRouter as any`
 *  splice (implementSurface's `Lazy<Router>` spread doesn't statically verify). */
type PadiWsHandler = WsRPCHandler<Record<string, unknown>>;

/** An in-process client of a host's re-serve mirror (a `directLink` over the
 *  mirror's own router, no socket/ssh hop) — the memory sampler reads padi's
 *  `{ padi, kaval }` RSS off THIS instead of opening a second transport. Pinned
 *  to the padi surface spec (the mirror is `WithConnection<padiSurface>`, a
 *  superset, so it assigns cleanly) — an unpinned `ReturnType` explodes into a
 *  union too complex to represent (TS2590). */
type MirrorClient = ReturnType<
  typeof surfaceClientRef<typeof padiSurface.spec>
>;

export interface HostPoolDeps {
  /** The host bound when a tab names none — `KOLU_PADI_HOST` if set, else the
   *  local host. Seeded into the pool and served on `server.info.defaultHost`. */
  bootHost: string | undefined;
  /** Hosts remembered from `preferences.recentHosts` — warmed at boot so a device
   *  lands on its known hosts without re-adding them. */
  recentHosts: readonly string[];
  /** Persist the pool's host set (local excluded) back onto `preferences.recentHosts`. */
  persistRecentHosts: (hosts: string[]) => void;
  /** Options forwarded to the LOCAL endpoint arm (`ensurePadiBinding`) — the
   *  nix-shell whitelist, the legacy-kaval adopt hint, spawn version, verbose. */
  localArmOpts: EnsurePadiBindingOptions;
  /** This kolu build's app version, forwarded to the REMOTE arm so a remote host's
   *  PTYs stamp the kolu app version (byte-identical to the local arm). */
  remoteSpawnVersion: string;
  /** The SHARED kolu+surfaceApp surface fragment (`koluSurfaceRouter.surface`),
   *  spliced beside each host's re-served padi. Host-independent — the same
   *  preferences / buildInfo / memory cells on every handler. */
  koluSurfaceRouter: { surface: Record<string, unknown> };
  /** The oRPC handler plugins (logging, …) — one per-host `WsRPCHandler` each. */
  // biome-ignore lint/suspicious/noExplicitAny: passed straight to WsRPCHandler options; the concrete plugin array is assembled in index.ts.
  rpcPlugins: any;
}

export interface HostPool {
  /** The framework registry — `getHandler(host)` for ws dispatch, `getSession(host)`
   *  for the preview route + the local-binding samplers, `has`/`hosts` for the pool. */
  registry: HostRegistry<PadiSession, PadiWsHandler>;
  /** The re-serve mirror client for the DEFAULT host (the samplers read it). */
  getMirror(): MirrorClient | undefined;
  /** The DEFAULT host's assembled oRPC router — the non-streaming HTTP `/rpc/*`
   *  handler is built from it (a single host; e2e reset POSTs land there). */
  getRouter(): unknown;
  /** The `hosts.add` / `hosts.remove` control plane the per-host routers serve. */
  hosts: {
    add: (host: string) => Promise<void>;
    remove: (host: string) => Promise<void>;
  };
  /** The default host served on `server.info` (`bootHost` ?? local). */
  defaultHost: string;
}

/** De-dupe preserving first-seen order (the pool is a Map, so a repeated host
 *  would otherwise throw at `buildHostRegistry`). */
function dedupe(hosts: readonly string[]): string[] {
  return [...new Set(hosts)];
}

export function buildHostPool(deps: HostPoolDeps): HostPool {
  const defaultHost = deps.bootHost ?? LOCAL_HOST;
  // Only the DEFAULT host's mirror + router are ever read (the samplers + the
  // single HTTP `/rpc/*` handler), so capture just those two — no per-host store
  // to orphan on `registry.remove`. Set inside `buildEntry` when it runs for the
  // default host (always present in `initialHosts`, so both are non-undefined by
  // the time the pool is returned; index.ts fail-fast-guards that).
  let defaultMirror: MirrorClient | undefined;
  let defaultRouter: unknown;

  // Late-bound so the per-host routers' `hosts.add`/`remove` can reach the
  // registry that owns them (the entries are built DURING `buildHostRegistry`,
  // so the registry ref doesn't exist yet when `buildEntry` first runs — but the
  // RPC handlers only fire at runtime, long after).
  let registry: HostRegistry<PadiSession, PadiWsHandler>;

  // In-flight `add`s, keyed by host — the pool is shared across a user's devices,
  // so two tabs can call `hosts.add("newbox")` at nearly the same moment. Without
  // this fence both would pass the `registry.has` check (neither has committed yet),
  // both `buildEntry` a live ssh session + re-serve pump, and the loser's entry would
  // be silently dropped WITHOUT `.destroy()` — an orphaned pump whose `process.exit(1)`
  // fail-loud arm can then take the whole server down from a resource nothing owns. A
  // second concurrent add JOINS the first's promise instead of racing it.
  const adding = new Map<string, Promise<void>>();

  const hosts = {
    add: async (host: string): Promise<void> => {
      if (host === LOCAL_HOST) return; // the local host is always present.
      if (registry.has(host)) return; // idempotent — already warm.
      const inflight = adding.get(host);
      if (inflight) return inflight; // a concurrent add for THIS host — join it.
      const p = registry.add(host).finally(() => adding.delete(host));
      adding.set(host, p);
      return p;
    },
    remove: async (host: string): Promise<void> => {
      if (host === LOCAL_HOST) return; // never remove the local host.
      // A3 — never remove the DEFAULT host either. `KOLU_PADI_HOST` may be remote,
      // and its session/mirror/router are boot-captured by the HTTP `/rpc` handler +
      // the memory/identity/inventory samplers (index.ts) — destroying it under those
      // captures bricks the server permanently (no re-add heals a captured ref). The
      // local guard above already covers the local-default case; this covers a remote
      // default. Reachable both via the picker's forget list and the raw RPC.
      if (host === defaultHost) return;
      if (!registry.has(host)) return;
      // Lifecycle log (retired) — the per-host padi binding is a long-lived,
      // add/remove-able resource; log its teardown in a greppable format.
      log.info({ host }, `hostPool: ${host} binding retired`);
      await registry.remove(host);
    },
  };

  registry = buildHostRegistry<PadiSession, PadiWsHandler>({
    // Local host always; the boot default (KOLU_PADI_HOST) and every remembered
    // recent host, warmed on boot. De-duped so the boot default that also sits in
    // recentHosts doesn't double-add.
    initialHosts: dedupe([
      LOCAL_HOST,
      ...(deps.bootHost ? [deps.bootHost] : []),
      ...deps.recentHosts,
    ]),
    buildEntry: (host) => {
      // Lifecycle log (installed) — the per-host padi binding is a long-lived,
      // add/remove-able resource; log its creation in a greppable format so an
      // operational sweep can pair it with the "retired" log above.
      log.info({ host }, `hostPool: ${host} binding installed`);
      const session: PadiSession =
        host === LOCAL_HOST
          ? ensurePadiBinding(deps.localArmOpts)
          : ensureRemotePadiBinding({
              host,
              spawnVersion: deps.remoteSpawnVersion,
            });

      const reServed = reServeSurface<typeof padiSurface.spec>({
        source: padiSurface,
        policy: PADI_FORWARDING_POLICY,
        session,
        log: (line) => log.debug({ host, line }, "padi re-serve"),
      });

      // The pump must never float — it settles on a clean destroy or REJECTS on a
      // terminal mirror fault, freezing this binding at a stale-but-healthy value.
      // Fail LOUD (fail-fast); the supervisor restarts kolu-server clean.
      reServed.done
        .then(() =>
          log.info({ host }, "padi re-serve pump exited (session destroyed)"),
        )
        .catch((err) => {
          log.fatal(
            { err, host },
            "padi re-serve pump died — binding is unrecoverable",
          );
          process.exit(1);
        });

      // The in-process mirror client the memory sampler reads. Only the DEFAULT
      // host's is ever consulted, so build it for that host alone — a mirror client
      // for any other host is pure waste (nothing reads it). The client is built over
      // the mirror's `WithConnection<padiSurface>` surface — a superset of
      // `MirrorClient` (which pins the padi spec); the `as unknown as` sidesteps the
      // deep structural comparison of that superset client, which TS can't represent
      // (TS2590).
      if (host === defaultHost) {
        defaultMirror = surfaceClientRef(
          reServed.surface,
          reServed.router as Parameters<typeof surfaceClientRef>[1],
        ) as unknown as MirrorClient;
      }

      // The per-host router: the SHARED kolu+surfaceApp fragment spliced with THIS
      // host's re-served padi, plus the raw RPCs. `daemon.restart` drains THIS
      // host's padi; `hosts.*` operate on the shared pool; `server.info` carries
      // the server-wide default host.
      const appRouter = buildAppRouter({
        surfaceRouter: {
          surface: {
            ...deps.koluSurfaceRouter.surface,
            padi: (reServed.router as { surface: Record<string, unknown> })
              .surface,
          },
        },
        drainBoundPadi: () => session.renew(),
        defaultHost,
        host,
        hosts,
      });
      // Every host needs its OWN `appRouter` for the WS handler below, but the
      // non-streaming HTTP `/rpc/*` handler is built from the DEFAULT host's router
      // only (a single host; e2e reset POSTs land there), so capture just that one.
      if (host === defaultHost) defaultRouter = appRouter;

      // biome-ignore lint/suspicious/noExplicitAny: buildAppRouter mixes implementSurface's Lazy<Router> spread with hand-listed namespaces; RPCHandler's input type doesn't accept that union though the runtime shape is a valid router.
      const handler: PadiWsHandler = new WsRPCHandler(appRouter as any, {
        plugins: deps.rpcPlugins,
      });

      return { session, handler };
    },
    persist: async (poolHosts) => {
      // The pool's host set (local excluded) IS the user's recentHosts.
      deps.persistRecentHosts(poolHosts.filter((h) => h !== LOCAL_HOST));
    },
  });

  return {
    registry,
    getMirror: () => defaultMirror,
    getRouter: () => defaultRouter,
    hosts,
    defaultHost,
  };
}
