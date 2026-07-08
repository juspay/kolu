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
 *  the canvas only re-centers when the active tile has drifted out of view.
 *
 *  `ctx.isActive` is the owner's "am I the shown host" accessor — the canvas
 *  reads the ACTIVE host's camera through `hostScopes.active()`, so the
 *  active-only discipline is intrinsic; the accessor is exposed here for a future
 *  camera-local hook (it is deliberately not used to gate GL, which is already
 *  active-host-only by tile mount/unmount in `Terminal.tsx`). */

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
   *  stale)". */
  positioned: Accessor<boolean>;
  markPositioned: () => void;
  /** Whether this host is the one currently shown (owner's `isActive`). */
  isActive: Accessor<boolean>;
}

export function createCamera(ctx: { isActive: Accessor<boolean> }): HostCamera {
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [positioned, setPositioned] = createSignal(false);

  return {
    panX,
    panY,
    zoom,
    setPanX,
    setPanY,
    setZoom,
    snapshot: () => ({ panX: panX(), panY: panY(), zoom: zoom() }),
    positioned,
    markPositioned: () => setPositioned(true),
    isActive: ctx.isActive,
  };
}
