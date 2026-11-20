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
      viewport.abortTransientInput();
      if (prev === undefined) return;
      setPendingCenter(true);
    }),
  );
  createEffect(() => {
    if (!pendingCenter() || !viewport.mounted()) return;
    const activeTile = activeTileLayout();
    if (!activeTile) return;
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
    setPendingCenter(false);
  });
}
