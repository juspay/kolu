/** Per-host canvas CAMERA + center-on-active on host switch — the acceptance
 *  suite for srid's live bug: switching the active host panned the canvas to an
 *  EMPTY region instead of the new host's active terminal.
 *
 *  ROOT CAUSE: the canvas camera (pan/zoom) was APP-LIFETIME module state while
 *  the tiles are PER-HOST (shape B). On switch the camera stayed where the OLD
 *  host left it, and the swap seam that bridged it to per-host storage raced the
 *  incoming tile's mount — a defer-guard could narrow but never close it.
 *
 *  THE W7 FIX — OWNERSHIP: the camera is now PER-HOST (`hostScope/createCamera`),
 *  born in the host's `scopedByEntry` owner and RETAINED across switch-away. There
 *  is no snapshot/restore swap: switching shows the host's saved pose by
 *  construction. What remains is the switch-in center DECISION (the pure
 *  `switchInNeedsCenter`): seed a never-positioned host on its active tile, keep a
 *  valid pose, re-center a pose whose active tile drifted out of view. This suite
 *  composes `createCamera` + `switchInNeedsCenter` exactly as `TerminalCanvas`'s
 *  switch-in effect does, DOM-free, and PINS the three switch-in cases:
 *    (1) first visit      → unpositioned camera → centered,
 *    (2) revisit visible  → retained pose + active tile visible → NO center,
 *    (3) revisit stale    → tile moved while away → re-centered.
 *
 *  (Behaviorally adapted from the pre-W7 suite, which pinned the swap MECHANISM
 *  W7 deletes: `useViewState.writeCamera`/`readCamera` → the per-host
 *  `createCamera` retained pose; `switchHost`'s (A) snapshot/restore → GONE (the
 *  pose is retained); (B) center-on-active → unchanged. The three `it(...)` names
 *  and their assertions map 1:1 — see the commit message for the old→new map.
 *  RED before ownership: an app-lifetime camera left the new host's active tile
 *  off screen — cases (1) and (3) failed. GREEN after.) */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { isTileInViewport, switchInNeedsCenter } from "./canvas/cameraSwap";
import type { TileLayout } from "./canvas/TileLayout";
import { computeCenterPan } from "./canvas/viewport/transforms";
import { createCamera, type HostCamera } from "./hostScope/createCamera";
import type { Camera } from "./useViewState";

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

const VIEWPORT_W = 800;
const VIEWPORT_H = 600;

/** Two hosts whose active tiles sit in DIFFERENT canvas regions — a switch that
 *  merely restored the outgoing camera would leave the incoming tile off screen. */
const A_TILE: TileLayout = { x: 0, y: 0, w: 300, h: 200 };
const B_TILE: TileLayout = { x: 5000, y: 5000, w: 300, h: 200 };

/** What `viewport.centerOnTile` computes — the pan that centers a tile, zoom held. */
function centerOn(tile: TileLayout, zoom: number): Camera {
  const { panX, panY } = computeCenterPan(
    tile.x,
    tile.y,
    tile.x + tile.w,
    tile.y + tile.h,
    VIEWPORT_W,
    VIEWPORT_H,
    zoom,
  );
  return { panX, panY, zoom };
}

/** The per-host cameras (the W7 ownership model — one retained `createCamera` per
 *  host, keyed by the canonical host string). `camFor` lazily builds a host's
 *  camera (its `scopedByEntry` owner) on first activation and RETAINS it. */
function makeCameras() {
  const cameras = new Map<string, HostCamera>();
  return (host: HostKey): HostCamera => {
    const k = encodeHostKey(host);
    let c = cameras.get(k);
    if (!c) {
      c = createCamera({ isActive: () => true });
      cameras.set(k, c);
    }
    return c;
  };
}

/** Center a host's camera on a tile — the imperative half of the switch-in, as
 *  `viewport.centerOnTile` → `setPan*`/`setZoom` do (every write marks the camera
 *  `positioned`). */
function center(cam: HostCamera, tile: TileLayout): void {
  const c = centerOn(tile, cam.zoom());
  cam.setPanX(c.panX);
  cam.setPanY(c.panY);
  cam.setZoom(c.zoom);
  cam.markPositioned();
}

/** Drive one host switch under per-host camera OWNERSHIP: the active camera is
 *  the incoming host's own (RETAINED pose — no snapshot/restore). Then the
 *  switch-in center DECISION: a never-positioned host seeds (firstVisit → null),
 *  a positioned host keeps its pose unless the active tile drifted out of view.
 *  Returns whether a center fired, so case (2) can assert it did NOT. */
function switchHost(
  camFor: (host: HostKey) => HostCamera,
  to: HostKey,
  incomingActiveTile: TileLayout | null,
): { centered: boolean; cam: HostCamera } {
  const cam = camFor(to);
  const savedPose = cam.positioned() ? cam.snapshot() : null; // firstVisit → null
  const centered = switchInNeedsCenter(
    savedPose,
    incomingActiveTile,
    VIEWPORT_W,
    VIEWPORT_H,
  );
  if (centered && incomingActiveTile) center(cam, incomingActiveTile);
  return { centered, cam };
}

describe("cameraSwap pure core", () => {
  it("isTileInViewport: a tile centered under the camera is in view, a far tile is not", () => {
    const cam = centerOn(A_TILE, 1);
    expect(isTileInViewport(A_TILE, cam, VIEWPORT_W, VIEWPORT_H)).toBe(true);
    expect(isTileInViewport(B_TILE, cam, VIEWPORT_W, VIEWPORT_H)).toBe(false);
  });

  it("switchInNeedsCenter: seed on first visit, re-center only when the tile is out of view", () => {
    // First visit — no saved pose → always center (seed).
    expect(switchInNeedsCenter(null, B_TILE, VIEWPORT_W, VIEWPORT_H)).toBe(
      true,
    );
    // Saved pose already shows the tile → no center.
    const onB = centerOn(B_TILE, 1);
    expect(switchInNeedsCenter(onB, B_TILE, VIEWPORT_W, VIEWPORT_H)).toBe(
      false,
    );
    // Saved pose stale (tile elsewhere) → re-center.
    expect(switchInNeedsCenter(onB, A_TILE, VIEWPORT_W, VIEWPORT_H)).toBe(true);
    // No active tile → nothing to center on.
    expect(switchInNeedsCenter(onB, null, VIEWPORT_W, VIEWPORT_H)).toBe(false);
  });
});

describe("per-host canvas camera on host switch", () => {
  it("(1) FIRST VISIT: switching to a never-seen host centers on its active tile (no empty region)", () => {
    createRoot((dispose) => {
      try {
        const camFor = makeCameras();
        // Start viewing A, camera centered on A's active tile.
        center(camFor(HOST_A), A_TILE);
        expect(
          isTileInViewport(
            A_TILE,
            camFor(HOST_A).snapshot(),
            VIEWPORT_W,
            VIEWPORT_H,
          ),
        ).toBe(true);

        // Switch A → B (B never visited: its camera is unpositioned).
        const { centered, cam } = switchHost(camFor, HOST_B, B_TILE);

        // Seeded on B's active tile — it is in view, not the old A region.
        expect(centered).toBe(true);
        expect(
          isTileInViewport(B_TILE, cam.snapshot(), VIEWPORT_W, VIEWPORT_H),
        ).toBe(true);
        expect(
          isTileInViewport(A_TILE, cam.snapshot(), VIEWPORT_W, VIEWPORT_H),
        ).toBe(false);
      } finally {
        dispose();
      }
    });
  });

  it("(2) REVISIT VISIBLE: switching back restores the saved pose and does NOT re-center", () => {
    createRoot((dispose) => {
      try {
        const camFor = makeCameras();
        center(camFor(HOST_A), A_TILE);

        // A → B (seed B), then pan B slightly so the saved pose is user-authored
        // yet still shows B's active tile.
        switchHost(camFor, HOST_B, B_TILE);
        const camB = camFor(HOST_B);
        camB.setPanX(camB.panX() + 40);
        const bPose = camB.snapshot();
        expect(isTileInViewport(B_TILE, bPose, VIEWPORT_W, VIEWPORT_H)).toBe(
          true,
        );

        // B → A (A visible), then A → B: B's camera is RETAINED — its pose is
        // still bPose, so the switch-in keeps it (no re-center).
        switchHost(camFor, HOST_A, A_TILE);
        const { centered, cam } = switchHost(camFor, HOST_B, B_TILE);

        expect(centered).toBe(false); // valid retained pose showing the tile → no center
        expect(cam.snapshot()).toEqual(bPose); // retained verbatim (user pan preserved)
        expect(
          isTileInViewport(B_TILE, cam.snapshot(), VIEWPORT_W, VIEWPORT_H),
        ).toBe(true);
      } finally {
        dispose();
      }
    });
  });

  it("(3) REVISIT STALE: a saved pose whose active tile moved away is re-centered", () => {
    createRoot((dispose) => {
      try {
        const camFor = makeCameras();
        center(camFor(HOST_A), A_TILE);

        // A → B (seed B on B_TILE), then B → A.
        switchHost(camFor, HOST_B, B_TILE);
        switchHost(camFor, HOST_A, A_TILE);

        // While away, B's active tile moved to a far region (layout changed).
        const B_TILE_MOVED: TileLayout = { x: 9000, y: 9000, w: 300, h: 200 };

        // A → B: the retained pose no longer shows the (moved) tile, so the
        // switch-in re-centers.
        const { centered, cam } = switchHost(camFor, HOST_B, B_TILE_MOVED);

        expect(centered).toBe(true);
        expect(
          isTileInViewport(
            B_TILE_MOVED,
            cam.snapshot(),
            VIEWPORT_W,
            VIEWPORT_H,
          ),
        ).toBe(true);
      } finally {
        dispose();
      }
    });
  });
});
