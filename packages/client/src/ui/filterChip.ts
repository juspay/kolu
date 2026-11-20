/** The base button chrome both dock filter chips wear; sizing is layered on
 *  per call site. */
export const FILTER_CHIP_BASE =
  "inline-flex items-center justify-center font-mono tabular-nums cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

/** The accent-vs-neutral colour grammar: neutral while the chip is
 *  permissive, accent once it is actively filtering. */
export function filterChipAccent(active: boolean): Record<string, boolean> {
  return {
    "text-fg-3 hover:text-fg": !active,
    "text-accent": active,
  };
}
