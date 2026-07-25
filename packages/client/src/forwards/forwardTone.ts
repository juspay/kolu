/**
 * The ONE colour that means "kolu is holding a door open", and the words that go
 * with it.
 *
 * The binding rule of the approved UX pass: **green is connection health, teal
 * is open doors, and neither surface may borrow the other's colour.** If a third
 * meaning ever appears it gets a third colour — never a second green. That rule
 * is why this is a module and not a class string typed four times: the ring on
 * the host tab, the pill in the dropdown, and the pill on a ports row all have to
 * be the same teal, and "the same" has to survive someone restyling one of them.
 *
 * The first cut broke the rule by reusing `accent`, and the cost was legible
 * immediately: the ring read as a focus or selection highlight — a quieter way of
 * saying "connected" — rather than as a fact of its own.
 */

/** Text in the forward colour, both themes. */
export const FORWARD_TEXT = "text-teal-700 dark:text-teal-300";

/** The pill that carries an address — teal on a teal wash, both themes. */
export const FORWARD_PILL =
  "rounded bg-teal-500/10 px-1 font-mono text-teal-700 dark:bg-teal-400/15 dark:text-teal-300";

/** The ring around the host tab's connection pip. Geometry and one colour: it
 *  composes AROUND the pip and never touches the pip's own health colour. */
export const FORWARD_RING = "ring-1 ring-teal-500/80 dark:ring-teal-300/70";

/** How a forward's ORIGIN reads, and what the tooltip explains.
 *
 *  `manual` displays as **"pinned"** — the wire field keeps its name, this is
 *  display vocabulary only. "Manual" describes how it was created, which the user
 *  already knows because they did it; "pinned" describes the property they
 *  actually need to predict — that it stays until they say otherwise. And "auto"
 *  survived review only because it earns a tooltip: it was jargon with no
 *  explanation anywhere on the surface. */
export function originWord(origin: "auto" | "manual"): string {
  return origin === "auto" ? "auto" : "pinned";
}

export function originTooltip(origin: "auto" | "manual"): string {
  return origin === "auto"
    ? "closes itself when the server stops"
    : "opened by hand — stays until you cancel it";
}
