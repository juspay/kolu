/**
 * Pure rendering helpers for the kaval-tui CLI — no I/O, no transport, so the
 * formatting is unit-testable without a socket or a tty. `main.ts` is the thin
 * glue that fetches over the contract and prints these.
 */
import { basename } from "node:path";
import columnify from "columnify";
import type { PtyHostListEntry } from "kaval";

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

/** POSIX-quote one argument for a copy-pasteable shell command line. We print
 *  "attach with `… --host X`" / "`… --socket P`" hints meant to be pasted back
 *  into a shell, and the value is whatever the user typed (an ssh target, or a
 *  socket path that may legitimately contain spaces — `/tmp/my sock`). Echoing
 *  it raw would re-split on spaces (the pasted command targets the wrong thing)
 *  or let metacharacters/backticks change what runs. Wrap in single quotes and
 *  escape any embedded single quote the canonical `'\''` way; a value that is
 *  already a safe bare word is returned unquoted so the common `nix@prod` /
 *  `/run/…/pty-host.sock` hint stays clean. */
export function shellQuoteArg(value: string): string {
  // A conservative "needs no quoting" set: the chars that appear in ssh targets
  // and socket paths and carry no shell meaning. Anything else (space, glob,
  // `$`, backtick, quotes, `;`, `&`, newline, …) forces quoting.
  if (value !== "" && /^[A-Za-z0-9@%_+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Collapse a leading `$HOME` to `~` for a shorter, familiar cwd. */
export function tildeify(cwd: string, home?: string): string {
  if (home === undefined || home === "") return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

/** How many leading characters of a terminal id we show in the human `list`
 *  (and accept as the friendly hand-typed form). The ids are v4 UUIDs whose
 *  first 8 hex chars are random — across the handful of terminals one runs,
 *  an 8-char prefix collision is effectively impossible, so this is short
 *  enough to type yet unambiguous in practice. `--json` keeps the full id. */
export const SHORT_ID_LEN = 8;

/** The short, hand-typeable form of a terminal id — the first `SHORT_ID_LEN`
 *  characters (the whole id when it's already shorter). `list` renders this;
 *  `attach`/`snapshot` resolve any prefix of the full id back to it via
 *  `resolveTerminalId`, so a short id pasted from `list` round-trips. */
export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

/** The outcome of resolving a user-typed id-or-prefix against the live ids. */
export type ResolveResult =
  | { kind: "found"; id: string }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: string[] };

/** Resolve a user-supplied id-or-prefix to a single full terminal id against
 *  the live inventory. A full id is a prefix of itself, so a pasted full id
 *  (e.g. copied from the kolu inspector) keeps resolving to itself unchanged.
 *  Matching is case-insensitive — UUIDs are lowercase hex, but a hand-typed or
 *  pasted upper-case prefix should still land. Zero matches → `none`; more than
 *  one → `ambiguous` with the full ids so the caller can ask for more chars. */
export function resolveTerminalId(query: string, ids: string[]): ResolveResult {
  // An empty query is a prefix of EVERY id (`"".startsWith("")` is true for all
  // strings), so with one live terminal it would silently resolve to it — a
  // wrong-terminal footgun when `$id` is accidentally empty (`attach "$id"`).
  // Reject it as a no-match so the caller fails loud instead.
  if (query === "") return { kind: "none" };
  const q = query.toLowerCase();
  // An exact id wins outright, so a full id never reads as ambiguous against a
  // longer id that happens to share its prefix (UUIDs can't nest, but this is
  // free correctness and documents intent).
  const exact = ids.find((id) => id.toLowerCase() === q);
  if (exact !== undefined) return { kind: "found", id: exact };
  const matches = ids.filter((id) => id.toLowerCase().startsWith(q));
  // Destructure so the single-match case yields a non-optional `first`
  // (indexing would be `string | undefined` under noUncheckedIndexedAccess).
  const [first, ...rest] = matches;
  if (first === undefined) return { kind: "none" };
  if (rest.length > 0) return { kind: "ambiguous", matches };
  return { kind: "found", id: first };
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
    // Short, hand-typeable form (the full id is one `--json` away); `attach` /
    // `snapshot` accept any prefix of it, so what's printed is what you type.
    id: shortId(e.id),
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
