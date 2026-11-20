/** Extract the hostname from a git remote URL — both URL-shaped
 *  (`https://host/owner/repo.git`, `ssh://git@host:22/owner/repo`) and
 *  scp-shaped (`git@host:owner/repo.git`) remotes. Returns null for
 *  null/empty/unparseable input. */
export function parseRemoteHost(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  // WHATWG `URL` parses an scp-style remote (`codeberg.org:owner/repo.git`)
  // as an opaque URL whose *scheme* is the host and whose hostname is empty,
  // so only a non-empty hostname is a URL-shaped answer.
  const urlHost = URL.parse(remoteUrl)?.hostname;
  if (urlHost) return urlHost.toLowerCase();
  const scpHost = /^(?:[^@/]+@)?([^:/]+):/.exec(remoteUrl)?.[1];
  return scpHost?.toLowerCase() ?? null;
}
