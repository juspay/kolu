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
  KOLU_CLIPBOARD_SHIM_DIR = "${pkgs.kolu-clipboard-shims}/bin";
  # Pinned gh binary — the server's GitHub provider reads this and falls
  # back to PATH lookup when unset (dev shells, non-Nix installs). See
  # packages/server/src/meta/github.ts for the read site.
  KOLU_GH_BIN             = "${pkgs.gh}/bin/gh";
}
