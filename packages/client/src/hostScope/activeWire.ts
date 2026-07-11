/** The exported facades that WINDOW the active host's RETAINED wire subscriptions
 *  (`activeScope().wire`, padi W9). These read `activeScope()` — the retained
 *  per-host owner's active slot — so a switch-BACK reads the held value with no
 *  resubscribe and no pending window.
 *
 *  WHY ITS OWN MODULE (not `wire.ts`): these facades depend on `activeScope`
 *  (`./hostScopes`), which in turn depends on `wire.ts` (for `padiMap` / `activeHost`
 *  / `padiRpcOf`). Defining them IN `wire.ts` would make `wire.ts → hostScopes →
 *  wire.ts` a real import cycle (`biome`'s `noImportCycles`, CI-enforced). This module
 *  is the LEAF that closes the seam instead: it imports BOTH `wire.ts` (types) and
 *  `hostScopes` (`activeScope`), and nothing imports it back — so the graph stays
 *  acyclic (`wire ← hostScopes ← activeWire`). Consumers import these facades from
 *  HERE, not from `wire.ts`.
 *
 *  This module windows THREE of the five `HostScope.wire` members — `activityFeed`
 *  (via `recentRepos`/`recentAgents`), `session`, and `terminalKeys`. The other two
 *  are windowed where their heavy derivation already lives, not here: `terminals`
 *  through `terminal/useTerminalMetadata.ts` (the identity-stable metadata
 *  projection) and `daemonStatus` through `kaval/useDaemonStatus.ts` (the
 *  liveness/pending accessors) — each reads `activeScope().wire.<member>` directly.
 *
 *  Each exported facade reference is STABLE (a module-level accessor / `Object.assign`),
 *  so a consumer holding one is unaffected by a switch; only the value it reads follows
 *  the active host. `activeScope()` is briefly `undefined` during the removal race (the
 *  active host left the pool; `wire.ts`'s reconcile re-points `activeHost` a tick later)
 *  — each facade floors that to its empty form, exactly as the pre-W9 readouts floored a
 *  pending sub. */

import type { RecentAgent, RecentRepo, SavedSession } from "@kolu/padi/surface";
import type { Subscription } from "@kolu/surface/solid";
import type { TerminalId } from "kolu-common/surface";
import { activeScope } from "./hostScopes.ts";

export const recentRepos = (): RecentRepo[] =>
  activeScope()?.wire.activityFeed.value()?.recentRepos ?? [];
export const recentAgents = (): RecentAgent[] =>
  activeScope()?.wire.activityFeed.value()?.recentAgents ?? [];

/** The persisted saved-session for the active host, or null when none exists / no yield
 *  yet. A window over the active host's RETAINED session cell — switch-BACK reads the
 *  held value with no pending gap. */
export const savedSession = (): SavedSession | null =>
  activeScope()?.wire.session.value() ?? null;

/** Window an optional reactive owner (`select()`) into a floored `Subscription<T>`.
 *
 *  `savedSessionSub` and `terminalListSub` are the same concept — "window the active
 *  host's RETAINED sub into a STABLE facade" — differing only in which member they
 *  select and how they map its value. This helper is that concept, so the removal-race
 *  floor rule lives in ONE place and can't drift from `Subscription`'s shape or be
 *  re-stamped wrong at a new facade: `select()` is briefly `undefined` during the removal
 *  race (the active host left the pool; `wire.ts`'s reconcile re-points `activeHost` a
 *  tick later), and every field floors that gap the same way — `pending` to `true`
 *  (nothing to report reads pre-first-value), `error` passes through, `complete` to
 *  `false`, and the value to `floor` (the caller's empty form) when the source is absent
 *  or yields nullish.
 *
 *  `complete` is FORWARDED, not dropped: `session.sub` / `terminalKeys` are minted by
 *  this module's subscription factories, which always populate `complete` — omitting it
 *  would silently strand a consumer that checks it (there is none today, but the
 *  field-audit rule is "populate what the source has," not "only what today's readers
 *  use"). */
function windowedSub<S, T>(
  select: () => Subscription<S> | undefined,
  map: (v: NonNullable<S>) => T,
  floor: T | undefined,
): Subscription<T> {
  return Object.assign(
    (): T | undefined => {
      const s = select();
      const v = s?.();
      return v == null ? floor : map(v as NonNullable<S>);
    },
    {
      pending: (): boolean => select()?.pending() ?? true,
      error: (): Error | undefined => select()?.error(),
      complete: (): boolean => select()?.complete?.() ?? false,
    },
  );
}

/** The active host's saved-session Subscription handle — a STABLE facade (held by
 *  reference: `useSessionRestore`, `TerminalCanvas`) delegating to the retained session
 *  sub. Consumers read `savedSessionSub()` (the value) and `.pending()`; the reference is
 *  fixed while the value follows the active host. `pending()` floors to `true` during the
 *  removal race (no active host to report yet), matching a pre-first-value sub. */
export const savedSessionSub: Subscription<SavedSession | null> = windowedSub(
  () => activeScope()?.wire.session.sub,
  (v) => v,
  null,
);

/** Subscription handle for the live terminal list of the active host — `{ id }` rows in
 *  server order, derived from the active host's RETAINED `terminals.keys` stream. A STABLE
 *  facade (held as `useTerminalStore`'s `list`/`listSub`) delegating to the retained
 *  sub, so a switch-BACK reads the held keys in one frame (no resubscribe, no pending
 *  window). Consumers read `.map(t => t.id)` / `.pending()` exactly as before; `pending()`
 *  floors to `true` and the value to `undefined` during the removal race. */
export const terminalListSub: Subscription<{ id: TerminalId }[]> = windowedSub(
  () => activeScope()?.wire.terminalKeys,
  (ids) => ids.map((id) => ({ id })),
  undefined,
);
