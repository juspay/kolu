import { basename } from "node:path";
import columnify from "columnify";
import type { PtyHostListEntry } from "kaval";

export function relativeTime(ms: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - ms) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function commandName(processPath: string | undefined): string {
  if (processPath === undefined || processPath === "") return "";
  return basename(processPath);
}

export function sanitizeCell(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

export function tildeify(cwd: string, home?: string): string {
  if (home === undefined || home === "") return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

export const SHORT_ID_LEN = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

export type ResolveResult =
  | { kind: "found"; id: string }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: string[] };

export function resolveTerminalId(query: string, ids: string[]): ResolveResult {
  if (query === "") return { kind: "none" };
  const q = query.toLowerCase();
  const exact = ids.find((id) => id.toLowerCase() === q);
  if (exact !== undefined) return { kind: "found", id: exact };
  const matches = ids.filter((id) => id.toLowerCase().startsWith(q));
  const [first, ...rest] = matches;
  if (first === undefined) return { kind: "none" };
  if (rest.length > 0) return { kind: "ambiguous", matches };
  return { kind: "found", id: first };
}

export function formatList(
  entries: readonly PtyHostListEntry[],
  opts: { now: number; home?: string },
): string {
  if (entries.length === 0) return "no live terminals.";
  const rows = entries.map((e) => ({
    id: shortId(e.id),
    pid: String(e.pid),
    idle: relativeTime(e.lastActivity, opts.now),
    cmd: sanitizeCell(e.title || commandName(e.foregroundProcess) || "—"),
    cwd: sanitizeCell(tildeify(e.cwd, opts.home)),
  }));
  return (
    columnify(rows, {
      columns: ["id", "pid", "idle", "cmd", "cwd"],
      columnSplitter: "  ",
      config: { pid: { align: "right" }, idle: { align: "right" } },
    })
      // columnify right-pads every column, including the last.
      .split("\n")
      .map((row) => row.trimEnd())
      .join("\n")
  );
}

export function formatListJson(entries: readonly PtyHostListEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function formatSend(result: {
  id: string;
  bytes: number;
  paste: boolean;
  keys: readonly string[];
}): string {
  const base = `sent ${result.bytes} byte${result.bytes === 1 ? "" : "s"} to ${shortId(result.id)}`;
  const pasteMark = result.paste ? " · pasted" : "";
  const keysMark =
    result.keys.length > 0 ? ` · keys: ${result.keys.join(", ")}` : "";
  return `${base}${pasteMark}${keysMark}`;
}
