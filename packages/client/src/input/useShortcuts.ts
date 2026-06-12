/** Global keyboard shortcuts — single capture-phase listener that dispatches
 *  through the unified action registry in `./actions.ts`. */

import { makeEventListener } from "@solid-primitives/event-listener";
import type { TerminalId } from "kolu-common/surface";
import {
  ACTIONS,
  type ActionContext,
  type ActionId,
  type AppAction,
  isDispatchable,
} from "./actions";
import { matchesKeybind } from "./keyboard";

/** MRU cycling state — a frozen snapshot is taken on the first Tab press while
 *  the modifier (Alt or Ctrl) is held, and the cursor advances through that
 *  snapshot on each subsequent Tab. Using the live MRU would re-order under
 *  our feet as activate fires. Snapshot resets on modifier keyup. */
interface MruCycleState {
  snapshot: TerminalId[];
  cursor: number;
}

/** Match the event against an action's primary or alt keybind. */
function actionMatches(action: AppAction, e: KeyboardEvent): boolean {
  if (matchesKeybind(e, action.keybind)) return true;
  if (action.altKeybind && matchesKeybind(e, action.altKeybind)) return true;
  return false;
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
    if (target) ctx.activate(target);
  }

  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      // Bail when focus is inside an opt-in modal — comment composer,
      // command palette body, anything else that marks itself with
      // `data-kolu-modal="true"`. Without this, capture-phase global
      // shortcuts (this listener) fire BEFORE any bubble-phase handler
      // the modal installs, so Cmd+Enter in a textarea would dispatch
      // both "New terminal" (here) AND the modal's Save (later). Modals
      // self-opt by setting the attribute; they keep full control of
      // every keystroke while focused.
      const target = e.target as Element | null;
      if (target?.closest?.('[data-kolu-modal="true"]')) return;
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
  for (const [id, action] of Object.entries(ACTIONS) as [
    ActionId,
    AppAction,
  ][]) {
    if (!actionMatches(action, e)) continue;

    // A scoped action can decline a matched event (e.g. findInTerminal defers
    // to the browser's native find inside the Code tab). `continue` here keeps
    // looping — but no other action claims this chord, so `dispatch` returns
    // false and the listener skips `preventDefault`, letting the browser's
    // default action for the chord fire.
    const insideNativeFind =
      action.nativeFindMarker != null &&
      (e.target as Element | null)?.closest?.(action.nativeFindMarker) != null;
    if (insideNativeFind) continue;

    // cycleTerminalMru is stateful — the closure-bound snapshot/cursor pattern
    // can't fit the registry's plain `(ctx) => void` handler shape, so it's
    // the one display-only action the dispatcher consults by id.
    if (id === "cycleTerminalMru") {
      advanceCycle(e.shiftKey ? -1 : 1);
      return true;
    }

    if (isDispatchable(action)) {
      action.handler(ctx);
      return true;
    }

    // Display-only (zoom*) — don't claim the event; the per-terminal
    // `createZoom` listener owns the dispatch.
  }
  return false;
}
