/** One attribute selector per entry, matched against the `data-item-path`
 *  Pierre stamps on every row, sharing `decl` as a single rule body. A
 *  directory path keeps its trailing slash, because that IS Pierre's row key
 *  (`isDirectoryPath` in `./pathReconcile`). Empty input yields an empty
 *  sheet rather than a selector-less rule. */
export function rowPathsCss(paths: readonly string[], decl: string): string {
  if (paths.length === 0) return "";
  const selector = paths
    .map((p) => `[data-item-path=${CSS.escape(p)}]`)
    .join(",\n");
  return `${selector} {\n  ${decl}\n}\n`;
}
