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
import SSHConfig, { type Directive, type Line, type Section } from "ssh-config";

/** SSH destination displayed in the remote-terminal picker. */
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

const MAX_INCLUDE_DEPTH = 8;

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function isDirective(line: Line, param?: string): line is Directive {
  return (
    line.type === SSHConfig.DIRECTIVE &&
    "param" in line &&
    (param === undefined || line.param.toLowerCase() === param)
  );
}

function isSection(line: Line, param: string): line is Section {
  return isDirective(line, param) && "config" in line;
}

function valueTokens(value: Directive["value"]): string[] {
  if (typeof value === "string") return value.split(/\s+/);
  return value.map((v) => v.val);
}

function resolveIncludePaths(arg: string, ctx: ParseCtx): string[] {
  const expanded = arg.startsWith("~/")
    ? join(homedir(), arg.slice(2))
    : isAbsolute(arg)
      ? arg
      : resolve(dirname(ctx.filePath), arg);
  return globSync(expanded);
}

function parseFile(path: string): SSHConfig {
  try {
    return SSHConfig.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return new SSHConfig();
    throw err;
  }
}

function expandIncludes(config: SSHConfig, ctx: ParseCtx): SSHConfig {
  const expanded = new SSHConfig();
  for (const line of config) {
    if (isDirective(line, "include")) {
      if (ctx.depth >= MAX_INCLUDE_DEPTH) continue;
      for (const pattern of valueTokens(line.value)) {
        for (const includedPath of resolveIncludePaths(pattern, ctx)) {
          if (ctx.visited.has(includedPath)) continue;
          ctx.visited.add(includedPath);
          expanded.push(
            ...expandIncludes(parseFile(includedPath), {
              filePath: includedPath,
              depth: ctx.depth + 1,
              visited: ctx.visited,
            }),
          );
        }
      }
      continue;
    }
    expanded.push(line);
  }
  return expanded;
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  return value?.[0];
}

function hostEntry(config: SSHConfig, alias: string): SshHostEntry {
  const computed = config.compute(alias, { ignoreCase: true });
  const hostname = firstString(computed.hostname) ?? alias;
  const user = firstString(computed.user);
  const portValue = firstString(computed.port);
  const port =
    portValue === undefined ? undefined : Number.parseInt(portValue, 10);
  const entry: SshHostEntry = { alias, hostname };
  if (user !== undefined) entry.user = user;
  if (port !== undefined && Number.isFinite(port) && port > 0)
    entry.port = port;
  return entry;
}

export function parseSshConfig(
  content: string,
  filePath = join(homedir(), ".ssh", "config"),
): SshHostEntry[] {
  const config = expandIncludes(SSHConfig.parse(content), {
    filePath,
    depth: 0,
    visited: new Set([filePath]),
  });
  const entries: SshHostEntry[] = [];
  const seen = new Set<string>();
  for (const line of config) {
    if (!isSection(line, "host")) continue;
    for (const alias of valueTokens(line.value)) {
      if (alias.length === 0 || /[*?!]/.test(alias) || seen.has(alias))
        continue;
      seen.add(alias);
      entries.push(hostEntry(config, alias));
    }
  }
  return entries;
}

export function readSshHosts(): SshHostEntry[] {
  const filePath = join(homedir(), ".ssh", "config");
  if (!existsSync(filePath)) return [];
  return parseSshConfig(readFileSync(filePath, "utf8"), filePath);
}
