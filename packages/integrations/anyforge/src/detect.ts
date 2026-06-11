/** Forge-neutral remote-URL grammar. The leaf parses the host out of a git
 *  remote so a dispatcher upstream can map it to a forge — the leaf itself
 *  names no forge. Browser-safe: no node APIs. */

/** Extract the hostname from a git remote URL — both URL-shaped
 *  (`https://host/owner/repo.git`, `ssh://git@host:22/owner/repo`) and
 *  scp-shaped (`git@host:owner/repo.git`) remotes. Returns null for
 *  null/empty/unparseable input. */
export function parseRemoteHost(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  try {
    return new URL(remoteUrl).hostname || null;
  } catch {
    // scp-style `[user@]host:path` — not a valid URL, so parse by hand.
    const m = /^(?:[^@/]+@)?([^:/]+):/.exec(remoteUrl);
    return m?.[1] ?? null;
  }
}
