/**
 * SSH host discovery — list aliases from `~/.ssh/config` so the kolu
 * command palette can offer "New terminal on `$host`".
 *
 * Implementation: parse `~/.ssh/config` directly (cheap, no fork) for
 * the `Host` directive entries, filtering wildcards like `Host *` and
 * negations (`!foo`). For each candidate, `ssh -G $host` could
 * resolve actual connect params (Hostname / Port / User) — but for
 * the prototype we just list the literal alias.
 *
 * **Why server-side, not client-side**: pre-implementation review
 * finding K. The client is browser-shaped; reading `~/.ssh/config`
 * from the browser is impossible. The server already owns "ssh
 * subprocess spawning" (that's what `HostSession` does), so the host
 * list belongs on the same axis as that capability. Exposed via the
 * `server.listSshHosts` oRPC procedure.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SshHost {
  alias: string;
}

/** Strip wildcards/negations from a `Host` line's space-separated
 *  patterns and return the literal alias candidates. */
function aliasesFromHostLine(value: string): string[] {
  return value
    .split(/\s+/)
    .filter(
      (s) =>
        s.length > 0 &&
        !s.startsWith("!") &&
        !s.includes("*") &&
        !s.includes("?"),
    );
}

/**
 * Parse `~/.ssh/config` and return literal `Host` aliases. Missing
 * config file → empty list (graceful).
 *
 * Limitations (R-3): `Include` directives aren't followed; `Match`
 * blocks are ignored; per-host wildcards beyond `*` aren't expanded.
 * The literal-aliases set is sufficient for the command-palette MVP.
 */
export function parseSshConfig(): SshHost[] {
  const path = join(homedir(), ".ssh", "config");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e: unknown) {
    // File absent is expected; any other error is a real problem.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: SshHost[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;
    // Match "Host " (case-insensitive), permitting tabs.
    const m = /^Host\s+(.+)$/i.exec(trimmed);
    if (!m) continue;
    const value = m[1];
    if (!value) continue;
    for (const alias of aliasesFromHostLine(value)) {
      if (!seen.has(alias)) {
        seen.add(alias);
        out.push({ alias });
      }
    }
  }
  return out;
}
