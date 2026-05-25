/** Panel surface chrome — `bg-surface-1` + edge border + rounded + drop shadow.
 *
 *  The canonical incantation behind every floating panel in the app:
 *  dialog content, popovers, the empty-state card, the disconnect overlay.
 *  Each call site previously inlined the same 6-utility string and drifted
 *  on per-site variations (radius tier, shadow weight) that this helper
 *  now names.
 *
 *  Variants:
 *    - `radius`: `"2xl"` (default) for modal dialogs and primary popovers,
 *      `"xl"` for compact dialogs (intent editor, find bar).
 *    - `shadow`: `"default"` (`shadow-black/50`, modal weight) or
 *      `"soft"` (`shadow-black/40`, popover/floating weight).
 *
 *  Pair with `surfaceStyle` whenever the surface lives inside a Corvu
 *  portal (`Dialog.Content`, popovers rendered via `solid-js/web` Portal).
 *  Firefox intermittently drops the `bg-surface-1` utility on portalled
 *  content; the inline background-color is a redundant fallback that
 *  guarantees the fill, and the duplication is the workaround. */

import type { JSX } from "solid-js";

const RADIUS_CLASS = {
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
} as const;

const SHADOW_CLASS = {
  soft: "shadow-2xl shadow-black/40",
  default: "shadow-2xl shadow-black/50",
} as const;

export type SurfaceRadius = keyof typeof RADIUS_CLASS;
export type SurfaceShadow = keyof typeof SHADOW_CLASS;

export function surfaceClass(opts?: {
  radius?: SurfaceRadius;
  shadow?: SurfaceShadow;
}): string {
  const radius = RADIUS_CLASS[opts?.radius ?? "2xl"];
  const shadow = SHADOW_CLASS[opts?.shadow ?? "default"];
  return `bg-surface-1 border border-edge ${radius} ${shadow}`;
}

export const surfaceStyle: JSX.CSSProperties = {
  "background-color": "var(--color-surface-1)",
};
