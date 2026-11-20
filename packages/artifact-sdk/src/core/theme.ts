/** `::highlight()` only supports a subset of CSS properties (color,
 *  background-color, text-decoration*, text-shadow). `box-shadow` is silently
 *  dropped — use `text-decoration: underline` for the accent line. */

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
 *  name (`useHighlightOverlay` appends a unique suffix). */
export const COMMENT_HIGHLIGHT_NAME_PREFIX = "kolu-comment";
