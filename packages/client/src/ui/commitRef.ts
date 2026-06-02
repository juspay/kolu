/** Pure helpers for reasoning about git-commit refs in the chrome.
 *  Kept out of the JSX components (Commit.tsx, IdentityRail.tsx) so the guard
 *  and the staleness comparison can't drift apart and are unit-testable. */

/** A clean, navigable git ref: a real SHA — not `dev`, not a `-dirty` working
 *  tree. The commit-link guard renders a GitHub link only for these; the
 *  staleness check trusts only these (a dev / dirty build can't false-positive
 *  as "stale"). */
export const isCleanRef = (sha: string | undefined): sha is string =>
  !!sha && sha !== "dev" && !sha.includes("-dirty");

/** True when this browser's JS build is genuinely out of step with the server:
 *  both report clean refs and they disagree. The likely cause is an old bundle
 *  served from browser cache against a freshly deployed server. Dev / dirty
 *  builds on either side return false — we only claim staleness we can prove. */
export const clientIsStale = (
  serverCommit: string | undefined,
  clientCommit: string | undefined,
): boolean =>
  isCleanRef(serverCommit) &&
  isCleanRef(clientCommit) &&
  serverCommit !== clientCommit;
