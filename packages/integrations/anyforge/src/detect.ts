/** Forge-neutral remote-URL grammar. The leaf parses the host out of a git
 *  remote so a dispatcher upstream can map it to a forge — the leaf itself
 *  names no forge. Browser-safe: no node APIs. */

/** Extract the hostname from a git remote URL — both URL-shaped
 *  (`https://host/owner/repo.git`, `ssh://git@host:22/owner/repo`) and
 *  scp-shaped (`git@host:owner/repo.git`) remotes. Returns null for
 *  null/empty/unparseable input. */
export function parseRemoteHost(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  // `new URL` parses an scp-style remote (`codeberg.org:owner/repo.git`) as an
  // opaque URL whose *scheme* is the host and whose hostname is empty — so a
  // try/catch alone never reaches the scp parser. Only trust a non-empty
  // hostname from `URL`; otherwise fall through to the scp grammar below.
  try {
    const host = new URL(remoteUrl).hostname;
    if (host) return host; // URL already lowercases the hostname
  } catch {
    // Not URL-shaped at all — fall through to the scp parser.
  }
  // scp-style `[user@]host:path` — not a (useful) URL, so parse by hand.
  // Lowercase so literal host matches (`codeberg.org`) aren't case-fragile,
  // matching `URL.hostname`'s normalization on the URL-shaped path.
  const m = /^(?:[^@/]+@)?([^:/]+):/.exec(remoteUrl);
  return m?.[1]?.toLowerCase() ?? null;
}
