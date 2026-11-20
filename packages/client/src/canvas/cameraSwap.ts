import type { Camera } from "../useViewState";
import type { TileLayout } from "./TileLayout";

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
