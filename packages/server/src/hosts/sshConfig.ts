/**
 * Read the user's `~/.ssh/config` and surface its concrete `Host` aliases — the
 * names a user would actually dial — so kolu can OFFER them in the "Connect to
 * host…" UI instead of making the user remember and retype each one.
 *
 * Deliberately narrow: this lists the dialable aliases, it does NOT resolve them.
 * The dial path already passes the alias verbatim to ssh (`hostConfigFor`'s
 * ad-hoc fallback), and ssh itself reads `~/.ssh/config` to resolve `HostName` /
 * `User` / `Port` / `ProxyJump`. So kolu only needs the alias list for discovery;
 * the heavy lifting stays with ssh.
 *
 * Skipped, because they are config SCOPES and not dialable hosts:
 *   - pattern aliases (`*` / `?` globs, e.g. `Host *.internal`),
 *   - negations (`!host`),
 *   - the catch-all `Host *`.
 *
 * `Include` directives are NOT followed (a rare nicety); the top-level config
 * covers the common case. Fail-soft throughout: a missing/unreadable config is a
 * normal state (most machines have no `~/.ssh/config`), so it yields `[]`.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The config path: `KOLU_SSH_CONFIG` when set (an escape hatch — point kolu at
 *  a specific config, and the hermetic-test seam), else `~/.ssh/config`. */
export function defaultSshConfigPath(): string {
  return process.env.KOLU_SSH_CONFIG || join(homedir(), ".ssh", "config");
}

/** Parse `configPath` and return its dialable `Host` aliases, in file order,
 *  deduped. See the module header for what is skipped and why. */
export function listSshConfigHosts(
  configPath: string = defaultSshConfigPath(),
): string[] {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    // No config (or unreadable) — the common case on a fresh machine.
    return [];
  }

  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    // `Host` is case-insensitive and may be written `Host x`, `Host=x`, or
    // `Host = x`. Anything after is one or more whitespace-separated aliases.
    // `HostName …` is NOT matched: the keyword must be exactly `host`, followed
    // by a separator — `HostName` has no separator after `host`.
    const m = /^\s*host[\s=]+(.+?)\s*$/i.exec(raw);
    const aliases = m?.[1];
    if (!aliases) continue;
    for (const token of aliases.split(/\s+/)) {
      if (
        !token ||
        token.startsWith("#") || // a stray inline comment token
        token.startsWith("!") || // a negated pattern
        token.includes("*") || // a glob pattern
        token.includes("?") // a single-char glob
      ) {
        continue;
      }
      if (seen.has(token)) continue;
      seen.add(token);
      hosts.push(token);
    }
  }
  return hosts;
}
