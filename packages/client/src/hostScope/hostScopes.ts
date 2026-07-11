/** `hostScopes` — the per-host client-state owner. THE thing padi W7 exists to
 *  build: a `scopedByEntry(padiMap, groundedActiveHost, …)` over the host map, so every
 *  per-host CLIENT fact (focus, MRU, attention, camera, the restore latch) is
 *  born inside a per-host reactive root — per-host BY CONSTRUCTION, not by a
 *  hand-keyed record a new field can be forgotten in.
 *
 *  Lifetime (the ratified contract, from `scopedByEntry`): a host's owner is
 *  created LAZILY on first activation, RETAINED across every switch-away (its
 *  focus + MRU + camera survive in memory — the "cheap, client-owned" state),
 *  and DISPOSED only when the host leaves `padiMap.entries`. `ctx.isActive` is
 *  the owner's "am I the shown host" accessor.
 *
 *  What is DELIBERATELY NOT here (K1): the wire subscriptions (the `terminals`
 *  collection, saved session, activity feed) stay active-host-only via
 *  `padiMap.useEntry(activeHost)` re-keying in `wire.ts` — the owner retains
 *  cheap client-owned state, never sockets. (A future improvement — retaining
 *  those subs for instant switch-back — is consciously excluded from W7; see the
 *  atlas W7 stamp.)
 *
 *  The `scopedByEntry` call is built through `createSharedRoot` — the in-repo
 *  primitive for a lazy-once value inside a never-disposed `createRoot` (the
 *  sanctioned app-lifetime owner); `wire.ts`'s `hostScoped` is the EAGER twin that
 *  can't be lazy (it must establish its re-keying owner at import). Lazy — rather
 *  than a module-const built at import — so the owner's `padiMap` read is decoupled
 *  from module-import ORDER: a unit test can stand up a mock `padiMap` (via
 *  `./wire`) before the owner first reads it, and production builds it on the first
 *  canvas render with no functional difference.
 *  The facades (`useViewState`, `useCanvasViewport`, `useSessionRestore`,
 *  `TerminalCanvas`) read `activeScope()` as a WINDOW onto the owner. */

import { type ScopedByEntry, scopedByEntry } from "@kolu/surface-map/client";
import type { HostKey } from "kolu-common/hostKey";
import type { Accessor } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { groundedActiveHost, padiMap } from "../wire";
import { createCamera, type HostCamera } from "./createCamera";
import { createHostPrefs, type HostPrefs } from "./createHostPrefs";
import {
  createSessionRestore,
  type HostRestoreLatch,
} from "./createSessionRestore";
import { createViewState, type HostViewState } from "./createViewState";

/** One host's owned client-state world. */
export interface HostScope {
  view: HostViewState;
  prefs: HostPrefs;
  camera: HostCamera;
  restore: HostRestoreLatch;
}

const scopes: () => ScopedByEntry<HostKey, HostScope> = createSharedRoot(() =>
  scopedByEntry(
    padiMap,
    // GROUNDED against membership (juspay/kolu#1763): the scope is never handed an
    // active host membership does not ground — a not-yet-grounded boot host (active
    // restored sync from sessionStorage before the entries snapshot) reads as `null`
    // (no-selection, no removal-race warn), NOT a non-member. See `wire.groundedActiveHost`.
    groundedActiveHost,
    (host: HostKey): HostScope => ({
      view: createViewState(host),
      prefs: createHostPrefs(host),
      camera: createCamera(),
      restore: createSessionRestore(),
    }),
  ),
);

/** The ACTIVE host's owned world — `undefined` while nothing is grounded: the boot
 *  window before the `entries` snapshot lands (`groundedActiveHost` is `null`,
 *  juspay/kolu#1763) and the removal race (the active host left the pool; `wire.ts`'s
 *  membership reconcile re-points `activeHost` to LOCAL a tick later). Every facade
 *  floors this `undefined` to the empty view, exactly as the pre-W7
 *  `hosts[hostKey()] ?? empty` did. */
export const activeScope: Accessor<HostScope | undefined> = () =>
  scopes().active();
