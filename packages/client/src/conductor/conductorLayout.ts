/** WHICH PLACEMENT THE WATCHED PANEL AND THE HELP ARE IN — two media
 *  queries, two tokens, no third opinion.
 *
 *  The conversation is read in a column (`--container-conductor`), and on a
 *  window wide enough to hold that column AND the watched panel beside it
 *  (`--container-conductor-side`, with `--spacing-conductor-gutter` between
 *  them) the panel is a SIDE COLUMN that is always on screen. Below that width
 *  — and on a phone, which is always below it — the panel is what the status
 *  line's `N pieces of work` opens, as it has always been.
 *
 *  THE HELP IS THE SAME SHAPE OF DECISION, one width further out. On a window
 *  that holds all three measures the frame is help · conversation · work in
 *  progress, with the help's track a CONSTANT width open or collapsed
 *  (`ConductorHelp.tsx`), so the conversation does not move when it is shut.
 *  `--breakpoint-conductor-help` is that sum. Below it, the same words are
 *  what the `⋯` menu's `How to use` opens.
 *
 *  THE WIDTHS ARE NOT GUESSES AND NOT SECOND NUMBERS. `index.css` states the
 *  measures, the gutter and the two sums in one `@theme` block; this reads
 *  those tokens and builds the queries from them, the way `useMobile.ts` reads
 *  `--breakpoint-sm`. So Tailwind's `conductor-wide:` utilities and these
 *  accessors flip at the same pixel.
 *
 *  ONE SIGNAL, ASKED — never a measurement. Nothing here reads an element's
 *  box: a retained pane that measured its own DOM to decide its layout would
 *  read zeros every time it was hidden behind a host tab.
 *
 *  The fallbacks are the tokens' own values, for the moment before the
 *  stylesheet has applied (and for a unit environment with no layout at all,
 *  where both resolve to the narrow placement — the one with the control that
 *  opens the panel, and the menu entry that opens the help). They are EXPORTED
 *  because a second spelling of a design token that nothing compares is a
 *  number that drifts silently: `conductorLayout.test.ts` already parses
 *  `index.css`, and it asserts these two equal the tokens there, so moving a
 *  measure cannot leave the pre-stylesheet frame flipping at the old pixel. */

import { createMediaQuery } from "@solid-primitives/media";

/** A breakpoint token, read from the generated custom property so JS and CSS
 *  share the one definition. */
function breakpoint(token: string, fallback: string): string {
  const declared =
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement)
          .getPropertyValue(token)
          .trim()
      : "";
  return declared || fallback;
}

/** `--breakpoint-conductor-wide`'s declared value, pinned against the
 *  stylesheet by this module's test. */
export const CONDUCTOR_WIDE_FALLBACK = "69rem";

/** `--breakpoint-conductor-help`'s declared value, pinned the same way. */
export const CONDUCTOR_HELP_FALLBACK = "87rem";

/** The window is wide enough for the reading column and the side column at
 *  once: the exact complement of Tailwind's `conductor-wide:` variant. */
export const conductorWide = createMediaQuery(
  `(width >= ${breakpoint("--breakpoint-conductor-wide", CONDUCTOR_WIDE_FALLBACK)})`,
);

/** The window holds all three tracks — help, conversation, work in progress:
 *  the help is a COLUMN here and an entry in the `⋯` menu everywhere else. */
export const conductorHelpColumn = createMediaQuery(
  `(width >= ${breakpoint("--breakpoint-conductor-help", CONDUCTOR_HELP_FALLBACK)})`,
);
