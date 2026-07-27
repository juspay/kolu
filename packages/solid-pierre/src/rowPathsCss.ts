/** Style a named SET OF ROWS in Pierre's shadow root — a pure leaf beside the
 *  imperative `FileTree` wrapper (the `pathReconcile.ts` pattern), so the
 *  selector construction is directly testable with no DOM.
 *
 *  What lives here is Pierre's ANATOMY — that a row is addressed by
 *  `data-item-path` — and nothing else. The APPEARANCE is the caller's: it
 *  passes the declaration body, so this module knows nothing about WHY a caller
 *  wants a set of rows to look different. */

/** One attribute selector per entry, matched against the `data-item-path`
 *  Pierre stamps on every row, sharing `decl` as a single rule body.
 *
 *  Escaping is `CSS.escape`, not a hand-rolled pass: a path may contain any
 *  byte but `/` and NUL, and getting the escape set right means tracking CSS
 *  Syntax by hand (the quote and backslash are obvious; LF, CR and FF also
 *  terminate a value, and a leading digit needs a numeric escape). The platform
 *  already answers this exactly, and the repo already relies on it for the same
 *  job in `solid-markdown`'s footnote lookup. It yields an ident-token, so the
 *  value is emitted unquoted.
 *
 *  A directory path keeps its trailing slash, because that IS Pierre's row key
 *  (`isDirectoryPath` in `./pathReconcile`); stripping it would target a row
 *  that does not exist. Empty input yields an empty sheet rather than a
 *  selector-less rule. */
export function rowPathsCss(paths: readonly string[], decl: string): string {
  if (paths.length === 0) return "";
  const selector = paths
    .map((p) => `[data-item-path=${CSS.escape(p)}]`)
    .join(",\n");
  return `${selector} {\n  ${decl}\n}\n`;
}
