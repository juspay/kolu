import { GRID_SIZE } from "./transforms";

export function canvasTransformCSS(
  panX: number,
  panY: number,
  zoom: number,
): string {
  return `scale(${zoom}) translate(${-panX}px, ${-panY}px)`;
}

export function tileTransformCSS(
  layoutCanvasX: number,
  layoutCanvasY: number,
  panCanvasX: number,
  panCanvasY: number,
  zoom: number,
  dragScreenX: number,
  dragScreenY: number,
): string {
  const tx = layoutCanvasX * (zoom - 1) - panCanvasX * zoom + dragScreenX;
  const ty = layoutCanvasY * (zoom - 1) - panCanvasY * zoom + dragScreenY;
  return `translate(${tx}px, ${ty}px) scale(${zoom})`;
}

export function gridBgPositionCSS(
  panX: number,
  panY: number,
  zoom: number,
): string {
  return `${-panX * zoom}px ${-panY * zoom}px`;
}

export function gridBgSizeCSS(zoom: number): string {
  const s = GRID_SIZE * zoom;
  return `${s}px ${s}px`;
}
