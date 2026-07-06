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
import { type Accessor, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { activeBinding, type Binding, bindingScoped } from "./binding/bindings";

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

/** kolu's OWN surface client for the active host (`app.cells.preferences.use`,
 *  `.processMemory`, `app.health()` — folding the padi `connection` cell's
 *  readiness in by construction). */
export const app: Clients["kolu"] = activeProxy((b) => b.clients.kolu);

/** surface-app's surface client for the active host — the build-identity
 *  `buildInfo` cell + the `identity.info` restart probe. */
export const surfaceApp: Clients["surfaceApp"] = activeProxy(
  (b) => b.clients.surfaceApp,
);

/** The `@kolu/padi` surface client for the active host — the PRIMARY source of
 *  every terminal-derived member and every lifecycle/chrome/screen/fs/git/session
 *  procedure via `padiRpc(padi)`. */
export const padi: Clients["padi"] = activeProxy((b) => b.clients.padi);

/** The FULL combined link for the active host — `client.server.info(...)`,
 *  `client.daemon.restart(...)`, `client.hosts.add(...)`. */
export const client: Binding["link"] = activeProxy((b) => b.link);

// Keep `window.__koluWs` pointed at the ACTIVE binding's socket for the reconnect
// e2e (which drops/restores it). Re-points on every switch.
createRoot(() => {
  bindingScoped((b) => {
    (window as Window & { __koluWs?: WebSocket }).__koluWs = b.ws;
    return b.ws;
  });
});

// ── App-lifetime singleton subscriptions, re-keyed per host ─────────────

let _preferences!: Accessor<
  ReturnType<Clients["kolu"]["cells"]["preferences"]["use"]>
>;
let _activityFeed!: Accessor<
  ReturnType<Clients["padi"]["cells"]["activityFeed"]["use"]>
>;
let _savedSession!: Accessor<
  ReturnType<Clients["padi"]["cells"]["session"]["use"]>
>;
let _terminalKeys!: Accessor<Subscription<TerminalId[]>>;

createRoot(() => {
  _preferences = bindingScoped((b) =>
    b.clients.kolu.cells.preferences.use({
      authority: "local",
      initial: DEFAULT_PREFERENCES,
      // Debounce window for size writes that opt in via `{ coalesce: true }` (#1041).
      coalesceMs: 150,
      onError: (err) => toast.error(`Preferences error: ${err.message}`),
    }),
  );
  _activityFeed = bindingScoped((b) =>
    b.clients.padi.cells.activityFeed.use({
      onError: (err) =>
        toast.error(`Activity feed subscription error: ${err.message}`),
    }),
  );
  _savedSession = bindingScoped((b) =>
    b.clients.padi.cells.session.use({
      onError: (err) =>
        toast.error(`Saved-session subscription error: ${err.message}`),
    }),
  );
  // The live terminal list — DERIVED from padi's `terminals` keys stream, re-keyed
  // per host: `bindingScoped` re-creates the underlying `createSubscription` against
  // the active binding on a switch.
  _terminalKeys = bindingScoped((b) =>
    createSubscription<TerminalId[]>(
      () =>
        unenrolledStreamCall(
          padiRpc(b.clients.padi).surface.terminals.keys,
          undefined,
        ),
      { onError: (err) => toast.error(`Terminal list error: ${err.message}`) },
    ),
  );
});

/** Local-store accessor for user preferences — authoritative after the first
 *  server yield. */
export const preferences = (): Preferences =>
  _preferences().value() ?? DEFAULT_PREFERENCES;

/** The preferences subscription handle — for `.pending()` / `.error()` boot gating.
 *  Forwards to the ACTIVE binding's sub so consumers keep the `Subscription` shape. */
export const preferencesSub: Subscription<Preferences> = Object.assign(
  () => _preferences().sub(),
  {
    pending: () => _preferences().sub.pending(),
    error: () => _preferences().sub.error(),
  },
) as Subscription<Preferences>;

/** Patch user preferences; reports failures via `toast`. Pass `{ coalesce: true }`
 *  for high-frequency writes (panel-size drags). */
export function updatePreferences(
  patch: PreferencesPatch,
  opts?: { coalesce?: boolean },
): void {
  void _preferences()
    .patch(patch, opts)
    .catch((err: Error) =>
      toast.error(`Failed to save preferences: ${err.message}`),
    );
}

export const recentRepos = (): RecentRepo[] =>
  _activityFeed().value()?.recentRepos ?? [];
export const recentAgents = (): RecentAgent[] =>
  _activityFeed().value()?.recentAgents ?? [];

/** The persisted saved-session for the active host, or null when none / no yield. */
export const savedSession = (): SavedSession | null =>
  _savedSession().value() ?? null;
export const savedSessionSub: Subscription<SavedSession | null> = Object.assign(
  () => _savedSession().sub(),
  {
    pending: () => _savedSession().sub.pending(),
    error: () => _savedSession().sub.error(),
  },
) as Subscription<SavedSession | null>;

/** Subscription handle for the live terminal list — `{ id }` rows in server order,
 *  re-keyed per host. */
export const terminalListSub: Subscription<{ id: TerminalId }[]> =
  Object.assign(() => _terminalKeys()()?.map((id) => ({ id })), {
    pending: () => _terminalKeys().pending(),
    error: () => _terminalKeys().error(),
  }) as Subscription<{ id: TerminalId }[]>;
