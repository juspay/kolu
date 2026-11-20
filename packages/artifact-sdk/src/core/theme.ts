/** The CSS Custom Highlight names differ across runtimes (different
 *  documents register their own highlight registries — the iframe is
 *  opaque-origin and shares nothing with the parent), but the colors
 *  must stay identical so a comment looks the same regardless of
 *  surface. Without this shared module the values silently drift.
 *
 *  IMPORTANT: `::highlight()` only supports a subset of CSS properties
 *  (color, background-color, text-decoration*, text-shadow). `box-shadow`
 *  is silently dropped — use `text-decoration: underline` for the accent
 *  line. */

export const COMMENT_HIGHLIGHT_BACKGROUND = "rgba(250, 204, 21, 0.36)";
export const COMMENT_HIGHLIGHT_UNDERLINE = "rgba(217, 119, 87, 0.85)";

export const COMMENT_HIGHLIGHT_STYLE = `background-color: ${COMMENT_HIGHLIGHT_BACKGROUND}; text-decoration-line: underline; text-decoration-color: ${COMMENT_HIGHLIGHT_UNDERLINE}; text-decoration-thickness: 1px;`;

/** Style body for the parent-side overlay — uses kolu's theme variables
 *  via `color-mix` so dark and light modes track automatically. The
 *  parent document has `--color-warning` / `--color-busy` defined in
 *  `packages/client/src/index.css`. */
export const COMMENT_HIGHLIGHT_STYLE_THEMED =
  "background-color: color-mix(in srgb, var(--color-warning) 36%, transparent); text-decoration-line: underline; text-decoration-color: color-mix(in srgb, var(--color-busy) 85%, transparent); text-decoration-thickness: 1px;";

/** Prefix for each parent-side overlay's per-instance CSS Custom Highlight
 *  name (`useHighlightOverlay` appends a unique suffix). The one source of
 *  truth for the naming convention: the overlay mints names with it, and the
 *  e2e step that sums "my" highlight ranges matches on it (see the in-sync
 *  comment in `packages/tests/step_definitions/code_tab_steps.ts`). The
 *  iframe SDK uses its own fixed `HIGHLIGHT_NAME` instead (opaque-origin
 *  document, separate registry). */
export const COMMENT_HIGHLIGHT_NAME_PREFIX = "kolu-comment";
