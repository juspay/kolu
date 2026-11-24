/** `useCanvasCenterOnSwitch` — the switch-in center-on-active DECISION, the
 *  surviving (B) half of the deleted `useCanvasCameraSwap` hook, mounted from
 *  `TerminalCanvas` alongside its sibling hooks (`useCanvasFocus`,
 *  `usePendingLayouts`, `useTileAura`).
 *
 *  The camera pose is now per-host and RETAINED in `hostScopes.active().camera`,
 *  so a switch shows that host's saved pose BY CONSTRUCTION — there is no
 *  snapshot/restore step to race the incoming tile's mount (the class the deleted
 *  swap bridge could never close). What remains is the switch-in center decision,
 *  deferred past the mount race: once the incoming host's active tile has a
 *  measured layout, seed a never-positioned host on it (firstVisit) or re-center a
 *  host whose active tile drifted out of its retained view (stale) — the pure
 *  `switchInNeedsCenter` core and the layout-gated `focus.request` pan unchanged.
 *
 *  The one input is `activeTileLayout` — the active tile's resolved layout over
 *  the canvas's pending-layout overrides, which only the canvas can derive. The
 *  viewport / terminal store / active-host signal are read from their singletons /
 *  modules exactly as the inlined block did. */

import { createEffect, createSignal } from "solid-js";
import { activeScope } from "../hostScope/hostScopes";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activeHost } from "../wire";
import { switchInNeedsCenter } from "./cameraSwap";
import type { TileLayout } from "./TileLayout";
import { useCanvasViewport } from "./viewport/useCanvasViewport";

export function useCanvasCenterOnSwitch(
  activeTileLayout: () => TileLayout | undefined,
): void {
  const viewport = useCanvasViewport();
  const store = useTerminalStore();

  // Monotonic switch counter, not a boolean "pending" flag: the resolver below
  // records the switch it SERVED in a plain variable, so it never writes a
  // signal its own compute reads (which would make the flush settle twice).
  const [switchEpoch, setSwitchEpoch] = createSignal(0);
  createEffect(activeHost, (_curr, prev) => {
    // A switch invalidates any input still aimed at the host we are leaving: an
    // in-flight center/pan animation or a queued gesture flush writes pan/zoom
    // through `activeScope()`, which has just re-keyed to the NEW host — so a
    // frame-late callback would land the outgoing host's motion in the incoming
    // host's camera. Drop both up front so the switch cannot corrupt the retained
    // pose of the host switched to.
    viewport.abortTransientInput();
    if (prev === undefined) return; // initial mount — no switch to service yet
    setSwitchEpoch((n) => n + 1);
  });
  let servedEpoch = 0;
  createEffect(
    (): { epoch: number; center: boolean } | null => {
      const epoch = switchEpoch();
      if (epoch === servedEpoch || !viewport.mounted()) return null;
      const activeTile = activeTileLayout();
      if (!activeTile) return null; // mount race — wait for the tile to be measured
      const camera = activeScope()?.camera;
      if (!camera) return { epoch, center: false };
      const { width, height } = viewport.viewportSize();
      return {
        epoch,
        center: switchInNeedsCenter(
          camera.positioned() ? camera.snapshot() : null,
          activeTile,
          width,
          height,
        ),
      };
    },
    (verdict) => {
      if (!verdict) return;
      servedEpoch = verdict.epoch; // consume once resolved
      if (verdict.center) store.requestCenterActive();
    },
  );
}
