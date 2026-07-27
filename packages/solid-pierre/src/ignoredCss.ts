/** The gitignored-overlay stylesheet — a pure leaf beside the imperative
 *  `FileTree` wrapper (the `pathReconcile.ts` pattern), so the selector
 *  construction and its escaping are directly testable with no DOM.
 *
 *  Why a stylesheet at all, rather than Pierre's own `"ignored"` git status:
 *  Pierre rolls EVERY `gitStatus` entry up into its ancestors' change counters
 *  (`incrementAncestorChangeCounts` runs unguarded by status), so an ignored
 *  entry would mark all of its ancestors `data-item-contains-git-change`. See
 *  the `ignoredPaths` prop doc on `FileTreeProps`. */

/** Escape a path for use inside a double-quoted CSS attribute selector. A
 *  filename may legally contain `"` or `\` (git hands them through verbatim
 *  under `-z`), either of which would otherwise terminate or mangle the
 *  selector string — so both are escaped, backslash first. */
function escapeAttrValue(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Dimming rules for `paths`: one attribute selector per entry, matched
 *  against the `data-item-path` Pierre stamps on every row. The rule count
 *  tracks the COLLAPSED ignored set — a fully-ignored directory is a single
 *  entry — so it stays in the tens even on a large monorepo. Empty input
 *  yields an empty sheet rather than a selector-less rule. */
export function ignoredPathsCss(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const selector = paths
    .map((p) => `[data-item-path="${escapeAttrValue(p)}"]`)
    .join(",\n");
  return `${selector} {\n  opacity: var(--trees-ignored-opacity, 0.5);\n}\n`;
}
