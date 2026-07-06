/**
 * The host binding — W4 "the switch" — now kolu's PADI POLICY over the framework's
 * active-connection manager (`@kolu/surface-app`, the client-side twin of
 * `buildHostRegistry`). The manager owns the machinery — a keyed cache of live
 * connections with ONE active, retire-on-switch, pick-epoch last-intent-wins over slow
 * async warms, and the server-rejected-key (1008) fallback. This module supplies only the
 * padi-specific policy: how to build a host binding (`connectSurfaces` + lifecycle), how
 * to warm a host (`hosts.add`), the toasts, and `LOCAL` as the fallback. This is the L11
 * end-state — the module-global binding machinery graduated into the framework, kolu a
 * pure-policy consumer.
 *
 * The MISROUTE GUARD is intact and NOT deferred: its teeth are the manager retiring the
 * outgoing connection — tearing down its lifecycle root AND closing its socket
 * (`retireSocket`, which stubs `send` to throw a typed retired-transport error) — plus a
 * SEPARATE socket per host, so a call can never cross to another host's server handler by
 * construction; and `Binding.retired` rejecting a call routed through a retired binding.
 * A fresh `padi()`/`app()` accessor never sees a retired binding — `activeBinding()`
 * rebuilds one the moment the cached entry is retired. (`bindings.test.ts` pins the
 * padi-policy wiring; the machinery lives in `activeConnectionManager.test.ts`.)
 */

import { STALE_PROCESS_CLOSE_CODE } from "@kolu/surface-app";
import {
  type ConnectionStatus,
  connectSurfaces,
  createActiveConnectionManager,
  createServerLifecycle,
  type ManagedConnection,
  retireSocket,
  type ServerLifecycleEvent,
  surfaceAppProbe,
} from "@kolu/surface-app/solid";
import { type contract, LOCAL_HOST } from "kolu-common/contract";
import { surfacesWithPadi } from "kolu-common/surfacesWithPadi";
import { type Accessor, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";

// `LOCAL_HOST` (the `"local"` sentinel) is defined once in kolu-common/contract
// and re-exported here for this module's consumers.
export { LOCAL_HOST };

const { protocol, host } = window.location;
const wsBase = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

/** The wire for one host: the `connectSurfaces` bundle over a `?host=<host>` socket, its
 *  own lifecycle (status), and the misroute-guard state. A `ManagedConnection`, so the
 *  active-connection manager retires it (close + typed throwing stub) on a switch. */
export interface Binding extends ManagedConnection {
  readonly host: string;
  readonly clients: ReturnType<
    typeof connectSurfaces<typeof contract, typeof surfacesWithPadi>
  >["clients"];
  readonly link: ReturnType<
    typeof connectSurfaces<typeof contract, typeof surfacesWithPadi>
  >["link"];
  readonly ws: WebSocket;
  /** The surface-app connection status for THIS host's socket. */
  readonly status: Accessor<ConnectionStatus>;
  readonly lifecycle: Accessor<ServerLifecycleEvent>;
  readonly serverProcessId: Accessor<string | undefined>;
}

/** POLICY: build a live binding for a host — the `connectSurfaces` bundle over its own
 *  `?host=<host>` socket + its own lifecycle. The server-rejected-close (1008) fallback
 *  is NOT installed here: the manager owns that predicate (via `socketOf`), so this stays
 *  a pure connection factory. */
function makeBinding(targetHost: string): Binding {
  // The `?host=` param the server dispatches on. The local host is passed
  // explicitly too, so a single-host tab's URL is `?host=local` — the server
  // treats a missing `?host` as its default, so this stays correct either way.
  const url = `${wsBase}?host=${encodeURIComponent(targetHost)}`;
  const conn = connectSurfaces<typeof contract, typeof surfacesWithPadi>({
    surfaces: surfacesWithPadi,
    url,
  });

  // Each host's socket owns its OWN lifecycle (status + stale-restart handling), the
  // per-binding twin of the pre-W4 module-level `rpc.ts` lifecycle. The half-open watchdog
  // lives in `connectSurfaces`' `createLiveSignal` (one per socket), so this lifecycle
  // opts its own out (`heartbeat: false`). `createServerLifecycle`'s transport listeners
  // auto-wire to `onCleanup` on the CURRENT owner — the manager runs `makeConnection`
  // under a per-entry root, so they tie to THAT and are torn down when the manager
  // disposes the entry on a switch. No dedicated root here: makeBinding is pure
  // construction (the manager owns the entry's reactive lifetime).
  const { lifecycle, serverProcessId, status } = createServerLifecycle({
    ws: conn.ws,
    probe: () => surfaceAppProbe(conn.clients.surfaceApp),
    heartbeat: false,
    onProcessId: conn.echo.remember,
    onProbeError: (err) =>
      console.error(`surfaceApp.info probe failed (host ${targetHost}):`, err),
    restartCloseCode: STALE_PROCESS_CLOSE_CODE,
    onStaleRestart: () => retireSocket(conn.ws),
  });

  return {
    host: targetHost,
    clients: conn.clients,
    link: conn.link,
    ws: conn.ws as unknown as WebSocket,
    status,
    lifecycle,
    serverProcessId,
    // The socket teardown the manager calls on retire: tear down the clients/transport,
    // THEN retire the socket (close it + stub `send` to throw) so a late call on this dead
    // binding throws at the transport instead of re-dialing this host after the tab moved.
    // The lifecycle's own listeners tear down with the manager's per-entry root, and the
    // manager calls this exactly once (its `retired` set fences a rebuild) — so no manual
    // `disposeLifecycle()`, no `retired` self-guard.
    dispose: () => {
      conn.dispose();
      retireSocket(conn.ws);
    },
  };
}

// ── Per-tab persistence of the active host ──────────────────────────────
//
// `sessionStorage`, NOT `localStorage`: the active host is genuinely PER-TAB
// (each tab holds its own sockets and views one host). sessionStorage survives a
// reload of THIS tab — so a refresh lands back on the host it was viewing — while
// staying scoped to this browsing context: switching host in one tab never changes
// what another tab restores, and a brand-new tab starts clean (no stored host →
// `seedDefaultHost` falls to the server default). localStorage would leak the pick
// across every tab on the origin, contradicting the per-tab model.

const ACTIVE_HOST_KEY = "kolu-active-host";
function storeHost(h: string): void {
  try {
    sessionStorage.setItem(ACTIVE_HOST_KEY, h);
  } catch {
    // sessionStorage unavailable (private mode) — the switch still works in-memory.
  }
}
function readStoredHost(): string | undefined {
  try {
    return sessionStorage.getItem(ACTIVE_HOST_KEY) ?? undefined;
  } catch {
    // sessionStorage unavailable (private mode / storage disabled): there IS no
    // stored host to honor, so `undefined` is the correct answer, not a lost value —
    // the tab genuinely starts clean and `seedDefaultHost` falls to the server
    // default, exactly as a fresh tab does. Nothing to recover or surface.
    return undefined;
  }
}

// ── The active-connection manager, wired with padi policy ───────────────
//
// `const`: the manager ENACTS the 1008 fallback itself (it switches to `fallbackKey`), so
// `onServerRejected` is notification-only and no longer needs a forward reference to
// `manager` — the old `let`-then-assign dance is gone.
const manager = createActiveConnectionManager<string, Binding>({
  initialKey: LOCAL_HOST,
  makeConnection: makeBinding,
  socketOf: (b) => b.ws,
  isFallbackKey: (h) => h === LOCAL_HOST,
  fallbackKey: LOCAL_HOST,
  serverRejectedCloseCode: 1008,
  // Warm the host server-side BEFORE opening a socket to it (a deliberate
  // add-then-connect — never a side-effectful GET), routed through the CURRENT (live)
  // binding's link — its host set is the shared pool.
  warm: async (h, active) => {
    await active.link.hosts.add({ host: h });
  },
  // A superseded warm (the user re-picked while `hosts.add` was in flight over ssh)
  // stays quiet — don't toast over a host the user already moved on from.
  onWarmError: (h, err, superseded) => {
    if (superseded) return;
    toast.error(
      `Couldn't reach host "${h}": ${err instanceof Error ? err.message : String(err)}`,
    );
  },
  // NOTIFY only: the server rejected this host as UNKNOWN (close 1008 — removed from the
  // shared pool by another device, or a stale tab whose host is gone). The manager itself
  // stops the reconnect loop and switches to `fallbackKey` (local); this just tells the
  // user why.
  onServerRejected: (h) => {
    toast.error(`Host "${h}" is no longer available — switched to local.`);
  },
  persistence: { read: readStoredHost, store: storeHost },
});

/** The host this tab is currently looking at. */
export const activeHost = manager.activeKey;

/** The active host's binding — lazily built + cached, rebuilt if retired. Reactive on
 *  `activeHost`, so every accessor that reads it (`padi()`, `app()`, the `bindingScoped`
 *  subs) re-derives the instant the tab switches host. */
export const activeBinding = manager.activeConnection;

/** Switch this tab to `host`, live, with no page reload — warm the pool first
 *  (add-then-connect), last-intent-wins over overlapping picks, then swap the binding. */
export const switchHost = manager.switchTo;

// The per-tab boot restore is the manager's construction-time `persistence.read()` (see
// `readStoredHost` below) — there is no separate `restoreStoredHost`/`manager.restore`.
// A late-restore consumer, if one ever appears, must go through `setActive` (or
// `switchHost`) so it inherits the retirement + misroute guard; a raw signal flip would
// silently skip them.

// ── Kolu policy: the server default host, forget, the re-key alias ───────

const [knownDefaultHost, setKnownDefaultHost] =
  createSignal<string>(LOCAL_HOST);
/** The server's default host (`KOLU_PADI_HOST` ?? local), learned from
 *  `server.info` — offered by the picker even when it isn't yet a "recent". */
export const serverDefaultHost = knownDefaultHost;

/** Remember the server's default host and, on a FRESH tab (no stored host), fall to
 *  it — so a CI run booted through `KOLU_PADI_HOST` lands there while the picker still
 *  switches freely. Called once after `server.info` resolves; never overrides a pick. */
export function seedDefaultHost(defaultHost: string): void {
  if (defaultHost) setKnownDefaultHost(defaultHost);
  // A fresh tab (nothing stored) still on local → fall to the server default.
  // `readStoredHost() === undefined` IS the presence check, so no separate helper.
  if (
    readStoredHost() === undefined &&
    activeHost() === LOCAL_HOST &&
    defaultHost
  ) {
    manager.setActive(defaultHost);
  }
}

/** Forget a host: drop it from the server pool + `recentHosts`, and (if it is the
 *  active one) fall back to local. */
export async function forgetHost(host: string): Promise<void> {
  if (host === LOCAL_HOST) return;
  if (host === activeHost()) manager.setActive(LOCAL_HOST);
  try {
    await activeBinding().link.hosts.remove({ host });
  } catch (err) {
    toast.error(
      `Couldn't forget host "${host}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Open a subscription against the ACTIVE binding, re-keyed per host — kolu's POLICY
 * alias of the manager's `connectionScoped` (the framework's L11 endpoint). The factory
 * reads the active binding and is re-run per host, its prior root disposed first (no
 * stale sub leaks across a switch, #1687) and the value populated synchronously on first
 * read. Must be called under a reactive owner (a `createSharedRoot` factory, a component,
 * or `createRoot`).
 */
export const bindingScoped = manager.connectionScoped;

/** The app-lifetime singleton form of {@link bindingScoped}: wrap the re-keying
 *  sub in a `createSharedRoot` so it has ONE app-owned reactive owner shared by
 *  every consumer (never a component's owner, which fast-refresh/teardown would
 *  dispose out from under the others), and DEREF that shared accessor internally so a
 *  consumer gets the current host's sub handle in ONE call — `useX()`, then
 *  `.value()`/`.byKey()`/… — never a nested double-call. Each `useX()` re-reads the
 *  re-keying accessor, so it follows a host switch. Collapses the
 *  `createSharedRoot(() => bindingScoped(...))` boilerplate the standing per-host
 *  subscriptions (daemon status, inventory, memory, uptime, kaval status) repeat. */
export function useBindingScopedSub<T>(pick: (binding: Binding) => T): () => T {
  const shared = createSharedRoot(() => bindingScoped(pick));
  // Deref in two steps (resolve the shared re-keying accessor, then read it) so this is
  // the ONLY place the double-read lives — callers get the sub handle in one `useX()`.
  return () => {
    const scoped = shared();
    return scoped();
  };
}
