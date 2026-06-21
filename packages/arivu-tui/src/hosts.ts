/**
 * Pure fleet-host discovery for `arivu-tui fleet` — turn the user's flags (and,
 * optionally, an `~/.ssh/config`) into the ordered list of endpoints to dial.
 * No I/O lives here: the caller reads the ssh-config file and hands its CONTENT
 * in, so this whole module is unit-tested with no filesystem. `fleet.ts` dials
 * each `FleetHost` (the local socket or an ssh target) and stamps its `label`
 * onto every mirrored row — the (host, terminalId) key that keeps two boxes'
 * identical terminal ids distinct.
 */

/** One endpoint the fleet dials. `ssh: null` is the local arivu socket (the
 *  `local` group); a string is the ssh target `connectArivuViaHost` provisions. */
export interface FleetHost {
  /** Group header + the host half of the (host, id) key. "local" or the ssh target. */
  label: string;
  /** The ssh target for `connectArivuViaHost`, or null for the local socket. */
  ssh: string | null;
}

/** The reserved label for the local arivu (the endpoint `--socket` would dial). */
export const LOCAL_LABEL = "local";

/**
 * Host alias names from an `~/.ssh/config`'s `Host` stanzas, with wildcard
 * patterns dropped. We only enumerate dial-able ALIASES — ssh itself resolves
 * each alias's HostName/User/Port when we shell out, so this never needs the
 * full ssh-config grammar (HostName, Match, Include …): just the `Host` lines.
 * (A consequence: `Include`d files are not followed — pass those hosts with
 * explicit `--host`. A convenience source, not the source of truth.)
 *
 * Drops any token carrying a glob (`*` / `?`) or a negation (`!`): `Host *`
 * sets defaults for every host, not a real machine to dial. Order-preserving
 * and de-duplicated.
 */
export function parseSshConfigHosts(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split("\n")) {
    // A `Host` keyword (case-insensitive), then its patterns, separated by
    // whitespace or `=` — the two forms ssh accepts. Only `Host` names aliases;
    // `HostName`/`Match`/etc. are deliberately ignored (see the doc comment).
    const match = /^[ \t]*host[ \t=]+(.+?)[ \t]*$/i.exec(rawLine);
    if (!match) continue;
    for (const token of (match[1] ?? "").split(/[ \t]+/)) {
      if (token === "" || /[*?!]/.test(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/**
 * Merge the discovered endpoints into the ordered dial list: `local` first
 * (unless `includeLocal` is false), then every explicit `--host` in order, then
 * the ssh-config aliases — de-duplicated by ssh target so a host named on both
 * the command line and in the config is dialed once. `local` is purely the
 * socket endpoint; an ssh target literally named `local` still dials over ssh.
 */
export function resolveFleetHosts(opts: {
  explicit: string[];
  fromSshConfig: string[];
  includeLocal: boolean;
}): FleetHost[] {
  const hosts: FleetHost[] = [];
  if (opts.includeLocal) {
    hosts.push({ label: LOCAL_LABEL, ssh: null });
  }
  const seen = new Set<string>();
  for (const ssh of [...opts.explicit, ...opts.fromSshConfig]) {
    if (ssh === "" || seen.has(ssh)) continue;
    seen.add(ssh);
    hosts.push({ label: ssh, ssh });
  }
  return hosts;
}
