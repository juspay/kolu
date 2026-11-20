import { makeEventListener } from "@solid-primitives/event-listener";
import type { TerminalId } from "kolu-common/surface";
import {
  ACTIONS,
  type ActionContext,
  type ActionId,
  type AppAction,
  actionMatchesKeybind,
  isDispatchable,
  isOutsideFocusScope,
} from "./actions";
import { MODAL_SCOPE_SELECTOR } from "./keyboard";

interface MruCycleState {
  snapshot: TerminalId[];
  cursor: number;
}

export function useShortcuts(ctx: ActionContext) {
  let cycle: MruCycleState | null = null;

  function resetCycle() {
    cycle = null;
  }

  function advanceCycle(direction: 1 | -1) {
    if (cycle === null) {
      const live = ctx.mruOrder();
      const active = ctx.activeId();
      const snap =
        active && !live.includes(active) ? [active, ...live] : live.slice();
      if (snap.length < 2) return;
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
      const target = e.target as Element | null;
      if (target?.closest?.(MODAL_SCOPE_SELECTOR)) return;
      const handled = dispatch(e, ctx, advanceCycle);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true },
  );

  makeEventListener(window, "keyup", (e: KeyboardEvent) => {
    if (e.key === "Alt" || e.key === "Control") resetCycle();
  });
}

function dispatch(
  e: KeyboardEvent,
  ctx: ActionContext,
  advanceCycle: (direction: 1 | -1) => void,
): boolean {
  for (const [id, action] of Object.entries(ACTIONS) as [
    ActionId,
    AppAction,
  ][]) {
    if (!actionMatchesKeybind(action, e)) continue;

    if (isOutsideFocusScope(action, e)) return false;

    if (id === "cycleTerminalMru") {
      advanceCycle(e.shiftKey ? -1 : 1);
      return true;
    }

    if (isDispatchable(action)) {
      action.handler(ctx);
      return true;
    }
  }
  return false;
}
