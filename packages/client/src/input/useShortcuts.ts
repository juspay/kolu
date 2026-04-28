/** Global keyboard shortcuts — single capture-phase listener that dispatches
 *  through the unified action registry in `./actions.ts`. */

import { makeEventListener } from "@solid-primitives/event-listener";
import type { TerminalId } from "kolu-common";
import { ACTIONS, type ActionContext } from "./actions";
import { matchesKeybind } from "./keyboard";

/** MRU cycling state — a frozen snapshot is taken on the first Tab press while
 *  the modifier (Alt or Ctrl) is held, and the cursor advances through that
 *  snapshot on each subsequent Tab. Using the live MRU would re-order under
 *  our feet as setActiveId fires. Snapshot resets on modifier keyup. */
interface MruCycleState {
  snapshot: TerminalId[];
  cursor: number;
}

/** Wire up all global keyboard shortcuts. Call once from the app root. */
export function useShortcuts(ctx: ActionContext) {
  let cycle: MruCycleState | null = null;

  function resetCycle() {
    cycle = null;
  }

  function advanceCycle(direction: 1 | -1) {
    if (cycle === null) {
      // First press: snapshot current MRU, include active id at head if missing.
      const live = ctx.mruOrder();
      const active = ctx.activeId();
      const snap =
        active && !live.includes(active) ? [active, ...live] : live.slice();
      if (snap.length < 2) return; // nothing to cycle between
      cycle = { snapshot: snap, cursor: 0 };
    }
    const n = cycle.snapshot.length;
    cycle.cursor = (cycle.cursor + direction + n) % n;
    const target = cycle.snapshot[cycle.cursor];
    if (target) ctx.setActiveId(target);
  }

  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      const handled = dispatch(e, ctx, advanceCycle);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true },
  );

  // Commit the MRU cycle when the user releases the modifier key.
  makeEventListener(window, "keyup", (e: KeyboardEvent) => {
    if (e.key === "Alt" || e.key === "Control") resetCycle();
  });
}

/** Try to handle the event. Returns true if a shortcut matched. */
function dispatch(
  e: KeyboardEvent,
  ctx: ActionContext,
  advanceCycle: (direction: 1 | -1) => void,
): boolean {
  // Alt+Tab / Ctrl+Tab: stateful MRU cycling, committed on modifier release.
  // Alt+Tab covers macOS Chrome, which intercepts Ctrl+Tab. Must come before
  // the registry loop so Ctrl+Tab doesn't fall through to cycleTerminalMru
  // (which has no handler — it's display-only and dispatched here).
  if (e.key === "Tab" && (e.altKey || e.ctrlKey)) {
    advanceCycle(e.shiftKey ? -1 : 1);
    return true;
  }

  // Generic dispatch over the action registry.
  for (const action of Object.values(ACTIONS)) {
    if (!action.handler) continue;
    if (
      matchesKeybind(e, action.keybind) ||
      (action.altKeybind !== undefined && matchesKeybind(e, action.altKeybind))
    ) {
      action.handler(ctx);
      return true;
    }
  }

  return false;
}
