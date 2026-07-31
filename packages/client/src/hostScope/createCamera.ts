/** `createCamera` — ONE host's canvas camera STATE, born inside its
 *  `scopedByEntry` owner and retained across switch-away.
 *
 *  This is the pan/zoom the viewport machinery reads and writes for the ACTIVE
 *  host (`canvas/viewport/useCanvasViewport.ts` redirects every read/write onto
 *  `hostScopes.active().camera`). It USED to be three module-scope signals shared
 *  by every host and bridged to per-host storage by a `on(activeHost)` swap
 *  effect (`useCanvasCameraSwap`, now deleted) — the bridge between two
 *  independently-timed lifecycles the W7 post-mortem showed a defer-guard can
 *  never close. Owned per host, there is no bridge: a host's pose lives WITH the
 *  host, so switching to it restores its pose by construction — the "pans to
 *  empty" symptom cannot arise.
 *
 *  `positioned` records whether this host's camera has been placed yet (a user
 *  pan, a first-visit seed, or a re-center). It is the successor to the old
 *  `firstVisit = savedCamera === null` signal: a brand-new owner starts
 *  `positioned === false`, so the canvas seeds it on the active tile the first
 *  time that tile is measured; thereafter the retained pose is authoritative and
 *  the canvas only re-centers when the active tile has drifted out of view. */

import { type Accessor, createSignal } from "solid-js";
import type { Camera } from "../useViewState";

export interface HostCamera {
  panX: Accessor<number>;
  panY: Accessor<number>;
  zoom: Accessor<number>;
  setPanX: (v: number) => void;
  setPanY: (v: number) => void;
  setZoom: (v: number) => void;
  /** Read the pose as a plain value (pan + zoom). */
  snapshot: () => Camera;
  /** Has this host's camera been placed yet? `false` until the first seed /
   *  user-move — the signal the canvas's switch-in center decision uses to pick
   *  "seed on the active tile" vs. "keep the retained pose (re-center only if
   *  stale)". Marked by the pose setters themselves (see `setPanX`/`setPanY`/
   *  `setZoom`), so a pose can never be written without the camera becoming
   *  positioned. */
  positioned: Accessor<boolean>;

  // ── Focus: the camera held on one tile (what "maximize" became) ──
  //
  // Focusing is a camera move, not a mode — no second layout, no covered
  // tiles, no persisted posture flag. It lives HERE, beside the pose, because
  // it is per-host state for exactly the same reason the pose is: switching
  // hosts must show that host's own camera, focused or not, with no restore
  // step to race the incoming tiles.

  /** The tile the camera is currently held on, or null when free. */
  focusedTileId: Accessor<string | null>;
  /** Hold focus on a tile. `restore` is the pose to fly back to, remembered
   *  only on the FIRST entry — hopping focus from tile to tile keeps the
   *  original escape hatch, so leaving focus returns to the fleet view you
   *  started from rather than to the previously focused tile. */
  focusTile: (id: string, restore: Camera) => void;
  /** Release focus. The remembered pose survives until `takeRestorePose`. */
  releaseFocus: () => void;
  /** Read-and-clear the pose to fly back to; null when there is none. */
  takeRestorePose: () => Camera | null;
}

export function createCamera(): HostCamera {
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [positioned, setPositioned] = createSignal(false);
  const [focusedTileId, setFocusedTileId] = createSignal<string | null>(null);
  // Deliberately NOT written through the pose setters above: remembering where
  // to fly back to is not itself a camera placement, so it must not mark the
  // host `positioned`.
  const [restorePose, setRestorePose] = createSignal<Camera | null>(null);

  // Writing a pose IS the fact "this camera has now been placed", so every
  // setter marks `positioned` — the invariant is folded into the atomic verb
  // and cannot be un-paired by a future writer that forgets a separate call.
  // Setting `positioned` (or a pan/zoom) to a value it already holds is an
  // Object.is no-op, so the per-frame gesture flush never re-notifies.
  return {
    panX,
    panY,
    zoom,
    setPanX: (v: number) => {
      setPanX(v);
      setPositioned(true);
    },
    setPanY: (v: number) => {
      setPanY(v);
      setPositioned(true);
    },
    setZoom: (v: number) => {
      setZoom(v);
      setPositioned(true);
    },
    snapshot: () => ({ panX: panX(), panY: panY(), zoom: zoom() }),
    positioned,
    focusedTileId,
    focusTile: (id: string, restore: Camera) => {
      if (restorePose() === null) setRestorePose(restore);
      setFocusedTileId(id);
    },
    releaseFocus: () => setFocusedTileId(null),
    takeRestorePose: () => {
      const pose = restorePose();
      if (pose !== null) setRestorePose(null);
      return pose;
    },
  };
}
