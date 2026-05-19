/**
 * Small `~/.ssh/config` reader for palette discovery.
 *
 * We enumerate concrete `Host` aliases and attach HostName/User/Port when
 * present. Wildcard templates are ignored because they are not destinations.
 * `Include` is followed with OpenSSH-like path resolution and a bounded depth.
 */

import { existsSync, globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface SshHostEntry {
  alias: string;
  hostname: string;
  user?: string;
  port?: number;
}

interface ParseCtx {
  filePath: string;
  depth: number;
  visited: Set<string>;
}

interface CurrentHostBlock {
  aliases: string[];
  hostname?: string;
  user?: string;
  port?: number;
}

const MAX_INCLUDE_DEPTH = 8;

function resolveIncludePaths(arg: string, ctx: ParseCtx): string[] {
  const expanded = arg.startsWith("~/")
    ? join(homedir(), arg.slice(2))
    : isAbsolute(arg)
      ? arg
      : resolve(dirname(ctx.filePath), arg);
  try {
    return globSync(expanded);
  } catch {
    // Bad Include globs are ignored for discovery; ssh itself remains the
    // authority when the user actually connects to an alias.
    return [];
  }
}

function pushCurrent(
  current: CurrentHostBlock | null,
  entries: SshHostEntry[],
): void {
  if (!current) return;
  for (const alias of current.aliases) {
    const entry: SshHostEntry = {
      alias,
      hostname: current.hostname ?? alias,
    };
    if (current.user !== undefined) entry.user = current.user;
    if (current.port !== undefined) entry.port = current.port;
    entries.push(entry);
  }
}

function parseInto(
  content: string,
  ctx: ParseCtx,
  entries: SshHostEntry[],
): void {
  let current: CurrentHostBlock | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=?\s*(.*)$/);
    if (!match) continue;
    const key = match[1]?.toLowerCase();
    const value = match[2]?.trim() ?? "";
    if (!key) continue;

    if (key === "include") {
      pushCurrent(current, entries);
      current = null;
      if (ctx.depth >= MAX_INCLUDE_DEPTH) continue;
      for (const includedPath of resolveIncludePaths(value, ctx)) {
        if (ctx.visited.has(includedPath)) continue;
        ctx.visited.add(includedPath);
        try {
          parseInto(
            readFileSync(includedPath, "utf8"),
            {
              filePath: includedPath,
              depth: ctx.depth + 1,
              visited: ctx.visited,
            },
            entries,
          );
        } catch {
          // Missing or unreadable includes are ignored, matching ssh_config.
        }
      }
      continue;
    }

    if (key === "host") {
      pushCurrent(current, entries);
      current = null;
      const aliases = value
        .split(/\s+/)
        .filter((a) => a.length > 0 && !/[*?!]/.test(a));
      if (aliases.length === 0) continue;
      current = { aliases };
      continue;
    }

    if (!current) continue;
    if (key === "hostname") current.hostname = value;
    else if (key === "user") current.user = value;
    else if (key === "port") {
      const port = Number.parseInt(value, 10);
      if (Number.isFinite(port) && port > 0) current.port = port;
    }
  }

  pushCurrent(current, entries);
}

export function parseSshConfig(
  content: string,
  filePath = join(homedir(), ".ssh", "config"),
): SshHostEntry[] {
  const entries: SshHostEntry[] = [];
  parseInto(
    content,
    { filePath, depth: 0, visited: new Set([filePath]) },
    entries,
  );
  return entries;
}

export function readSshHosts(): SshHostEntry[] {
  const filePath = join(homedir(), ".ssh", "config");
  if (!existsSync(filePath)) return [];
  return parseSshConfig(readFileSync(filePath, "utf8"), filePath);
}
