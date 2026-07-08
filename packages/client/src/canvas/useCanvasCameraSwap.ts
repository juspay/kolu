/** Per-host camera swap + center-on-active on host switch — the reactive DRIVER.
 *
 *  Wires the pure core in `cameraSwap.ts` to the live viewport singleton, the
 *  per-host camera storage in `useViewState`, and the `activeHost` switch signal.
 *  See `cameraSwap.ts` for the (A)+(B) rationale and the mount-race argument.
 *
 *  Lives canvas-side (arrow points canvas → view state, like `useCanvasFocus`),
 *  mounted from `TerminalCanvas`, which feeds it the incoming host's active-tile
 *  layout so the (B) center decision can wait for that geometry to settle. */

import { encodeHostKey } from "kolu-common/hostKey";
import { createEffect, createSignal, on } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activeHost } from "../wire";
import type { TileLayout } from "./TileLayout";
import { switchInNeedsCenter } from "./cameraSwap";
import { useCanvasViewport } from "./viewport/useCanvasViewport";

/** A switch-in awaiting its center decision — held until the incoming host's
 *  active tile has a layout (the mount race). `firstVisit` records whether the
 *  incoming host had NO saved camera (so the decision is "seed", not a
 *  visibility check against a pose that was never restored). */
type PendingSwitchIn = { firstVisit: boolean };

export function useCanvasCameraSwap(
  /** The incoming host's active-tile layout — `undefined` until that tile has
   *  re-mounted and been measured. Reactive; the center decision waits on it. */
  activeTileLayout: () => TileLayout | undefined,
): void {
  const viewport = useCanvasViewport();
  const store = useTerminalStore();

  const [pending, setPending] = createSignal<PendingSwitchIn | null>(null);

  // (A) At the switch seam: snapshot the OUTGOING host's live camera into its
  // record, restore the INCOMING host's saved camera into the viewport signals.
  // Plain `on` (runs immediately); the `prev === undefined` guard skips the
  // initial mount — there is no switch to service yet.
  createEffect(
    on(activeHost, (curr, prev) => {
      if (prev === undefined) return;
      store.writeCamera(encodeHostKey(prev), viewport.snapshotCamera());
      const saved = store.readCamera(encodeHostKey(curr));
      if (saved) viewport.restoreCamera(saved);
      // (B) Queue the center decision — resolved below once the incoming tile's
      // geometry lands. `firstVisit` = the host had no pose to restore.
      setPending({ firstVisit: saved === null });
    }),
  );

  // (B) Center-on-active, DEFERRED past the mount race: fire only once the
  // incoming host's active tile has a layout, then decide against the RESTORED
  // live camera. `requestCenterActive` is a local viewport command (never a
  // wrong-host RPC); the layout-gated `focus.request` consumer in TerminalCanvas
  // does the actual pan, so by the time it runs the tile is laid out.
  createEffect(() => {
    const p = pending();
    if (!p) return;
    const activeTile = activeTileLayout();
    if (!activeTile) return; // mount race — wait for the tile to be measured
    const { width, height } = viewport.viewportSize();
    if (
      switchInNeedsCenter(
        p.firstVisit ? null : viewport.snapshotCamera(),
        activeTile,
        width,
        height,
      )
    )
      store.requestCenterActive();
    setPending(null); // consume once resolved
  });
}
