/** Kills the native marker and makes the whole summary row a pointer target.
 *  `list-none` and the `::-webkit-details-marker` rule are both needed —
 *  Firefox and WebKit hide the triangle by different means. */
export const SUMMARY_RESET =
  "flex cursor-pointer select-none list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden";

const CHEVRON_BASE =
  "h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none";

/** The `<details>` root class and its matching chevron class, per disclosure
 *  group. Tailwind extracts `group-open/<name>` variants from literal source
 *  text, so a group's pair is spelled out once here instead of at each site. */
export const DISCLOSURE_GROUPS = {
  sec: {
    root: "group/sec",
    chevron: `${CHEVRON_BASE} text-fg-3/60 group-open/sec:rotate-90`,
  },
  disc: {
    root: "group/disc",
    chevron: `${CHEVRON_BASE} group-open/disc:rotate-90`,
  },
} as const;
