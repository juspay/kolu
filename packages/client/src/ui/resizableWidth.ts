/** A SIDEBAR'S WIDTH, set by dragging its edge — the bounds, the clamp, the cap
 *  that keeps room for what stands beside it, and the per-device memory.
 *
 *  One leaf, two callers: the Dock's maximized cards sidebar and the
 *  Conductor's works sidebar. Each names its own stored key and its own bounds;
 *  the rules are this file's alone. The gesture and the handle that drive it
 *  are `WidthResizeHandle.tsx`.
 *
 *  A leaf, not a component, so the pure clamp and cap are unit-testable
 *  without evaluating either caller's component graph. */

import type { Accessor } from "solid-js";
import { persistedPref } from "../persistedPref";

export interface WidthBounds {
  /** Where a fresh install lands, and the double-click-to-reset target. */
  readonly defaultPx: number;
  /** The floor: the narrowest the sidebar's lines stay legible at. */
  readonly minPx: number;
  /** The ceiling: the widest a drag may take it. */
  readonly maxPx: number;
  /** Room kept for what stands beside the sidebar. The ceiling alone is blind
   *  to the room the sidebar actually has: a stored-wide sidebar in a narrow
   *  host would squeeze its neighbour to nothing AND clip its own handle
   *  off-screen, leaving no way to drag or double-click it back. */
  readonly reservePx: number;
}

export interface ResizableWidth {
  readonly bounds: WidthBounds;
  /** The stored preference, clamped. */
  readonly stored: Accessor<number>;
  /** Clamp a candidate width into the bounds. The drag and the stored-value
   *  parse both route through it, so a hand-edited value cannot escape the
   *  range the handle enforces. */
  clamp(px: number): number;
  /** The width to RENDER at, given the width of the host the sidebar shares
   *  with its neighbour: the clamped preference, capped so at least
   *  `reservePx` stays for the neighbour — never below the floor (an extremely
   *  narrow host is its own degenerate case). An unmeasured host (`<= 0`, first
   *  paint) renders the clamped preference. The stored value is untouched, so
   *  the sidebar re-widens when the host grows again. */
  effective(preferred: number, hostWidth: number): number;
  /** Store a width, clamped; a no-op when it is already stored. The handle
   *  writes once per drag (persisting on every `pointermove` would be a
   *  synchronous `localStorage` write at 60-120×/s) and once per reset. */
  set(px: number): void;
}

export function resizableWidth(
  name: string,
  bounds: WidthBounds,
): ResizableWidth {
  const clamp = (px: number): number =>
    Math.min(bounds.maxPx, Math.max(bounds.minPx, px));
  // The serializer writes a canonical `JSON.stringify(number)`, so the parse
  // accepts ONLY a finite JSON number: a hand-edited `""`, `"abc"` or `"12px"`
  // throws rather than coercing to 0. A non-number falls back to the default
  // with a console diagnostic; a finite out-of-range number clamps.
  const [stored, setStored] = persistedPref<number>({
    name,
    fallback: bounds.defaultPx,
    parse: (raw) => {
      const n: unknown = JSON.parse(raw);
      if (typeof n !== "number" || !Number.isFinite(n)) {
        throw new Error(`invalid width: ${raw}`);
      }
      return clamp(n);
    },
    onInvalid: (err, raw) =>
      console.warn(
        `[${name}] ignoring invalid stored width ${JSON.stringify(raw)} — falling back to ${bounds.defaultPx}`,
        err,
      ),
  });
  return {
    bounds,
    stored,
    clamp,
    effective: (preferred, hostWidth) => {
      const clamped = clamp(preferred);
      if (!Number.isFinite(hostWidth) || hostWidth <= 0) return clamped;
      return Math.min(
        clamped,
        Math.max(bounds.minPx, hostWidth - bounds.reservePx),
      );
    },
    set: (px) => {
      const next = clamp(px);
      if (next === stored()) return;
      setStored(next);
    },
  };
}
