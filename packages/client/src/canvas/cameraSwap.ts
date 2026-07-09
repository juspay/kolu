/** Switch-in center-on-active decision on host switch — the PURE core.
 *
 *  THE BUG (srid hit it live): switching the active host panned the canvas to an
 *  EMPTY region instead of the new host's active terminal. The canvas camera
 *  (pan/zoom) was APP-LIFETIME module state shared by every host, so on switch it
 *  stayed where the OLD host left it → the new host's tiles sat off-screen.
 *
 *  THE FIX is OWNERSHIP, not a swap seam: the camera is now PER-HOST-OWNED
 *  (`hostScope/createCamera`, born in each host's `scopedByEntry` owner and
 *  RETAINED across switch-away). A host's pose lives WITH the host, so switching
 *  to it shows its retained pose BY CONSTRUCTION — there is NO save/restore around
 *  the switch (no outgoing snapshot, no incoming restore), and so no seam to race
 *  the incoming tile's mount.
 *
 *  What this file owns is the one thing ownership does NOT settle: whether a
 *  switch-in still needs a center-on-active impulse. A retained pose is not always
 *  enough — a host's FIRST visit has no pose yet (the empty-region bug), and a
 *  pose can go STALE if the active tile moved while away. So {@link
 *  switchInNeedsCenter} decides: seed on the active tile when unpositioned
 *  (`savedCamera === null`), re-center when the active tile is not within the
 *  retained viewport, and no-op on a normal revisit that still shows it.
 *
 *  THE MOUNT RACE: the incoming host's tiles re-MOUNT a beat after the switch, so
 *  a center fired synchronously would pan to a not-yet-laid-out (empty) tile. The
 *  driver (`useCanvasCenterOnSwitch`, mounted from `TerminalCanvas`) DEFERS this
 *  decision until the active tile's layout is available — which is why the
 *  decision here is a pure function of (savedCamera, activeTile, viewport size):
 *  the driver feeds it those once the geometry has settled.
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
