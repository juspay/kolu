/** CSS variable overrides that push kolu's palette into `@pierre/trees` and
 *  `@pierre/diffs`. Pierre reads `--trees-*-override` / `--diffs-*-override`
 *  first, so these short-circuit Pierre's built-in `light-dark()` defaults
 *  and give the Code tab a surface that matches the rest of the app.
 *
 *  Values use the same CSS custom properties declared in `index.css`, so
 *  they swap automatically with `.dark` — no per-scheme branching here. */

import type { JSX } from "solid-js";
import type { FileTreeIconConfig } from "@pierre/trees";

/** Custom <symbol> definitions for file types Pierre's built-in icon set
 *  doesn't cover. Pierre injects this into its shadow DOM and renders each
 *  symbol via `<use href="#id" />`. Keep viewBox 0 0 24 24 (Lucide scale) so
 *  the icons visually match the built-ins. */
const KOLU_PIERRE_SPRITE_SHEET = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="kolu-icon-nix" viewBox="0 0 24 24">
    <g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">
      <path d="M12 2v20" />
      <path d="M3.34 7 20.66 17" />
      <path d="M3.34 17 20.66 7" />
    </g>
  </symbol>
  <symbol id="kolu-icon-hs" viewBox="0 0 24 24">
    <g stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M4 4 12 12 4 20" />
      <path d="M12 12 20 20" />
      <path d="M14 12h6" />
    </g>
  </symbol>
</svg>`;

/** Pass to `new FileTree({ icons: pierreIconConfig })`. Extends Pierre's
 *  "complete" built-in set with kolu-specific overrides for languages Pierre
 *  doesn't ship (Nix, Haskell). */
export const pierreIconConfig: FileTreeIconConfig = {
  set: "complete",
  colored: true,
  spriteSheet: KOLU_PIERRE_SPRITE_SHEET,
  byFileExtension: {
    nix: { name: "kolu-icon-nix", viewBox: "0 0 24 24" },
    hs: { name: "kolu-icon-hs", viewBox: "0 0 24 24" },
    lhs: { name: "kolu-icon-hs", viewBox: "0 0 24 24" },
  },
};

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

/** Apply to any `@pierre/diffs` FileDiff / File host.
 *
 *  Pierre's diffs CSS reads bare variables (`--diffs-font-size`) for fonts and
 *  `-override` suffix for colors — see `@pierre/diffs/src/style.css`. Don't
 *  rename the font vars: they won't cascade if you add `-override`. */
export const pierreDiffsStyle: JSX.CSSProperties = {
  "--diffs-bg-override": "var(--color-surface-0)",
  "--diffs-fg-override": "var(--color-fg)",
  "--diffs-border-color-override": "var(--color-edge)",
  "--diffs-gutter-fg-override": "var(--color-fg-3)",
  "--diffs-gutter-bg-override": "var(--color-surface-1)",
  "--diffs-font-family":
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  "--diffs-header-font-family":
    "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
  "--diffs-font-size": "11px",
  "--diffs-line-height": "16px",
};
