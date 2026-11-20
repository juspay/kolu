/** CSS variable overrides that push kolu's palette into `@pierre/trees` and
 *  `@pierre/diffs`: Pierre reads `--trees-*-override` / `--diffs-*-override`
 *  ahead of its built-in `light-dark()` defaults. */

import type { FileTreeIconConfig } from "@pierre/trees";
import type { JSX } from "solid-js";

/** Custom <symbol> definitions for file types Pierre's built-in icon set does
 *  not cover; Pierre renders each via `<use href="#id" />`. viewBox is
 *  0 0 24 24 (Lucide scale) to match the built-ins. */
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

/** Pass to `new FileTree({ icons: pierreIconConfig })`. */
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

/** Injected into Pierre's shadow root via `<FileTree shadowCss>`. Pierre marks
 *  every ancestor of a changed file with `data-item-contains-git-change` but
 *  exposes no theme variable to tint the folder itself, so this rule colors the
 *  folder name and brightens its dot. The roll-up is a boolean, so every
 *  contained-change folder reads in the one modified color. */
export const pierreTreesShadowCss = `
  [data-item-contains-git-change='true'] > [data-item-section='content'] {
    color: var(--trees-git-modified-color);
  }
  [data-item-contains-git-change='true'] > [data-item-section='git'] {
    opacity: 1;
  }
`;

/** How kolu paints a gitignored row in the browse tree — the declaration body
 *  `rowPathsCss` wraps in its per-row selectors. */
export const pierreTreesIgnoredRowDecl = "opacity: 0.5;";

/** Rendered code-row height (px) for Pierre `CodeView` hosts. */
const PIERRE_DIFFS_LINE_HEIGHT = 16;

/** CSS custom properties for a `@pierre/diffs` `CodeView` host. Pierre's diffs
 *  CSS reads bare variables (`--diffs-font-size`) for fonts and the `-override`
 *  suffix for colors, so the font vars must not be renamed. */
const pierreDiffsStyle: JSX.CSSProperties = {
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
};

/** Presentation props every Kolu `<CodeView>` host must carry. The CSS row
 *  height and Pierre's `itemMetrics.lineHeight` are both derived from
 *  {@link PIERRE_DIFFS_LINE_HEIGHT} here, so no host can supply one without
 *  the other. */
export const koluCodeViewProps = (): {
  style: JSX.CSSProperties;
  lineHeight: number;
} => ({
  style: {
    ...pierreDiffsStyle,
    "--diffs-line-height": `${PIERRE_DIFFS_LINE_HEIGHT}px`,
  },
  lineHeight: PIERRE_DIFFS_LINE_HEIGHT,
});
