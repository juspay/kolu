# Shared env vars consumed by the kolu build, the devShell, and the wrapper.
# KOLU_COMMIT_HASH excluded — it busts the derivation cache on every commit.
# The build uses a placeholder; koluStamped stamps the real hash afterwards.
#
# Where possible, pass derivation references directly instead of
# "${drv}/subpath" string interpolation — this defers store path
# resolution from Nix eval time to realization time (~350ms savings).
{ pkgs }:
{
  KOLU_FONTS_DIR          = pkgs.kolu-fonts;
  # Pinned gh binary — the server's GitHub provider consumes this directly.
  # Required, not optional: github.ts throws at startup if unset. Set here so
  # both the packaged wrapper (default.nix) and the dev shell (shell.nix)
  # pick it up via `koluEnv`.
  KOLU_GH_BIN             = "${pkgs.gh}/bin/gh";
}
