/** Path display helpers. Live in common so `terminalKey` (the canonical
 *  `(group, label)` projection) can use them — keeping the projection
 *  self-contained means there is no separate "presentation" function
 *  that drifts from identity. */

/** Replace home directory prefix with `~` for compact display. */
export function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(home\/[^/]+|root)(\/|$)/, "~$2");
}

/** Last segment of a path, with `~` for home directory and the same `~`
 *  as a fallback for empty input — never returns the empty string. */
export function cwdBasename(cwd: string): string {
  const short = shortenCwd(cwd);
  return short.split("/").pop() || "~";
}

/** Last real path segment — `filter(Boolean)` so a trailing slash still yields
 *  the last segment, falling back to the input when there is none. The single
 *  home of "path tail" for sleeping-tile labels (canvas title + body) and the
 *  `sleepingTileLabel` helper. */
export function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}
