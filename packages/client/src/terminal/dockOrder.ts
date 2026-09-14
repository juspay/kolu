/** The user's drag arrangement of the dock — per-device, persisted PER HOST.
 *
 *  A sibling to `showSleeping` / `activityWindow`: the same `activeScope().prefs`
 *  window onto one host's sticky per-host preference. Empty (the default) means
 *  the dock is in pure structural order — creation order, nothing ever dragged.
 *  `buildDockTree` consumes it as an OVERLAY: anything never dragged keeps
 *  behaving exactly as before (a new repo/branch appends at the bottom). */
import { activeScope } from "../hostScope/hostScopes";
import type { DockOrder } from "../canvas/dock/dockTree";

/** The ACTIVE host's dock arrangement — read through the facade; floors the
 *  removal race to `[]` (the empty/structural default). */
export function dockOrder(): DockOrder {
  return activeScope()?.prefs.dockOrder() ?? [];
}

/** Set the ACTIVE host's dock arrangement (a no-op during the removal race).
 *  `buildDockTree` merges this over the structural order, so writing the FULL
 *  `effectiveOrder` after a drop keeps exactly one merge rule at read time. */
export function setDockOrder(next: DockOrder): void {
  activeScope()?.prefs.setDockOrder(next);
}
