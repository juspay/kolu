/**
 * Single receptacle for the site's positioning copy. Imported by
 * BaseLayout (description, OG/Twitter meta) and the OG image generator
 * (the home/fallback card). When the positioning sentence changes, this
 * file is the one edit — no character-divergent copies in two places.
 *
 * The short tagline is intentionally a separate string: it's a
 * different grain (alt-text / page-title constraint), not the same
 * sentence at a different size.
 */

export const SITE_DESCRIPTION =
  "kolu is a terminal app built for scale: real xterm.js tiles on an infinite canvas, with a dock that never loses one — especially when you're running five agents at once.";

export const SITE_TAGLINE = "the best way to run terminals";
