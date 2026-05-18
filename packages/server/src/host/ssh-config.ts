/**
 * Minimal `~/.ssh/config` parser.
 *
 * The OpenSSH config grammar is rich (wildcards, Match blocks, include
 * directives, port forwarding, identity files, …) but we only need the
 * `Host` block aliases and their `HostName`/`User`/`Port` for v0 — enough
 * to enumerate the hosts the user has already set up to SSH into, so
 * Kolu's "New terminal" picker can list them.
 *
 * Anything fancier (Match, Include, wildcards) is intentionally ignored:
 * the v0 picker lists explicit Host aliases only. Users who rely on
 * wildcard hosts can still launch SSH manually inside a local terminal;
 * the picker just won't pre-populate them.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SshHostEntry {
  /** The alias (the value after `Host`). Used as the stable hostId in
   *  TerminalCreateInput and saved sessions. Must be unique. */
  alias: string;
  /** Resolved hostname (from `HostName`, or the alias if absent). */
  hostname: string;
  /** SSH user, if explicitly configured. */
  user?: string;
  /** SSH port, if explicitly configured. */
  port?: number;
}

/** Parse the content of an SSH config file into a list of host entries.
 *  Lines starting with `#`, blank lines, and unknown keys are silently
 *  skipped. Wildcard aliases (`Host *`, `Host *.example.com`) and the
 *  catch-all `Host *` block are excluded from the v0 host list. */
export function parseSshConfig(content: string): SshHostEntry[] {
  const entries: SshHostEntry[] = [];
  let current: SshHostEntry | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    // OpenSSH allows `Key Value` or `Key=Value`. Split on the first run
    // of whitespace or `=` so the regex's greedy `\S+` can't swallow the
    // separator into the key.
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=?\s*(.*)$/);
    if (!match) continue;
    const key = match[1]?.toLowerCase();
    const value = match[2]?.trim() ?? "";
    if (!key) continue;

    if (key === "host") {
      // A `Host` line may declare multiple aliases separated by whitespace.
      // We emit one entry per alias, ignoring any that contain wildcard
      // characters (`*`, `?`, `!`). The body's keys (HostName/User/Port)
      // are applied to the *last* alias on the line — matches the common
      // case of `Host alias` and degrades safely for `Host a b c` (only
      // `c` gets the body, which is what OpenSSH would treat anyway when
      // looking up `a` or `b` later via fallthrough).
      if (current) entries.push(current);
      current = null;
      const aliases = value
        .split(/\s+/)
        .filter((a) => a.length > 0 && !/[*?!]/.test(a));
      if (aliases.length === 0) continue;
      const lastAlias = aliases[aliases.length - 1];
      if (!lastAlias) continue;
      // Emit the leading aliases now with bare defaults; the trailing
      // one becomes `current` and accumulates body keys.
      for (const alias of aliases.slice(0, -1)) {
        entries.push({ alias, hostname: alias });
      }
      current = { alias: lastAlias, hostname: lastAlias };
      continue;
    }

    if (!current) continue;
    if (key === "hostname") current.hostname = value;
    else if (key === "user") current.user = value;
    else if (key === "port") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) current.port = parsed;
    }
  }

  if (current) entries.push(current);
  return entries;
}

/** Read and parse `~/.ssh/config`. Returns an empty array if the file
 *  doesn't exist or can't be read — the picker just shows "Local" in
 *  that case. */
export function readSshHosts(): SshHostEntry[] {
  const path = join(homedir(), ".ssh", "config");
  try {
    const content = readFileSync(path, "utf8");
    return parseSshConfig(content);
  } catch {
    return [];
  }
}
