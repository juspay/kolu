/**
 * The wire — W4 "the switch".
 *
 * Before W4 this module built ONE `connectSurfaces` bundle at page load and
 * exported the three sibling clients (`app`/`surfaceApp`/`padi`) + the combined
 * `client` link as module-global CONSTS — baking in "the wire lives exactly as
 * long as the page". W4 breaks it: the bundles live in `binding/bindings.ts` (one
 * per host, a `connectSurfaces` to `?host=<host>`), and this module now exports the
 * same names as PROXIES over the ACTIVE binding. A read like
 * `padi.collections.terminals.use(...)` forwards to the active host's client at
 * access time, so a per-component subscription re-keys automatically when the tab
 * switches host (the terminal list re-keys → the `<For>` re-mounts the tiles → each
 * tile's `.use(...)` reads the new host's client). No page reload; no `padi()`
 * rename across the ~35 consumers.
 *
 * The APP-LIFETIME singletons (`preferences`, `recentRepos`, `savedSession`, the
 * terminal list) can't ride a re-mount — they open their sub once — so they re-key
 * explicitly through `bindingScoped`, which tears down the prior host's sub and
 * opens a fresh one on a switch (no leak across the swap — the gray-chip #1687
 * class, the client twin of the surface-app framework guarantee).
 *
 * This is the interim wire shape the plan's L11 sweeps into a scope-through-context.
 */

import {
  padiRpc,
  type RecentAgent,
  type RecentRepo,
  type SavedSession,
} from "@kolu/padi/surface";
import { unenrolledStreamCall } from "@kolu/surface/client";
import { createSubscription, type Subscription } from "@kolu/surface/solid";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type PreferencesPatch,
  type TerminalId,
} from "kolu-common/surface";
import { type Accessor, createEffect, createRoot, on } from "solid-js";
import { toast } from "solid-sonner";
import {
  activeBinding,
  activeHost,
  type Binding,
  useBindingScopedSub,
} from "./binding/bindings";

// ── The active binding's sibling clients + link, as PROXIES ─────────────
//
// Each proxy forwards top-level property access to the ACTIVE binding's client, so
// `padi.collections`, `app.cells`, `padiRpc(padi)` (reads `padi.rpc`), `app.health()`,
// `client.server.info(...)` all resolve against the host the tab is currently on.

function activeProxy<T extends object>(pick: (b: Binding) => T): T {
  return new Proxy({} as T, {
    get: (_t, prop) =>
      (pick(activeBinding()) as Record<PropertyKey, unknown>)[prop],
    has: (_t, prop) => prop in (pick(activeBinding()) as object),
  });
}

type Clients = Binding["clients"];

// B0 — the structural backstop. A persistent subscription (`.use()`) opened on the
// module-global active-binding PROXY pins whichever host was active at the CALL site's
// evaluation and never re-keys on a switch (the #1687 stale-binding class). Strip
// `.use()` off the proxy exports at the TYPE level, so opening a sub outside
// `bindingScoped` is a COMPILE ERROR, not a review catch — the compiler enumerates
// every violating site. Subs go through `bindingScoped((b) => b.clients.X.<m>.use(...))`
// (re-keys per host); mutations (`.patch`), one-shot `.get`, `padiRpc(...)`, and
// `.health()` stay on the proxy (call-time correct — they resolve the active binding
// each call and don't retain a subscription).
type Subscriptionless<C> = {
  [G in keyof C]: G extends "cells" | "collections" | "streams" | "events"
    ? { [M in keyof C[G]]: Omit<C[G][M], "use"> }
    : C[G];
};

/** kolu's OWN surface client for the active host (`app.cells.preferences.patch`,
 *  `app.health()` — folding the padi `connection` cell's readiness in by
 *  construction). `.use()` is stripped (B0) — open subs via `bindingScoped`. */
export const app: Subscriptionless<Clients["kolu"]> = activeProxy(
  (b) => b.clients.kolu,
);

/** The `@kolu/padi` surface client for the active host — the PRIMARY source of
 *  every lifecycle/chrome/screen/fs/git/session procedure via `padiRpc(padi)`.
 *  `.use()` is stripped (B0) — open subs via `bindingScoped`. */
export const padi: Subscriptionless<Clients["padi"]> = activeProxy(
  (b) => b.clients.padi,
);

/** The FULL combined link for the active host — `client.server.info(...)`,
 *  `client.daemon.restart(...)`, `client.hosts.add(...)`. */
export const client: Binding["link"] = activeProxy((b) => b.link);

// Keep `window.__koluWs` pointed at the ACTIVE binding's socket for the reconnect
// e2e (which drops/restores it). A plain re-pointing effect — this opens no
// disposable subscription, so it needs none of `bindingScoped`'s per-switch
// root/dispose machinery; it just re-assigns on every host change.
createRoot(() => {
  createEffect(
    on(activeHost, () => {
      (window as Window & { __koluWs?: WebSocket }).__koluWs =
        activeBinding().ws;
    }),
  );
});

// ── App-lifetime singleton subscriptions, re-keyed per host ─────────────
//
// Each is a `useBindingScopedSub` — an app-lifetime shared root over a `bindingScoped`
// sub — so it re-opens against the active binding on a switch (no leak across the swap,
// #1687) and yields the current host's sub handle in ONE call (`useX()`, then
// `.value()`/`.sub`/`.patch`). The type is inferred from the pick, so no hand-spelled
// `Accessor<ReturnType<…>>` chains.

const usePreferences = useBindingScopedSub((b) =>
  b.clients.kolu.cells.preferences.use({
    authority: "local",
    initial: DEFAULT_PREFERENCES,
    // Debounce window for size writes that opt in via `{ coalesce: true }` (#1041).
    coalesceMs: 150,
    onError: (err) => toast.error(`Preferences error: ${err.message}`),
  }),
);
// D1 — the picker's "recents" ride their OWN server-authority cell (NOT preferences),
// so a `hosts.add` on another device reaches THIS tab's open picker live. No
// `authority: "local"` — the default honors the server's pushes.
const useRecentHosts = useBindingScopedSub((b) =>
  b.clients.kolu.cells.recentHosts.use({
    onError: (err) => toast.error(`Recent hosts error: ${err.message}`),
  }),
);
const useActivityFeed = useBindingScopedSub((b) =>
  b.clients.padi.cells.activityFeed.use({
    onError: (err) =>
      toast.error(`Activity feed subscription error: ${err.message}`),
  }),
);
const useSavedSession = useBindingScopedSub((b) =>
  b.clients.padi.cells.session.use({
    onError: (err) =>
      toast.error(`Saved-session subscription error: ${err.message}`),
  }),
);
// The live terminal list — DERIVED from padi's `terminals` keys stream, re-keyed
// per host: `bindingScoped` (inside the helper) re-creates the underlying
// `createSubscription` against the active binding on a switch.
const useTerminalKeys = useBindingScopedSub((b) =>
  createSubscription<TerminalId[]>(
    () =>
      unenrolledStreamCall(
        padiRpc(b.clients.padi).surface.terminals.keys,
        undefined,
      ),
    { onError: (err) => toast.error(`Terminal list error: ${err.message}`) },
  ),
);

/** Local-store accessor for user preferences — authoritative after the first
 *  server yield. */
export const preferences = (): Preferences =>
  usePreferences().value() ?? DEFAULT_PREFERENCES;

/** The warm pool's remembered hosts, live from the server-authority `recentHosts` cell
 *  (D1) — updates when ANY device adds/removes a host, with no reload. `[]` before the
 *  first yield. */
export const recentHosts = (): readonly string[] =>
  useRecentHosts().value() ?? [];

/** Re-key a `Subscription` handle onto whatever the ACTIVE binding currently
 *  exposes: `active()` yields the current host's sub each read, so `()`/`.pending`/
 *  `.error` all follow a host switch. `map` reshapes the value (e.g. terminal ids →
 *  `{ id }` rows). One helper so the Subscription-shaped exports below — consumed as
 *  stable objects (`terminalListSub` is passed to `useTerminalStore`) — aren't
 *  hand-repeated. (`active()` is resolved then read in two steps, never `()()`.) */
function reSub<T, U = T>(
  active: Accessor<Subscription<T>>,
  map: (v: T | undefined) => U = (v) => v as unknown as U,
): Subscription<U> {
  return Object.assign(
    () => {
      const sub = active();
      return map(sub());
    },
    {
      pending: () => active().pending(),
      error: () => active().error(),
    },
  ) as Subscription<U>;
}

/** The preferences subscription handle — for `.pending()` / `.error()` boot gating,
 *  forwarding to the ACTIVE binding's sub so consumers keep the `Subscription` shape. */
export const preferencesSub: Subscription<Preferences> = reSub(
  () => usePreferences().sub,
);

/** Patch user preferences; reports failures via `toast`. Pass `{ coalesce: true }`
 *  for high-frequency writes (panel-size drags). */
export function updatePreferences(
  patch: PreferencesPatch,
  opts?: { coalesce?: boolean },
): void {
  void usePreferences()
    .patch(patch, opts)
    .catch((err: Error) =>
      toast.error(`Failed to save preferences: ${err.message}`),
    );
}

export const recentRepos = (): RecentRepo[] =>
  useActivityFeed().value()?.recentRepos ?? [];
export const recentAgents = (): RecentAgent[] =>
  useActivityFeed().value()?.recentAgents ?? [];

/** The persisted saved-session for the active host, or null when none / no yield. */
export const savedSession = (): SavedSession | null =>
  useSavedSession().value() ?? null;
export const savedSessionSub: Subscription<SavedSession | null> = reSub(
  () => useSavedSession().sub,
);

/** Subscription handle for the live terminal list — `{ id }` rows in server order,
 *  re-keyed per host. */
export const terminalListSub: Subscription<{ id: TerminalId }[]> = reSub(
  useTerminalKeys,
  (ids) => ids?.map((id) => ({ id })) ?? [],
);
