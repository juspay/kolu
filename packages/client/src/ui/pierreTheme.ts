/** CSS variable overrides that push kolu's palette into `@pierre/trees` and
 *  `@pierre/diffs`. Pierre reads `--trees-*-override` / `--diffs-*-override`
 *  first, so these short-circuit Pierre's built-in `light-dark()` defaults
 *  and give the Code tab a surface that matches the rest of the app.
 *
 *  Values use the same CSS custom properties declared in `index.css`, so
 *  they swap automatically with `.dark` — no per-scheme branching here. */

import type { JSX } from "solid-js";

/** Apply to any `@pierre/trees` FileTree host. */
export const pierreTreesStyle: JSX.CSSProperties = {
  "--trees-bg-override": "var(--color-surface-0)",
  "--trees-bg-muted-override": "var(--color-surface-1)",
  "--trees-fg-override": "var(--color-fg)",
  "--trees-fg-muted-override": "var(--color-fg-3)",
  "--trees-accent-override": "var(--color-accent)",
  "--trees-border-color-override": "var(--color-edge)",
  "--trees-search-bg-override": "var(--color-surface-1)",
  "--trees-search-fg-override": "var(--color-fg)",
  "--trees-input-bg-override": "var(--color-surface-1)",
  "--trees-selected-bg-override": "var(--color-surface-2)",
  "--trees-selected-fg-override": "var(--color-fg)",
  "--trees-selected-focused-border-color-override": "var(--color-accent)",
  "--trees-focus-ring-color-override": "var(--color-accent)",
  "--trees-status-added-override": "var(--color-ok)",
  "--trees-status-untracked-override": "var(--color-ok)",
  "--trees-status-modified-override": "var(--color-warning)",
  "--trees-status-renamed-override": "var(--color-fg-3)",
  "--trees-status-deleted-override": "var(--color-danger)",
  "--trees-status-ignored-override": "var(--color-fg-3)",
  "--trees-font-family-override":
    "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
  "--trees-font-size-override": "11px",
  "--trees-density-override": "0.85",
};

/** Apply to any `@pierre/diffs` FileDiff / File host. */
export const pierreDiffsStyle: JSX.CSSProperties = {
  "--diffs-bg-override": "var(--color-surface-0)",
  "--diffs-fg-override": "var(--color-fg)",
  "--diffs-border-color-override": "var(--color-edge)",
  "--diffs-gutter-fg-override": "var(--color-fg-3)",
  "--diffs-gutter-bg-override": "var(--color-surface-1)",
  "--diffs-font-family-override":
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  "--diffs-font-size-override": "11px",
};
