/** Shared style tokens for the comments-on-files highlight. Imported by
 *  both the in-iframe SDK (`packages/artifact-sdk/src/iframe/index.ts`)
 *  and the parent-side overlay (`packages/client/src/comments/highlightOverlay.ts`).
 *
 *  The CSS Custom Highlight names differ across runtimes (different
 *  documents register their own highlight registries — the iframe is
 *  opaque-origin and shares nothing with the parent), but the colors
 *  must stay identical so a comment looks the same regardless of
 *  surface. Without this shared module the values silently drift.
 *
 *  IMPORTANT: `::highlight()` only supports a subset of CSS properties
 *  (color, background-color, text-decoration*, text-shadow). `box-shadow`
 *  is silently dropped — use `text-decoration: underline` for the accent
 *  line. */

/** Translucent yellow base (~`var(--color-warning)` at 36% over white)
 *  — readable across light and dark surfaces. Hard-coded for the iframe
 *  bundle (opaque-origin sandbox, no access to kolu's CSS variables).
 *  The parent-side overlay overrides this via `var(--color-warning)`
 *  + `color-mix` so it tracks the kolu theme exactly. */
export const COMMENT_HIGHLIGHT_BACKGROUND = "rgba(250, 204, 21, 0.36)";
export const COMMENT_HIGHLIGHT_UNDERLINE = "rgba(217, 119, 87, 0.85)";

/** Style body for the in-iframe SDK (no CSS vars). */
export const COMMENT_HIGHLIGHT_STYLE = `background-color: ${COMMENT_HIGHLIGHT_BACKGROUND}; text-decoration-line: underline; text-decoration-color: ${COMMENT_HIGHLIGHT_UNDERLINE}; text-decoration-thickness: 1px;`;

/** Style body for the parent-side overlay — uses kolu's theme variables
 *  via `color-mix` so dark and light modes track automatically. The
 *  parent document has `--color-warning` / `--color-busy` defined in
 *  `packages/client/src/index.css`. */
export const COMMENT_HIGHLIGHT_STYLE_THEMED =
  "background-color: color-mix(in srgb, var(--color-warning) 36%, transparent); text-decoration-line: underline; text-decoration-color: color-mix(in srgb, var(--color-busy) 85%, transparent); text-decoration-thickness: 1px;";
