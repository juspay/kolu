/**
 * The host binding — W4 "the switch".
 *
 * Before W4 the client's wire was ONE module-global `connectSurfaces` bundle,
 * pinned to `window.location.host`, that lived exactly as long as the page. This
 * module breaks that buried assumption: it holds ONE bundle PER host (each a
 * `connectSurfaces` to `?host=<host>` on the same kolu-server), and an
 * `activeHost` signal picks which one the tab is looking at. Picking a host swaps
 * the accessor IN PLACE — no page reload — and every subscription re-keys off it.
 *
 * This is the interim "wire shape" the plan's L11 later sweeps into a proper
 * scope-through-context (`docs/atlas/.../padi-cleanup`): W4 keeps the module-global
 * ACCESSORS (`padi()`, `app()`, …) that `wire.ts` re-exports, because the pool +
 * picker land here first and the full de-globalization is a mechanical follow-up.
 *
 * The MISROUTE GUARD lives here and is NOT deferred to L11: its teeth are the
 * `retired` flag plus separate sockets. Because each host is a SEPARATE socket, a
 * call can never cross to another host's server handler by construction; switching
 * RETIRES the old binding — tearing down its lifecycle root AND closing its socket
 * (`retireSocket`, which also stubs `send` to throw) — so an in-flight or late call
 * minted on the old host's client throws at the now-dead transport rather than
 * silently reconnecting to (and landing on) a stale host. A fresh `padi()`/`app()`
 * accessor never sees a retired binding at all, because `activeBinding()` rebuilds
 * one the moment the cached entry is retired. (`bindings.test.ts` pins that
 * switching retires the old binding and closes its socket.)
 */

import { STALE_PROCESS_CLOSE_CODE } from "@kolu/surface-app";
import {
  type ConnectionStatus,
  connectSurfaces,
  createKeyedRoot,
  createServerLifecycle,
  retireSocket,
  type ServerLifecycleEvent,
  surfaceAppProbe,
} from "@kolu/surface-app/solid";
import { type contract, LOCAL_HOST } from "kolu-common/contract";
import { surfacesWithPadi } from "kolu-common/surfacesWithPadi";
import { type Accessor, createRoot, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";

// `LOCAL_HOST` (the `"local"` sentinel) is defined once in kolu-common/contract
// and re-exported here for this module's consumers.
export { LOCAL_HOST };

const { protocol, host } = window.location;
const wsBase = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

/** The wire for one host: the `connectSurfaces` bundle over a `?host=<host>`
 *  socket, its own lifecycle (status), and the misroute-guard state. */
export interface Binding {
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
  /** True once this binding has been retired (switched away from + torn down). A
   *  call routed through a retired binding is a misroute — reject it. */
  retired: boolean;
  /** Close this host's socket + tear down its clients (the misroute-guard teardown). */
  dispose(): void;
}

function makeBinding(targetHost: string): Binding {
  // The `?host=` param the server dispatches on. The local host is passed
  // explicitly too, so a single-host tab's URL is `?host=local` — the server
  // treats a missing `?host` as its default, so this stays correct either way.
  const url = `${wsBase}?host=${encodeURIComponent(targetHost)}`;
  const conn = connectSurfaces<typeof contract, typeof surfacesWithPadi>({
    surfaces: surfacesWithPadi,
    url,
  });

  // Each host's socket owns its OWN lifecycle (status + stale-restart handling),
  // the per-binding twin of the pre-W4 module-level `rpc.ts` lifecycle. The
  // half-open watchdog lives in `connectSurfaces`' `createLiveSignal` (one per
  // socket), so this lifecycle opts its own out (`heartbeat: false`). It needs only
  // `conn` (never the Binding), so derive it FIRST and assemble the Binding once
  // with the real accessors — no placeholder-then-repatch dance.
  //
  // OWN the lifecycle under a DEDICATED root so its transport listeners are torn
  // down by THIS binding's dispose() — never by whatever incidental Solid owner
  // first read `activeBinding()`. Without the wrapper `createServerLifecycle`'s
  // `onCleanup` binds to that caller's owner: an app-lifetime owner would leak it
  // across every switch, and a short-lived component owner would free it EARLY
  // (killing status updates on a still-active binding). The root makes the
  // lifecycle's lifetime exactly the binding's.
  let disposeLifecycle!: () => void;
  const { lifecycle, serverProcessId, status } = createRoot((dispose) => {
    disposeLifecycle = dispose;
    return createServerLifecycle({
      ws: conn.ws,
      probe: () => surfaceAppProbe(conn.clients.surfaceApp),
      heartbeat: false,
      onProcessId: conn.echo.remember,
      onProbeError: (err) =>
        console.error(
          `surfaceApp.info probe failed (host ${targetHost}):`,
          err,
        ),
      restartCloseCode: STALE_PROCESS_CLOSE_CODE,
      onStaleRestart: () => retireSocket(conn.ws),
    });
  });

  const binding: Binding = {
    host: targetHost,
    clients: conn.clients,
    link: conn.link,
    ws: conn.ws as unknown as WebSocket,
    retired: false,
    status,
    lifecycle,
    serverProcessId,
    // Idempotent: a switch disposes the old binding, and its own lifecycle root
    // could dispose it a second time — the `retired` guard makes the re-entry a
    // no-op. Tear down the lifecycle root, the clients/transport, THEN retire the
    // socket (close it + stub `send` to throw) so a late call on this dead binding
    // throws at the transport instead of re-dialing this host after the tab moved.
    dispose: () => {
      if (binding.retired) return;
      binding.retired = true;
      disposeLifecycle();
      conn.dispose();
      retireSocket(conn.ws);
    },
  };

  installUnknownHostFallback(binding, conn.ws);

  return binding;
}

/** If the server rejects this host as UNKNOWN (close 1008 — the host was removed from
 *  the shared pool by another device, or this is a stale tab whose host is gone), stop
 *  the pointless reconnect loop and fall back to local. Without this a PartySocket
 *  (`maxRetries: Infinity`) would re-dial `?host=<gone>` forever while the server rejects
 *  each attempt, leaving the tab stuck on a misleading "Reconnecting…". Guarded to fire
 *  once — for the CURRENT host only, before this binding retires. */
function installUnknownHostFallback(
  binding: Binding,
  ws: {
    addEventListener: (t: "close", cb: (ev: { code?: number }) => void) => void;
  },
): void {
  ws.addEventListener("close", (ev) => {
    if (
      ev.code === 1008 &&
      !binding.retired &&
      binding.host !== LOCAL_HOST &&
      activeHost() === binding.host
    ) {
      toast.error(
        `Host "${binding.host}" is no longer available — switched to local.`,
      );
      void switchHost(LOCAL_HOST);
    }
  });
}

// ── The active binding + the warm client-side cache ─────────────────────

const [activeHostSignal, setActiveHostSignal] =
  createSignal<string>(LOCAL_HOST);
/** The host this tab is currently looking at. */
export const activeHost = activeHostSignal;

const cache = new Map<string, Binding>();

/** The active host's binding — lazily built + cached. Reactive on `activeHost`,
 *  so every accessor that reads it (`padi()`, `app()`, the `bindingScoped` subs)
 *  re-derives the instant the tab switches host. */
export function activeBinding(): Binding {
  const h = activeHost();
  let b = cache.get(h);
  if (!b || b.retired) {
    b = makeBinding(h);
    cache.set(h, b);
  }
  return b;
}

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
    setActiveHostInternal(defaultHost);
  }
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

function setActiveHostInternal(h: string): void {
  const prev = activeHost();
  if (h === prev) return;
  // Flip `activeHost` FIRST: this re-keys every app-lifetime `bindingScoped` sub off
  // the outgoing binding (createKeyedRoot disposes the old per-key root synchronously)
  // — and now that `useCell` ties its detached subscription root to that owner, the
  // dispose ABORTS the outgoing cell subs BEFORE we retire their socket below. That
  // abort is the guarantee a disposed sub can't report the retired socket's error (the
  // switch-toast bug was the visible edge of those subs LEAKING past the switch); the
  // abort signal is also threaded into the stream so the pending `next()` cancels at
  // once, not lingering until the socket errors. This ordering just keeps that tight.
  setActiveHostSignal(h);
  storeHost(h);
  // Retire the PREVIOUS binding: close its socket, tear down its subs. The server
  // keeps it warm in the pool, so switching BACK is instant; this only ends THIS
  // tab's view of it — never disturbing another device (each device/tab holds its
  // own sockets). Retiring is the misroute guard: any in-flight call on the old
  // socket now rejects instead of resolving against the wrong host.
  const old = cache.get(prev);
  if (old) {
    cache.delete(prev);
    old.dispose();
  }
}

/** Restore the per-tab host at boot (before the first binding is built), so a
 *  reload lands back on the host the tab was viewing. */
export function restoreStoredHost(): void {
  const stored = readStoredHost();
  if (stored) setActiveHostSignal(stored);
}

/** Switch this tab to `host`, live, with no page reload. Ensures the server pool
 *  holds `host` first (a deliberate add-then-connect — never a side-effectful GET),
 *  then swaps the active binding. Loud states (connecting / degraded) ride the new
 *  binding's `connection` cell; creating a terminal is refused until it is ready. */
// C1 — the switch epoch. `hosts.add` takes seconds over ssh, so picks can overlap.
// Every `switchHost` claims an epoch as its FIRST act (before the same-host early
// return — that placement is what lets re-picking the CURRENT host act as a CANCEL:
// it bumps the epoch, so an in-flight add for a different host is stale when it
// resolves). After each await, a pick that is no longer the latest bows out instead
// of yanking the tab — so last-pick-wins (not first-resolve-wins), and a superseded
// pick's failure doesn't toast over a host the user already moved on from.
let pickEpoch = 0;

export async function switchHost(host: string): Promise<void> {
  const myPick = ++pickEpoch;
  if (host === activeHost()) return;
  if (host !== LOCAL_HOST) {
    // Warm the binding server-side BEFORE opening a socket to it. Routed through
    // the CURRENT (live) binding's link — its host set is the shared pool.
    try {
      await activeBinding().link.hosts.add({ host });
    } catch (err) {
      if (myPick !== pickEpoch) return; // superseded — the user re-picked; stay quiet
      toast.error(
        `Couldn't reach host "${host}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }
  if (myPick !== pickEpoch) return; // a newer pick won — don't yank the tab back
  setActiveHostInternal(host);
}

/** Forget a host: drop it from the server pool + `recentHosts`, and (if it is the
 *  active one) fall back to local. */
export async function forgetHost(host: string): Promise<void> {
  if (host === LOCAL_HOST) return;
  if (host === activeHost()) setActiveHostInternal(LOCAL_HOST);
  try {
    await activeBinding().link.hosts.remove({ host });
  } catch (err) {
    toast.error(
      `Couldn't forget host "${host}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── The re-key helper ───────────────────────────────────────────────────

/**
 * Open a subscription against the ACTIVE binding, re-opening it (and disposing the
 * prior one) whenever the tab switches host. Returns an accessor to the current
 * subscription. This is how the client's app-lifetime singletons (which used to
 * open one sub against the one module-global wire) re-key on a switch WITHOUT the
 * full L11 scope-through-context port: the factory reads `activeBinding()` and is
 * re-run per host, its prior root disposed — so no stale sub leaks across a switch
 * (the gray-chip #1687 class). Must be called under a reactive owner (a
 * `createSharedRoot` factory, a component, or `createRoot`).
 */
export function bindingScoped<T>(
  factory: (binding: Binding) => T,
): Accessor<T> {
  // Keyed on `activeHost` (H1): `createKeyedRoot` re-runs the factory under a fresh root
  // per host, disposing the prior one on a switch — no stale sub leaks (#1687). It uses a
  // RENDER effect, so the value is populated SYNCHRONOUSLY on first read (a deferred
  // effect would leave it undefined until the effect phase, and a consumer reading
  // `X()().byKey(...)`/`.value()` on the first synchronous render would hit
  // `undefined.<member>` — the pre-W4 direct sub was never undefined; this keeps that).
  return createKeyedRoot(activeHost, () => factory(activeBinding()));
}

/** The app-lifetime singleton form of {@link bindingScoped}: wrap the re-keying
 *  sub in a `createSharedRoot` so it has ONE app-owned reactive owner shared by
 *  every consumer (never a component's owner, which fast-refresh/teardown would
 *  dispose out from under the others). Read it as `useX()()` — the outer call
 *  resolves the shared root, the inner reads the current host's sub. Collapses the
 *  `createSharedRoot(() => bindingScoped(...))` boilerplate the standing per-host
 *  subscriptions (daemon status, inventory, memory, uptime, kaval status) repeat. */
export function useBindingScopedSub<T>(
  pick: (binding: Binding) => T,
): () => Accessor<T> {
  return createSharedRoot(() => bindingScoped(pick));
}

// Restore the per-tab host BEFORE the first binding is built (this module is
// imported before `wire.ts` opens its subs), so a reload lands back on the host the
// tab was viewing rather than always starting on local.
restoreStoredHost();
