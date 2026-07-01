/** Shared presentation for a *dock filter chip* — a bordered mono button
 *  that paints accent when it is actively hiding rows and neutral in its
 *  permissive default. `ActivityWindowChip` and `SleepingToggle` are the
 *  two chips; extracting the chrome and the accent-vs-neutral grammar here
 *  is what keeps them a matched pair by structure rather than by a
 *  copy-paste "keep both in sync" convention.
 *
 *  These are two small primitives, not a wrapping component: the
 *  popover-vs-toggle interaction boundary stays each chip's own. */

/** The base button chrome BOTH chips wear — layout, mono/tabular type,
 *  cursor, colour transition, and focus ring. Sizing (px/height) is layered
 *  on per call site; only this shared shell lives here. */
export const FILTER_CHIP_BASE =
  "inline-flex items-center justify-center font-mono tabular-nums cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

/** The accent-vs-neutral colour grammar: neutral (with a hover lift) while
 *  the chip is permissive, accent once it is actively filtering. Returned
 *  as a `classList` object so both chips read identically. */
export function filterChipAccent(active: boolean): Record<string, boolean> {
  return {
    "text-fg-3 hover:text-fg": !active,
    "text-accent": active,
  };
}
