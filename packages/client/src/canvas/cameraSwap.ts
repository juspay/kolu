/** Per-host camera swap + center-on-active on host switch — the PURE core.
 *
 *  THE BUG (srid hit it live): switching the active host panned the canvas to an
 *  EMPTY region instead of the new host's active terminal. The canvas camera
 *  (pan/zoom) was APP-LIFETIME module state (three `createSignal`s in
 *  `viewport/useCanvasViewport.ts`) while the tiles are PER-HOST (shape B —
 *  `useViewState.ts`, each host's `HostView` swapped on switch). So on switch the
 *  camera stayed where the OLD host left it → the new host's tiles sat off-screen.
 *  And nothing re-centered: only `activate(id)` fires the center impulse, but a
 *  pure host SWITCH never calls it (deliberately — `writeActive` fires no
 *  wrong-host side effects).
 *
 *  THE FIX is (A)+(B) COMPOSED (coordinator-ratified):
 *
 *  (A) PER-HOST CAMERA. `HostView` gains a `camera` snapshot. At the switch seam
 *      the driver SNAPSHOTS the outgoing host's live camera into its record and
 *      RESTORES the incoming host's saved camera into the viewport signals. This
 *      is a COARSE save/restore AROUND the switch — a per-host swap, NOT a
 *      per-event hook — so the #1308 rAF write-coalescing in `useCanvasViewport`
 *      is untouched (`restoreCamera` is one authoritative absolute write, exactly
 *      like `setPan`).
 *
 *  (B) CENTER-ON-ACTIVE ON SWITCH-IN. A restored camera alone is not enough: a
 *      host's FIRST visit has no saved camera to restore (the empty region bug),
 *      and a saved camera can go STALE if the active tile moved while away. So on
 *      every switch-in the driver ensures the new host's active tile is in view —
 *      it fires the center impulse when {@link switchInNeedsCenter} says to:
 *      first visit (seed) OR the active tile is not within the restored viewport
 *      (re-center). A normal revisit with a valid saved camera showing the active
 *      tile needs no center.
 *
 *  THE MOUNT RACE: the incoming host's tiles re-MOUNT a beat after the switch, so
 *  a center fired synchronously would pan to a not-yet-laid-out (empty) tile. The
 *  reactive driver DEFERS the (B) decision until the active tile's layout is
 *  available (mirroring the split-collapse fix that waited for the tile record) —
 *  which is why the decision here is a pure function of (savedCamera, activeTile,
 *  viewport size): the driver feeds it those once the geometry has settled.
 *
 *  Everything here is PURE (values in, values out — no signals, no DOM), so the
 *  three switch-in cases are unit-testable without a browser. */

import type { Camera } from "../useViewState";
import type { TileLayout } from "./TileLayout";

/** The viewport rect in CANVAS-space for a camera + pixel viewport size. This is
 *  the inverse projection `viewport/transforms.ts` uses: a screen of `w×h`
 *  pixels at `zoom` covers `w/zoom × h/zoom` canvas units, anchored at the pan
 *  origin. */
export function viewportRect(
  cam: Camera,
  viewportW: number,
  viewportH: number,
): TileLayout {
  return {
    x: cam.panX,
    y: cam.panY,
    w: viewportW / cam.zoom,
    h: viewportH / cam.zoom,
  };
}

/** Whether a tile is "in view" under a camera — its CENTER point falls inside the
 *  viewport rect. Center-point (not full containment) is the deliberate test:
 *  full containment would re-center on a normal revisit where the user had merely
 *  panned a little (the tile partly clipped but plainly visible), whereas a truly
 *  STALE camera (the tile moved far while away) puts the center well outside. */
export function isTileInViewport(
  tile: TileLayout,
  cam: Camera,
  viewportW: number,
  viewportH: number,
): boolean {
  const r = viewportRect(cam, viewportW, viewportH);
  const cx = tile.x + tile.w / 2;
  const cy = tile.y + tile.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

/** The (B) decision: does switching IN to a host need a center-on-active impulse?
 *
 *  - `savedCamera === null` → FIRST VISIT: there is no pose to restore, so seed
 *    the camera on the active tile (this is the "pans to empty" bug's fix).
 *  - `activeTile === null` → nothing to center on (host has no active tile) → no.
 *  - otherwise → re-center only when the active tile is NOT within the restored
 *    viewport (STALE geometry); a revisit that still shows the active tile is a
 *    no-op.
 *
 *  Pass the RESTORED camera (the one now in the viewport) as `savedCamera` when a
 *  pose was restored; the visibility check is against that same pose. */
export function switchInNeedsCenter(
  savedCamera: Camera | null,
  activeTile: TileLayout | null,
  viewportW: number,
  viewportH: number,
): boolean {
  if (savedCamera === null) return true;
  if (activeTile === null) return false;
  return !isTileInViewport(activeTile, savedCamera, viewportW, viewportH);
}
