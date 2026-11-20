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

const A_TILE: TileLayout = { x: 0, y: 0, w: 300, h: 200 };
const B_TILE: TileLayout = { x: 5000, y: 5000, w: 300, h: 200 };

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

function makeCameras() {
  const cameras = new Map<string, HostCamera>();
  return (host: HostKey): HostCamera => {
    const k = encodeHostKey(host);
    let c = cameras.get(k);
    if (!c) {
      c = createCamera();
      cameras.set(k, c);
    }
    return c;
  };
}

function center(cam: HostCamera, tile: TileLayout): void {
  const c = centerOn(tile, cam.zoom());
  cam.setPanX(c.panX);
  cam.setPanY(c.panY);
  cam.setZoom(c.zoom);
}

function switchHost(
  camFor: (host: HostKey) => HostCamera,
  to: HostKey,
  incomingActiveTile: TileLayout | null,
): { centered: boolean; cam: HostCamera } {
  const cam = camFor(to);
  const savedPose = cam.positioned() ? cam.snapshot() : null;
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
    expect(switchInNeedsCenter(null, B_TILE, VIEWPORT_W, VIEWPORT_H)).toBe(
      true,
    );
    const onB = centerOn(B_TILE, 1);
    expect(switchInNeedsCenter(onB, B_TILE, VIEWPORT_W, VIEWPORT_H)).toBe(
      false,
    );
    expect(switchInNeedsCenter(onB, A_TILE, VIEWPORT_W, VIEWPORT_H)).toBe(true);
    expect(switchInNeedsCenter(onB, null, VIEWPORT_W, VIEWPORT_H)).toBe(false);
  });
});

describe("per-host canvas camera on host switch", () => {
  it("(1) FIRST VISIT: switching to a never-seen host centers on its active tile (no empty region)", () => {
    createRoot((dispose) => {
      try {
        const camFor = makeCameras();
        center(camFor(HOST_A), A_TILE);
        expect(
          isTileInViewport(
            A_TILE,
            camFor(HOST_A).snapshot(),
            VIEWPORT_W,
            VIEWPORT_H,
          ),
        ).toBe(true);

        const { centered, cam } = switchHost(camFor, HOST_B, B_TILE);

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

        switchHost(camFor, HOST_B, B_TILE);
        const camB = camFor(HOST_B);
        camB.setPanX(camB.panX() + 40);
        const bPose = camB.snapshot();
        expect(isTileInViewport(B_TILE, bPose, VIEWPORT_W, VIEWPORT_H)).toBe(
          true,
        );

        switchHost(camFor, HOST_A, A_TILE);
        const { centered, cam } = switchHost(camFor, HOST_B, B_TILE);

        expect(centered).toBe(false);
        expect(cam.snapshot()).toEqual(bPose);
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

        switchHost(camFor, HOST_B, B_TILE);
        switchHost(camFor, HOST_A, A_TILE);

        const B_TILE_MOVED: TileLayout = { x: 9000, y: 9000, w: 300, h: 200 };

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
