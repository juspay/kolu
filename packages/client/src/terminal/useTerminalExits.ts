/** Terminal exit subscriptions — list-keyed lifecycle.
 *
 *  Each terminal needs a one-shot subscription to its server `terminalExit`
 *  event (to toast the exit code and clean up client view state). The set of
 *  those subscriptions is a pure function of the live terminal list, so it is
 *  driven the same way `useTerminalMetadata` drives its per-terminal metadata
 *  subscriptions: `mapArray` gives each terminal id its own reactive owner and
 *  disposes it the instant the id leaves the list — see solidjs.md,
 *  "mapArray for dynamic per-entity subscriptions".
 *
 *  This list-keyed disposal is the fix for the leak where explicit kills
 *  stranded a `createRoot` owner and an open event stream forever: an explicit
 *  kill never publishes `terminalExit` (only natural exits do), so the only
 *  signal that releases the subscription is the terminal's departure from the
 *  list — which a per-create-site `createRoot` whose disposer was dropped could
 *  never observe. Routing every removal (natural exit, explicit kill, killAll,
 *  server restart) through the same list-keyed owner closes the leak uniformly,
 *  with no manual disposer map at any call site. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, mapArray } from "solid-js";

export function useTerminalExits(deps: {
  /** The live terminal id set (top-level and sub-terminals). */
  ids: Accessor<TerminalId[]>;
  /** Open one terminal's exit subscription. Runs inside the per-id reactive
   *  owner `mapArray` creates, so the subscription's own `onCleanup` (the
   *  wire event's `useEvent`) is disposed when the id leaves the list. */
  subscribe: (id: TerminalId) => void;
}) {
  // `mapArray` is lazy — it only reconciles (creating new owners, disposing
  // departed ones) when its accessor is read in a tracking scope. There is no
  // value consumer here (the subscriptions are pure side effects), so drive it
  // from an effect to keep the per-id owners instantiated and reconciled.
  const reconcile = mapArray(deps.ids, (id) => {
    deps.subscribe(id);
  });
  createEffect(reconcile);
}
