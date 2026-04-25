/** Format a `path:line` (single line) or `path:start-end` (range) reference
 *  the way most editors and code tools accept (VS Code, Vim's `:e file:N`,
 *  GitHub URL fragments, Linear-style snippets). */
export function formatLineRef(
  path: string,
  start: number,
  end: number,
): string {
  return start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
}
