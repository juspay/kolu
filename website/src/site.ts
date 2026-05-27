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
  "Your terminals are the workspace. Real xterm.js tiles on an infinite 2D canvas — claude, codex, opencode, anything you run in a shell.";

export const SITE_TAGLINE = "your terminals are the workspace";
