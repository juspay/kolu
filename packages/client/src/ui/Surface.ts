/** Panel surface chrome — `bg-surface-1` + edge border + rounded + drop shadow.
 *
 *  The canonical incantation behind every floating panel in the app:
 *  dialog content, popovers, the empty-state card, the disconnect overlay.
 *  Each call site previously inlined the same six-utility string and drifted
 *  on per-site variations (radius tier, shadow weight) that this helper
 *  now names.
 *
 *  Variants:
 *    - `radius`: `"2xl"` (default) for modal dialogs and primary popovers,
 *      `"xl"` for compact dialogs (find bar), `"lg"`/`"md"`
 *      for menu surfaces (anchored option lists, context menus).
 *    - `shadow`: `"default"` (`shadow-black/50`, modal weight),
 *      `"soft"` (`shadow-black/40`, popover/floating weight),
 *      `"light"` (`shadow-lg shadow-black/40`, menu weight), or
 *      `"bare"` (`shadow-lg`, no color tint — for context menus).
 *
 *  Pass `portalled: true` whenever the panel renders inside a Corvu portal
 *  (`Dialog.Content`) or a SolidJS `Portal`. The returned `style` then
 *  carries an inline `background-color` fallback — Firefox intermittently
 *  drops the `bg-surface-1` utility on portalled content, and the inline
 *  duplication is the workaround. Non-portal callers receive an empty
 *  `style` object; spreading it is a no-op. */

import type { JSX } from "solid-js";

const RADIUS_CLASS = {
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
} as const;

const SHADOW_CLASS = {
  bare: "shadow-lg",
  light: "shadow-lg shadow-black/40",
  soft: "shadow-2xl shadow-black/40",
  default: "shadow-2xl shadow-black/50",
} as const;

export type SurfaceRadius = keyof typeof RADIUS_CLASS;
export type SurfaceShadow = keyof typeof SHADOW_CLASS;

const PORTAL_BG_FALLBACK: JSX.CSSProperties = {
  "background-color": "var(--color-surface-1)",
};

export function surface(opts?: {
  radius?: SurfaceRadius;
  shadow?: SurfaceShadow;
  portalled?: boolean;
}): { class: string; style: JSX.CSSProperties } {
  const radius = RADIUS_CLASS[opts?.radius ?? "2xl"];
  const shadow = SHADOW_CLASS[opts?.shadow ?? "default"];
  return {
    class: `bg-surface-1 border border-edge ${radius} ${shadow}`,
    style: opts?.portalled ? PORTAL_BG_FALLBACK : {},
  };
}
