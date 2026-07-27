/** Dimming rules for a set of Pierre rows — a pure leaf beside the imperative
 *  `FileTree` wrapper (the `pathReconcile.ts` pattern), so the selector
 *  construction and its escaping are directly testable with no DOM. The
 *  APPEARANCE is not decided here: the caller passes the declaration body, so
 *  the one place that answers "what does a dimmed row look like" is the host
 *  theme that answers it for every other Pierre visual (`pierreTheme.ts`).
 *
 *  Why the Code tab paints gitignored rows through a stylesheet at all, rather
 *  than Pierre's own `"ignored"` git status: Pierre rolls EVERY `gitStatus`
 *  entry up into its ancestors' change counters (`incrementAncestorChangeCounts`
 *  runs unguarded by status), which sets `data-item-contains-git-change` on
 *  every ancestor. Routing the overlay through that channel therefore paints
 *  each ancestor of an ignored entry as "contains changes" — on the kolu repo,
 *  47 extra directories on top of a real 77, and 68 on an otherwise-clean
 *  checkout. "Contains a change" and "contains something git ignores" are
 *  different facts; this sheet keys on `data-item-path` instead, so the
 *  roll-up stays honest. */

/** Escape a path for use inside a double-quoted CSS attribute selector. A
 *  filename may legally contain `"` or `\` (git hands them through verbatim
 *  under `-z`), either of which would otherwise terminate or mangle the
 *  selector string — so both are escaped, backslash first. */
function escapeAttrValue(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** One attribute selector per entry — matched against the `data-item-path`
 *  Pierre stamps on every row — carrying `decl` as the rule body. A collapsed
 *  directory keeps its trailing slash, because that IS Pierre's row key
 *  (`isDirectoryPath` in `./pathReconcile`); stripping it would target a row
 *  that does not exist. The rule count tracks the COLLAPSED set — a
 *  fully-ignored directory is a single entry — so it stays in the tens even on
 *  a large monorepo. Empty input yields an empty sheet rather than a
 *  selector-less rule. */
export function ignoredPathsCss(
  paths: readonly string[],
  decl: string,
): string {
  if (paths.length === 0) return "";
  const selector = paths
    .map((p) => `[data-item-path="${escapeAttrValue(p)}"]`)
    .join(",\n");
  return `${selector} {\n  ${decl}\n}\n`;
}
