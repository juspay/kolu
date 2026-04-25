/** Path display helpers. Live in common so `terminalKey` (the canonical
 *  `(group, label)` projection) can use them — keeping the projection
 *  self-contained means there is no separate "presentation" function
 *  that drifts from identity. */

/** Replace home directory prefix with `~` for compact display. */
export function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(home\/[^/]+|root)(\/|$)/, "~$2");
}

/** Last segment of a path, with `~` for home and `terminal` as a
 *  defensive fallback for empty input. */
export function cwdBasename(cwd: string): string {
  const short = shortenCwd(cwd);
  return short.split("/").pop() || "~";
}
