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

import type { TerminalId } from "kolu-common/surface";
import { createEffect, createMemo } from "solid-js";
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

  // The switch counter is DERIVED from `activeHost`, not written from the
  // effect below: the resolver's compute reads it alongside `activeScope()` /
  // `store.activeId()` / the tile layout, all of which move on the same switch
  // write — so an epoch written in an effect's apply arm reached that compute
  // one pass LATE, re-running it for the switch it had already seen (a relay
  // tear). As a memo the epoch lands in the switch's own flush, so the switch
  // is resolved in one pass. The mount run is epoch 0, which `servedEpoch`
  // starts on: there is no switch to service yet.
  const switchEpoch = createMemo(
    (prev: number | undefined) => {
      activeHost();
      return prev === undefined ? 0 : prev + 1;
    },
    { name: "useCanvasCenterOnSwitch.switchEpoch" },
  );
  createEffect(
    activeHost,
    () => {
      // A switch invalidates any input still aimed at the host we are leaving: an
      // in-flight center/pan animation or a queued gesture flush writes pan/zoom
      // through `activeScope()`, which has just re-keyed to the NEW host — so a
      // frame-late callback would land the outgoing host's motion in the incoming
      // host's camera. Drop both up front so the switch cannot corrupt the retained
      // pose of the host switched to.
      viewport.abortTransientInput();
    },
    { name: "useCanvasCenterOnSwitch.abortTransientInput" },
  );
  let servedEpoch = 0;
  createEffect(
    (): {
      epoch: number;
      center: boolean;
      tileId: TerminalId | null;
    } | null => {
      const epoch = switchEpoch();
      if (epoch === servedEpoch || !viewport.mounted()) return null;
      const activeTile = activeTileLayout();
      if (!activeTile) return null; // mount race — wait for the tile to be measured
      // The tile the centering impulse NAMES is resolved here, in the compute:
      // `requestCenterActive` is an actor that takes the id, because the effect
      // phase is not a window to read reactive state in.
      const tileId = store.activeId();
      const camera = activeScope()?.camera;
      if (!camera) return { epoch, center: false, tileId };
      const { width, height } = viewport.viewportSize();
      return {
        epoch,
        tileId,
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
      if (verdict.center && verdict.tileId !== null)
        store.requestCenterActive(verdict.tileId);
    },
    { name: "useCanvasCenterOnSwitch.resolveSwitchCenter" },
  );
}
