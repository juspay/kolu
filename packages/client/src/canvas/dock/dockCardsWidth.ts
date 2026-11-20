import { persistedPref } from "../../persistedPref";
import { RAIL_WIDTH_PX } from "../../ui/chromeSpacing";
import type { ViewPostureMode } from "../useViewPosture";

export type DockMode = "rail" | "cards";

export const CARDS_WIDTH_PX = 288;

const DOCK_CARDS_MIN_WIDTH_PX = 200;
const DOCK_CARDS_MAX_WIDTH_PX = 560;

const DOCK_CARDS_MIN_CANVAS_PX = 320;

export function clampDockCardsWidth(px: number): number {
  return Math.min(
    DOCK_CARDS_MAX_WIDTH_PX,
    Math.max(DOCK_CARDS_MIN_WIDTH_PX, px),
  );
}

export type RenderedDockWidth = {
  px: number;
  resizable: boolean;
};

export function renderedDockWidth(surface: {
  mode: DockMode;
  layout: ViewPostureMode;
  preferredPx: number;
  hostWidthPx: number;
}): RenderedDockWidth {
  if (surface.mode === "rail") return { px: RAIL_WIDTH_PX, resizable: false };
  if (surface.layout !== "maximized")
    return { px: CARDS_WIDTH_PX, resizable: false };
  const clamped = clampDockCardsWidth(surface.preferredPx);
  if (!Number.isFinite(surface.hostWidthPx) || surface.hostWidthPx <= 0)
    return { px: clamped, resizable: true };
  const maxByHost = Math.max(
    DOCK_CARDS_MIN_WIDTH_PX,
    surface.hostWidthPx - DOCK_CARDS_MIN_CANVAS_PX,
  );
  return { px: Math.min(clamped, maxByHost), resizable: true };
}

const [dockCardsWidth, setDockCardsWidthRaw] = persistedPref<number>({
  name: "kolu-dock-cards-width",
  fallback: CARDS_WIDTH_PX,
  parse: (raw) => {
    const n: unknown = JSON.parse(raw);
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`invalid dock width: ${raw}`);
    }
    return clampDockCardsWidth(n);
  },
  onInvalid: (err, raw) =>
    console.warn(
      `[dockCardsWidth] ignoring invalid stored width ${JSON.stringify(raw)} — falling back to ${CARDS_WIDTH_PX}`,
      err,
    ),
});

export { dockCardsWidth };

export function setDockCardsWidth(px: number): void {
  const next = clampDockCardsWidth(px);
  if (next === dockCardsWidth()) return;
  setDockCardsWidthRaw(next);
}
