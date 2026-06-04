# @kolu/surface-app — the Nix-side companion to `resolveCommit()` (src/vite.ts).
#
# A nix-built consumer (drishti) was hardcoding, across its flake + derivation +
# server wrapper, BOTH the build-commit env-var name (`"SURFACE_APP_COMMIT"`) and
# the `self.rev → short → "dev"` resolution — the build half of the freshness
# contract, re-derived downstream. This is the upstream single source so the
# consumer *composes* the stamp instead: import it from the npins-pinned surface-app
# tree (`${kolu-surface-app}/nix/commit-stamp.nix`) and reference `envVar` +
# `revFromSelf` rather than repeating the literal and the rev logic.
#
# `envVar` MUST equal `DEFAULT_COMMIT_ENV_VAR` in `src/vite.ts` — the client define
# (Vite plugin / `buildSurfaceClient`) and the server cell (`buildInfoServer`) both
# read this exact name; a drift between the TS constant and this string would stamp
# the client and server from different vars and silently break skew detection.
{ }:
rec {
  # The env var `resolveCommit()` reads and `buildInfoServer()` stamps. Single
  # source with `DEFAULT_COMMIT_ENV_VAR` (src/vite.ts) — keep the two equal.
  envVar = "SURFACE_APP_COMMIT";

  # Resolve the build commit for a flake build: the short rev when `self` carries
  # one, else `"dev"`. Mirrors `resolveCommit`'s git → `"dev"` fallback — a dirty
  # tree / non-flake build has no `self.rev`, and `"dev"` is treated as never-stale
  # by `clientIsStale`, so it never false-positives as skewed.
  revFromSelf = self:
    if self ? rev then builtins.substring 0 7 self.rev else "dev";

  # The shell line that stamps the commit into a `bun build` / `Bun.build` client
  # derivation's environment — spread into a `buildPhase` before the build runs,
  # so `resolveCommit()` reads it (the sandbox has no git, so without this the
  # client would bake `"dev"`).
  exportLine = commit: ''export ${envVar}="${commit}"'';

  # `makeWrapper` args that stamp the same commit onto the server binary, so the
  # server's `buildInfo` cell and the client bundle report the same sha.
  wrapperArgs = commit: [ "--set" envVar commit ];
}
