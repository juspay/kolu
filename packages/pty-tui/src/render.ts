/**
 * Pure rendering helpers for the kolu-tui CLI — no I/O, no transport, so the
 * formatting is unit-testable without a socket or a tty. `main.ts` is the thin
 * glue that fetches over the contract and prints these.
 */
import type { PtyHostListEntry } from "@kolu/pty-host";

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

/** Collapse a leading `$HOME` to `~` for a shorter, familiar cwd. */
export function tildeify(cwd: string, home?: string): string {
  if (home === undefined || home === "") return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

/** Render the `list` table — one row per live terminal, columns sized to
 *  content. Empty inventory gets an honest one-liner, not a bare header. */
export function formatList(
  entries: PtyHostListEntry[],
  opts: { now: number; home?: string },
): string {
  if (entries.length === 0) return "no live terminals.";
  const rows = entries.map((e) => ({
    id: e.id,
    pid: String(e.pid),
    idle: relativeTime(e.lastActivity, opts.now),
    cwd: tildeify(e.cwd, opts.home),
  }));
  const header = { id: "ID", pid: "PID", idle: "IDLE", cwd: "CWD" };
  const width = (key: keyof typeof header): number =>
    Math.max(header[key].length, ...rows.map((r) => r[key].length));
  const w = {
    id: width("id"),
    pid: width("pid"),
    idle: width("idle"),
    cwd: width("cwd"),
  };
  const line = (r: typeof header): string =>
    `${r.id.padEnd(w.id)}  ${r.pid.padStart(w.pid)}  ${r.idle.padStart(
      w.idle,
    )}  ${r.cwd}`;
  return [line(header), ...rows.map(line)].join("\n");
}

/** Render `list --json` — the entries array verbatim (a top-level array, so
 *  `jq '.[]'` works), 2-space indented. */
export function formatListJson(entries: PtyHostListEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
