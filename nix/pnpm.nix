# The pnpm that every Nix BUILDER runs — exposed as `pkgs.pnpm-build` by
# nix/overlay.nix, so a builder never names `pkgs.pnpm_10` directly.
#
# Identical to `pkgs.pnpm_10` except for one wrapped default: the reporter.
# Wrapping the TOOL rather than each derivation's `env` is what makes the
# setting unmissable — `pnpmConfigHook` ships no pnpm of its own ("'pnpm'
# binary not found in PATH"), so whatever is on `nativeBuildInputs` IS the pnpm
# that runs, at every site, including the `fetchPnpmDeps` fetchers that have no
# `env` of their own to merge into.
#
# `shell.nix` deliberately keeps the UNWRAPPED `pkgs.pnpm_10`: a developer at a
# TTY wants pnpm's live progress tree. This is build-only.
#
# ── Why `npm_config_reporter` ────────────────────────────────────────────────
# pnpm's default reporter draws a live progress TREE and redraws it with
# cursor-up escapes. Nix runs builders on a pty, so pnpm takes that branch — and
# the redraw ERASES the failing package's own output: `tsc` prints its
# diagnostic, the next frame overwrites the line, and `nix log` ends at a bare
# `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` with the actual error gone, unrecoverable
# short of rebuilding by hand with `--keep-failed`. That is not theoretical: a
# remote host failed to provision, and neither the card ("'nix build' exited
# with code 1") nor `nix log` could say why, because the one line that named the
# cause had been drawn over. `append-only` streams each line once and never
# redraws, so the diagnostic survives into `nix log`.
#
# It has to be the ENV var rather than a `--reporter` flag: the root `typecheck`
# / `build` scripts shell out to a NESTED `pnpm -r`, which a flag on the outer
# invocation never reaches. An env var is inherited by every descendant.
#
# `--set-default`, not `--set`, so a caller that deliberately asks for another
# reporter still wins.
{ symlinkJoin, makeWrapper, pnpm_10 }:
symlinkJoin {
  name = "pnpm-build-${pnpm_10.version}";
  paths = [ pnpm_10 ];
  nativeBuildInputs = [ makeWrapper ];
  postBuild = ''
    wrapProgram $out/bin/pnpm --set-default npm_config_reporter append-only
  '';
  # Forward the WHOLE passthru rather than the three attributes today's callers
  # happen to read (`fetchPnpmDeps` wants `version` + `nodejs`; the config hook
  # wants `configHook`). Enumerating them made the "drop-in for `pnpm_10`" claim
  # false the moment nixpkgs grew one we hadn't listed — `fetchDeps` was already
  # `false` here while `pnpm_10.fetchDeps` was `true`, so a future consumer
  # reaching for the package-level fetcher API would have silently got the wrong
  # answer. Forwarding wholesale keeps the wrapper attribute-compatible as
  # nixpkgs evolves; `symlinkJoin` does not carry `version`, so re-add it.
  passthru = pnpm_10.passthru // { inherit (pnpm_10) version; };
}
