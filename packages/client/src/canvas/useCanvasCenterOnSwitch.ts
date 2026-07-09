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

import { createEffect, createSignal, on } from "solid-js";
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

  const [pendingCenter, setPendingCenter] = createSignal(false);
  createEffect(
    on(activeHost, (_curr, prev) => {
      if (prev === undefined) return; // initial mount — no switch to service yet
      setPendingCenter(true);
    }),
  );
  createEffect(() => {
    if (!pendingCenter()) return;
    const activeTile = activeTileLayout();
    if (!activeTile) return; // mount race — wait for the tile to be measured
    const camera = activeScope()?.camera;
    if (!camera) {
      setPendingCenter(false);
      return;
    }
    const { width, height } = viewport.viewportSize();
    if (
      switchInNeedsCenter(
        camera.positioned() ? camera.snapshot() : null,
        activeTile,
        width,
        height,
      )
    )
      store.requestCenterActive();
    setPendingCenter(false); // consume once resolved
  });
}
