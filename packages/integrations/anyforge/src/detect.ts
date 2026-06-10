/** Forge detection from a git remote URL — sync and pure.
 *
 *  No network probe, by design (Atlas note, decision D2): an async probe
 *  would race the git channel's synchronous `onEvent` contract, and
 *  auto-egress to arbitrary hosts parsed out of git remotes is a privacy
 *  decision, not an implementation detail. `gh` already resolves any
 *  GitHub-host remote it's authenticated for (GHE included) and degrades
 *  to a silent `absent` on hosts it doesn't know — the gh CLI *is* the
 *  fallback prober, so everything unrecognized maps to `github`.
 *
 *  Self-hosted Forgejo/Gitea hosts join via configuration when the
 *  Forgejo adapter lands (kolu#1240 phase 1). */

import type { ForgeKind } from "./provider.ts";

/** Hosts known to speak the Forgejo API. */
const FORGEJO_HOSTS = new Set(["codeberg.org"]);

/** Extract the lowercased host from a git remote URL. Handles the SSH
 *  shorthand (`git@host:owner/repo.git`) and every URL form
 *  (`https://host/...`, `ssh://git@host/...`). Returns null for
 *  unparseable input. */
export function parseRemoteHost(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  // URL parser first — handles https://, ssh://, git:// forms.
  try {
    const host = new URL(trimmed).hostname;
    return host ? host.toLowerCase() : null;
  } catch {
    // Not a URL — fall through to the SSH shorthand grammar.
  }
  const sshMatch = trimmed.match(/^[^@/]+@([^:/]+):/);
  return sshMatch?.[1]?.toLowerCase() ?? null;
}

/** Map a remote URL to the forge family that should resolve its PRs.
 *  Known Forgejo hosts → `forgejo`; **everything else → `github`** —
 *  including null/unparseable remotes, where dispatching to gh reproduces
 *  the established degraded behaviors (`no git remotes found` → absent). */
export function detectForge(remoteUrl: string | null): ForgeKind {
  if (remoteUrl === null) return "github";
  const host = parseRemoteHost(remoteUrl);
  return host !== null && FORGEJO_HOSTS.has(host) ? "forgejo" : "github";
}
