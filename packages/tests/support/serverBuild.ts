/** Which of the two server builds a start runs: `base` is `KOLU_SERVER`;
 *  `next` is `KOLU_SERVER_NEXT_BUILD`, the same server with a different padi
 *  build id — what `deployKoluServer` deploys. A Nix-built server bakes
 *  its id (`--set PADI_BUILD_ID`), so there `next` is a second build; the
 *  source wrapper reads it from the env a start passes, so there `next` is
 *  the same wrapper with another id. */
export type ServerBuild = "base" | "next";

/** THE PADI BUILD, for the source wrapper: it bakes nothing, so its binder and
 *  the padi it spawns (`inheritParentEnv`) read the identity from the env a
 *  start passes, and the two builds differ only by the id — the one axis a
 *  deploy's build check converges on. The id and the commit are one fact
 *  (`readBakedIdentity` refuses either alone), so both are given: `commit` is
 *  the checkout the source run is built from, the same for both builds, as
 *  the two Nix builds share theirs. A Nix-built server's own `--set` overrides
 *  both. */
export function padiBuildEnv(
  build: ServerBuild,
  commit: string,
): Record<"PADI_BUILD_ID" | "PADI_COMMIT_HASH", string> {
  return { PADI_BUILD_ID: `e2e-${build}`, PADI_COMMIT_HASH: commit };
}
