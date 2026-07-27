/** Style a named SET OF ROWS in Pierre's shadow root — a pure leaf beside the
 *  imperative `FileTree` wrapper (the `pathReconcile.ts` pattern), so the
 *  selector construction and its escaping are directly testable with no DOM.
 *
 *  Two things live here and nowhere else, both of them Pierre's ANATOMY rather
 *  than any caller's domain: that a row is addressed by `data-item-path`, and
 *  how a path is escaped to survive as a CSS attribute value. The APPEARANCE is
 *  not decided here — the caller passes the declaration body — so this module
 *  knows nothing about WHY a caller wants a set of rows to look different. The
 *  Code tab's gitignored overlay is one such caller; the reason it paints
 *  through a stylesheet at all is recorded at that call site, not here. */

/** Escape a path for use inside a double-quoted CSS attribute selector.
 *
 *  A filename may legally contain `"`, `\`, or a raw newline — the filesystem
 *  allows every byte but `/` and NUL, and a `-z` listing hands them through
 *  verbatim. Each would otherwise terminate or mangle the selector string, and
 *  the blast radius is wider than the one bad row: callers concatenate this
 *  output with their other rules into a single `replaceSync` payload, so one
 *  unescaped path silently drops every sibling rule in that sheet.
 *
 *  Backslash goes first (or it would double-escape the escapes we add), then
 *  the quote, then the two line terminators as CSS numeric escapes. The
 *  trailing space in `\\A ` is REQUIRED and not a typo: a CSS numeric escape
 *  ends at the first non-hex character, so `\A` immediately followed by a hex
 *  digit in the filename would swallow it into the code point. */
function escapeAttrValue(path: string): string {
  return path
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\A ")
    .replace(/\r/g, "\\D ");
}

/** One attribute selector per entry — matched against the `data-item-path`
 *  Pierre stamps on every row — sharing `decl` as a single rule body. A
 *  directory path keeps its trailing slash, because that IS Pierre's row key
 *  (`isDirectoryPath` in `./pathReconcile`); stripping it would target a row
 *  that does not exist. Empty input yields an empty sheet rather than a
 *  selector-less rule. */
export function rowPathsCss(paths: readonly string[], decl: string): string {
  if (paths.length === 0) return "";
  const selector = paths
    .map((p) => `[data-item-path="${escapeAttrValue(p)}"]`)
    .join(",\n");
  return `${selector} {\n  ${decl}\n}\n`;
}
