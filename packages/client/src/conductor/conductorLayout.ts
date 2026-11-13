/** WHICH PLACEMENT THE WATCHED PANEL IS IN — one media query, one token.
 *
 *  The conversation is read in a column (`--container-conductor`), and on a
 *  window wide enough to hold that column AND the watched panel beside it
 *  (`--container-conductor-side`, with `--spacing-conductor-gutter` between
 *  them) the panel is a SIDE COLUMN that is always on screen. Below that width
 *  — and on a phone, which is always below it — the panel is what the status
 *  line's `N pieces of work` opens, as it has always been.
 *
 *  THE WIDTH IS NOT A GUESS AND NOT A SECOND NUMBER. `index.css` states the
 *  two measures, the gutter and their sum (`--breakpoint-conductor-wide`) in
 *  one `@theme` block; this reads that token and builds the query from it, the
 *  way `useMobile.ts` reads `--breakpoint-sm`. So Tailwind's
 *  `conductor-wide:` utilities and this accessor flip at the same pixel.
 *
 *  ONE SIGNAL, ASKED — never a measurement. Nothing here reads an element's
 *  box: a retained pane that measured its own DOM to decide its layout would
 *  read zeros every time it was hidden behind a host tab.
 *
 *  The fallback is the token's own value, for the moment before the stylesheet
 *  has applied (and for a unit environment with no layout at all, where it
 *  resolves to the narrow placement — the one with the control that opens the
 *  panel). */

import { createMediaQuery } from "@solid-primitives/media";

/** `--breakpoint-conductor-wide`, read from the generated custom property so
 *  JS and CSS share the one definition. */
const WIDE_BREAKPOINT =
  (typeof document !== "undefined"
    ? getComputedStyle(document.documentElement)
        .getPropertyValue("--breakpoint-conductor-wide")
        .trim()
    : "") || "69rem";

/** The window is wide enough for the reading column and the side column at
 *  once: the exact complement of Tailwind's `conductor-wide:` variant. */
export const conductorWide = createMediaQuery(`(width >= ${WIDE_BREAKPOINT})`);
