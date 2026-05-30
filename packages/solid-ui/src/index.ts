/** `@kolu/solid-ui` — the app's presentation atoms: themed primitives that
 *  carry the Kolu design system (panel chrome, segmented controls, toggles,
 *  keycaps, tooltips, z-index layering) but no domain logic. Each module is
 *  also reachable directly (`@kolu/solid-ui/Surface`) for default-import call
 *  sites; this barrel is the named-export convenience entry. */

export { default as Kbd } from "./Kbd";
export { default as Row } from "./Row";
export { default as Section } from "./Section";
export type { SegmentedControlOption } from "./SegmentedControl";
export { default as SegmentedControl } from "./SegmentedControl";
export * from "./stackLayers";
export type { SurfaceRadius, SurfaceShadow } from "./Surface";
export { surface } from "./Surface";
export { default as Tip } from "./Tip";
export { default as Toggle } from "./Toggle";
