/** Panel surface chrome — `bg-surface-1` + edge border + rounded + drop
 *  shadow, behind every floating panel in the app.
 *
 *  Pass `portalled: true` whenever the panel renders inside a Corvu portal or
 *  a SolidJS `Portal`: Firefox intermittently drops the `bg-surface-1` utility
 *  on portalled content, so the returned `style` then carries an inline
 *  `background-color`. Non-portal callers receive an empty `style`. */

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
