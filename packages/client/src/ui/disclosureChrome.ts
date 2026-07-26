/** The one part of the native-`<details>` chrome that CAN be shared between
 *  `Disclosure` and `Section`'s collapsible variant: the `<summary>` reset.
 *
 *  Its siblings can't be. The chevron's rotate variant is `group-open/<name>`,
 *  and the two components must use DIFFERENT group names — a `Disclosure` nests
 *  inside a collapsible `Section` (the CLI reference inside Attach), so one
 *  shared name would rotate the inner chevron whenever the outer section is
 *  open. Tailwind extracts such variants only from literal class strings, so the
 *  name cannot be a parameter; each component keeps its own literal, and this
 *  module holds the part that is genuinely one decision. */

/** Kills the native marker and makes the whole summary row a pointer target.
 *  `list-none` + the `::-webkit-details-marker` rule are both needed — Firefox
 *  and WebKit hide the triangle by different means. */
export const SUMMARY_RESET =
  "flex cursor-pointer select-none list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden";
