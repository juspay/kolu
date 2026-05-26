/** SSH-config parser — extracts host aliases from `~/.ssh/config` for the
 *  command-palette "New terminal" host list. Phase 1 of kolu#951.
 *
 *  Port of Zed's `parse_ssh_config_hosts`
 *  (`/tmp/zed/crates/recent_projects/src/ssh_config.rs:17`). Same
 *  semantics:
 *    - Multi-token `Host a b c` lines yield one alias each.
 *    - Negation (`!foo`) and wildcards (`*.example`) are dropped.
 *    - Backslash line continuation is honored.
 *    - Hosts whose `HostName` resolves to a known git-provider domain
 *      (github.com, gitlab.com, …) are filtered — the user almost
 *      certainly doesn't want to ssh into a git remote.
 *    - When the block has no `HostName`, the alias itself is checked
 *      against the git-provider list as a fallback.
 *
 *  The parser is pure. Reading `~/.ssh/config` (and including-files via
 *  `Include` directives) is the caller's job. Phase 1 ignores `Include`
 *  — most users have all their hosts in the top-level config.
 */

/** Domains whose presence as either a `HostName` value or a bare `Host`
 *  alias signals "this is a git remote, not a real ssh target". */
const FILTERED_GIT_PROVIDER_HOSTNAMES = new Set<string>([
  "dev.azure.com",
  "bitbucket.org",
  "chromium.googlesource.com",
  "codeberg.org",
  "gitea.com",
  "gitee.com",
  "github.com",
  "gist.github.com",
  "gitlab.com",
  "sourcehut.org",
  "git.sr.ht",
]);

function isGitProviderDomain(host: string): boolean {
  return FILTERED_GIT_PROVIDER_HOSTNAMES.has(host.toLowerCase());
}

interface HostBlock {
  aliases: Set<string>;
  hostname: string | null;
}

/** Pull each token out of an `Host x y z` value, skipping wildcards
 *  (`*`), negations (`!x`), bare backslash continuations, and empty
 *  strings. Matches Zed's `parse_hosts`. */
function parseHosts(line: string, out: Set<string>): void {
  for (const raw of line.split(/\s+/)) {
    const token = raw.replace(/\\$/, "");
    if (!token) continue;
    if (token.startsWith("!")) continue;
    if (token.includes("*")) continue;
    if (token === "\\") continue;
    out.add(token);
  }
}

function splitKeywordAndValue(line: string): [string, string] | null {
  const m = line.match(/^(\S+)\s*(.*)$/);
  if (!m || !m[1]) return null;
  return [m[1], m[2] ?? ""];
}

/** True when a trimmed line ends with `\` — signals Host continuation. */
function hasContinuation(line: string): boolean {
  return line.trimEnd().endsWith("\\");
}

function parseHostBlocks(config: string): HostBlock[] {
  const blocks: HostBlock[] = [];
  let aliases = new Set<string>();
  let hostname: string | null = null;
  let needsContinuation = false;

  for (const rawLine of config.split("\n")) {
    const line = rawLine.trimStart();

    if (needsContinuation) {
      needsContinuation = hasContinuation(line);
      parseHosts(line, aliases);
      continue;
    }

    const kv = splitKeywordAndValue(line);
    if (!kv) continue;
    const [keyword, value] = kv;

    if (keyword.toLowerCase() === "host") {
      if (aliases.size > 0) {
        blocks.push({ aliases, hostname });
        aliases = new Set<string>();
        hostname = null;
      }
      parseHosts(value, aliases);
      needsContinuation = hasContinuation(line);
    } else if (keyword.toLowerCase() === "hostname") {
      const first = value.split(/\s+/)[0];
      hostname = first ?? null;
    }
  }

  if (aliases.size > 0) {
    blocks.push({ aliases, hostname });
  }

  return blocks;
}

/** Parse the raw text of an ssh-config file and return the sorted host
 *  alias list, with git-provider entries filtered out. */
export function parseSshConfigHosts(config: string): string[] {
  const blocks = parseHostBlocks(config);
  const hosts = new Set<string>();
  for (const block of blocks) {
    // If the block declares a HostName, let that decide whether the whole
    // block is a git remote. Otherwise fall back to checking each alias.
    const hostnameIsGit =
      block.hostname !== null ? isGitProviderDomain(block.hostname) : null;
    for (const alias of block.aliases) {
      const isGit = hostnameIsGit ?? isGitProviderDomain(alias);
      if (!isGit) hosts.add(alias);
    }
  }
  return Array.from(hosts).sort();
}
