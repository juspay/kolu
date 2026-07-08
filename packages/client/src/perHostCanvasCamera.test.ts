/** Per-host canvas CAMERA + center-on-active on host switch — the acceptance
 *  suite for srid's live bug: switching the active host panned the canvas to an
 *  EMPTY region instead of the new host's active terminal.
 *
 *  ROOT CAUSE: the canvas camera (pan/zoom) was APP-LIFETIME module state while
 *  the tiles are PER-HOST (shape B). On switch the camera stayed where the OLD
 *  host left it, and nothing re-centered (a pure host switch never calls
 *  `activate`, the only path that fired the center impulse).
 *
 *  THE FIX (A)+(B): `HostView` gains a per-host `camera` snapshot saved/restored
 *  at the switch seam (A); on every switch-in the new host's active tile is
 *  ensured in view — seeded on first visit, re-centered when a saved pose went
 *  stale (B). The decision is the pure `switchInNeedsCenter`; the imperative half
 *  is a trivial viewport snapshot/restore. This suite composes those exactly as
 *  `useCanvasCameraSwap` does, DOM-free, and PINS the three switch-in cases:
 *    (1) first visit      → no saved camera → centered,
 *    (2) revisit visible  → saved camera restored + active tile visible → NO center,
 *    (3) revisit stale    → tile moved while away → re-centered.
 *
 *  RED before the fix: with an app-lifetime camera and no switch-in center, the
 *  camera stays on the OLD host's region and the new host's active tile is off
 *  screen — cases (1) and (3) fail. GREEN after. */

import type { HostKey } from "kolu-common/hostKey";
import { encodeHostKey } from "kolu-common/hostKey";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { isTileInViewport, switchInNeedsCenter } from "./canvas/cameraSwap";
import type { TileLayout } from "./canvas/TileLayout";
import { computeCenterPan } from "./canvas/viewport/transforms";
import type { Camera } from "./useViewState";

// `useViewState` reads `activeHost` (for its selection accessors) and reports the
// active terminal via `activePadiRpc` — neither is exercised by the camera
// methods (which are keyed EXPLICITLY), so a bare local stub is enough.
vi.mock("./wire", () => ({
  activePadiRpc: {
    surface: { chrome: { setActive: vi.fn(async () => {}) } },
  },
  activeHost: () => ({ kind: "local" }) as HostKey,
}));

// `canvasMaximized` pref — plain in-memory pair, no real localStorage.
vi.mock("./persistedPref", () => ({
  boolPref: () => {
    let v = false;
    return [
      () => v,
      (next: boolean | ((p: boolean) => boolean)) => {
        v =
          typeof next === "function"
            ? (next as (p: boolean) => boolean)(v)
            : next;
      },
    ];
  },
}));

vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

import { useViewState } from "./useViewState";

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

/** Drive one host switch exactly as `useCanvasCameraSwap` does, over a fake live
 *  camera: (A) snapshot the outgoing pose into its record + restore the incoming
 *  pose; (B) center the incoming active tile when `switchInNeedsCenter` says to.
 *  Returns whether a center fired, so case (2) can assert it did NOT. */
function switchHost(
  view: ReturnType<typeof useViewState>,
  live: { cam: Camera },
  from: HostKey,
  to: HostKey,
  incomingActiveTile: TileLayout | null,
): { centered: boolean } {
  // (A) snapshot outgoing, restore incoming.
  view.writeCamera(encodeHostKey(from), live.cam);
  const saved = view.readCamera(encodeHostKey(to));
  if (saved) live.cam = saved;
  // (B) center-on-active if first-visit or stale geometry.
  const centered = switchInNeedsCenter(
    saved,
    incomingActiveTile,
    VIEWPORT_W,
    VIEWPORT_H,
  );
  if (centered && incomingActiveTile)
    live.cam = centerOn(incomingActiveTile, live.cam.zoom);
  return { centered };
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
        const view = useViewState();
        // Start viewing A, camera centered on A's active tile.
        const live = { cam: centerOn(A_TILE, 1) };
        expect(isTileInViewport(A_TILE, live.cam, VIEWPORT_W, VIEWPORT_H)).toBe(
          true,
        );

        // Switch A → B (B never visited: no saved camera).
        const { centered } = switchHost(view, live, HOST_A, HOST_B, B_TILE);

        // Seeded on B's active tile — it is in view, not the old A region.
        expect(centered).toBe(true);
        expect(isTileInViewport(B_TILE, live.cam, VIEWPORT_W, VIEWPORT_H)).toBe(
          true,
        );
        expect(isTileInViewport(A_TILE, live.cam, VIEWPORT_W, VIEWPORT_H)).toBe(
          false,
        );
      } finally {
        dispose();
      }
    });
  });

  it("(2) REVISIT VISIBLE: switching back restores the saved pose and does NOT re-center", () => {
    createRoot((dispose) => {
      try {
        const view = useViewState();
        const live = { cam: centerOn(A_TILE, 1) };

        // A → B (seed B), then pan B slightly so the saved pose is user-authored
        // yet still shows B's active tile.
        switchHost(view, live, HOST_A, HOST_B, B_TILE);
        live.cam = { ...live.cam, panX: live.cam.panX + 40 };
        const bPose = { ...live.cam };
        expect(isTileInViewport(B_TILE, bPose, VIEWPORT_W, VIEWPORT_H)).toBe(
          true,
        );

        // B → A (A visible), then A → B: B's saved pose is restored verbatim.
        switchHost(view, live, HOST_B, HOST_A, A_TILE);
        const { centered } = switchHost(view, live, HOST_A, HOST_B, B_TILE);

        expect(centered).toBe(false); // valid saved pose showing the tile → no center
        expect(live.cam).toEqual(bPose); // restored verbatim (user pan preserved)
        expect(isTileInViewport(B_TILE, live.cam, VIEWPORT_W, VIEWPORT_H)).toBe(
          true,
        );
      } finally {
        dispose();
      }
    });
  });

  it("(3) REVISIT STALE: a saved pose whose active tile moved away is re-centered", () => {
    createRoot((dispose) => {
      try {
        const view = useViewState();
        const live = { cam: centerOn(A_TILE, 1) };

        // A → B (seed B on B_TILE), then B → A.
        switchHost(view, live, HOST_A, HOST_B, B_TILE);
        switchHost(view, live, HOST_B, HOST_A, A_TILE);

        // While away, B's active tile moved to a far region (layout changed).
        const B_TILE_MOVED: TileLayout = { x: 9000, y: 9000, w: 300, h: 200 };

        // A → B: the saved pose is restored but no longer shows the (moved) tile,
        // so the switch-in re-centers.
        const { centered } = switchHost(
          view,
          live,
          HOST_A,
          HOST_B,
          B_TILE_MOVED,
        );

        expect(centered).toBe(true);
        expect(
          isTileInViewport(B_TILE_MOVED, live.cam, VIEWPORT_W, VIEWPORT_H),
        ).toBe(true);
      } finally {
        dispose();
      }
    });
  });
});
