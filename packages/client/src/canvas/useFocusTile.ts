/** "Focus the tile I'm looking at" — the single verb the chrome, the command
 *  palette and the keyboard all reach for, and the successor to the deleted
 *  `useViewPosture.toggle`.
 *
 *  It carries the same two guards that hook carried, in the receptacle rather
 *  than in each caller: it is a no-op without a spatial canvas (any non-desktop
 *  layout, where there is no camera to move) and a no-op with no active tile.
 *  Callers therefore never have to remember either rule — the safety lives
 *  where the verb lives. */

import { supportsSpatialCanvas } from "../capabilities";
import { useTileStore } from "../tile/useTileStore";
import { useCanvasViewport } from "./viewport/useCanvasViewport";

export function useFocusTile() {
  const tileStore = useTileStore();
  const viewport = useCanvasViewport();

  /** Is focusing meaningful right now — is there a tile to hold the camera
   *  on? Readers (the chrome button, the palette entry) gate their affordance
   *  on this so it never disagrees with what `toggle` would do. */
  const canFocus = (): boolean =>
    supportsSpatialCanvas() && tileStore.activeId() !== null;

  return {
    canFocus,
    /** True while the camera is held on the active tile. */
    isFocused: (): boolean => {
      const active = tileStore.activeId();
      return active !== null && viewport.focusedTileId() === active;
    },
    /** Hold the camera on the active tile, or release it if it already is. */
    toggle: (): void => {
      if (!canFocus()) return;
      const active = tileStore.activeId();
      if (active === null) return;
      if (viewport.focusedTileId() === active) viewport.releaseFocus();
      else viewport.focusTile(active);
    },
  } as const;
}
