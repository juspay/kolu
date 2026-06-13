/**
 * Pure rendering helpers for the kaval-tui CLI — no I/O, no transport, so the
 * formatting is unit-testable without a socket or a tty. `main.ts` is the thin
 * glue that fetches over the contract and prints these.
 */
import { basename } from "node:path";
import type { PtyHostListEntry } from "kaval";
import columnify from "columnify";

/** Compact relative age of `ms` (an epoch from `lastActivity`) against `now`,
 *  e.g. `3s` / `5m` / `2h` / `4d`. Never negative (clock skew floors at 0s). */
export function relativeTime(ms: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - ms) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Last path segment of a process path — `/run/…/bin/bash` → `bash`. Empty in,
 *  empty out (the caller falls through to the next field). */
export function commandName(processPath: string | undefined): string {
  if (processPath === undefined || processPath === "") return "";
  return basename(processPath);
}

/** Strip terminal-hostile bytes from a human-table cell. OSC titles and OSC 7
 *  cwds are attacker-influenceable (a shell can set its title to anything,
 *  including newlines or raw ESC sequences), so painting them verbatim into the
 *  `list` table could break the column layout or inject terminal control
 *  effects. Collapse all C0 controls + DEL to a single space and trim — JSON
 *  output stays raw (`JSON.stringify` escapes controls), this is only the
 *  human-rendered path. */
export function sanitizeCell(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

/** Collapse a leading `$HOME` to `~` for a shorter, familiar cwd. */
export function tildeify(cwd: string, home?: string): string {
  if (home === undefined || home === "") return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

/** Render the `list` table — one row per live terminal, columns auto-sized by
 *  `columnify` (the borderless, space-aligned `docker ps` style). Empty
 *  inventory gets an honest one-liner, not a bare header. */
export function formatList(
  entries: PtyHostListEntry[],
  opts: { now: number; home?: string },
): string {
  if (entries.length === 0) return "no live terminals.";
  const rows = entries.map((e) => ({
    id: e.id,
    pid: String(e.pid),
    idle: relativeTime(e.lastActivity, opts.now),
    // The OSC 0/2 title if set (e.g. "claude: implement …"), else the foreground
    // command's basename, else an em-dash. "" is falsy so it falls through.
    // Sanitized: title/cwd are attacker-influenceable (a shell sets them), so
    // strip control bytes before they can corrupt the table or inject escapes.
    cmd: sanitizeCell(e.title || commandName(e.foregroundProcess) || "—"),
    cwd: sanitizeCell(tildeify(e.cwd, opts.home)),
  }));
  return (
    columnify(rows, {
      columns: ["id", "pid", "idle", "cmd", "cwd"],
      columnSplitter: "  ",
      config: { pid: { align: "right" }, idle: { align: "right" } },
    })
      // columnify right-pads every column including the last; drop the trailing
      // run so piped/asserted output has no dangling whitespace.
      .split("\n")
      .map((row) => row.trimEnd())
      .join("\n")
  );
}

/** Render `list --json` — the entries array verbatim (a top-level array, so
 *  `jq '.[]'` works), 2-space indented. */
export function formatListJson(entries: PtyHostListEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
