import { supportsSpatialCanvas } from "../capabilities";
import {
  exitConductorMode,
  conductorMode,
} from "../conductor/useConductorMode";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";

export type ViewPostureMode = "tiled" | "maximized";

export const posturedActionLabel = (mode: ViewPostureMode): string =>
  mode === "maximized" ? "Restore canvas" : "Maximize terminal";

export function useViewPosture() {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const canMaximize = (): boolean => tileStore.tileCount() > 0;
  const postureTo = (maximized: boolean): void => {
    if (conductorMode()) exitConductorMode();
    if (!supportsSpatialCanvas()) return;
    if (canMaximize() && store.canvasMaximized() !== maximized) {
      store.toggleCanvasMaximized();
    }
  };
  return {
    layout: (): ViewPostureMode =>
      store.canvasMaximized() && canMaximize() ? "maximized" : "tiled",
    canMaximize,
    postureTo,
    toggle: (): void => postureTo(!store.canvasMaximized()),
  } as const;
}
