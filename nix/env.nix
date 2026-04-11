# Shared env vars consumed by the kolu build, the devShell, and the wrapper.
# KOLU_COMMIT_HASH excluded — it busts the derivation cache on every commit.
# The build uses a placeholder; koluStamped stamps the real hash afterwards.
{ pkgs }:
{
  KOLU_THEMES_JSON        = "${pkgs.kolu-ghostty-themes}/themes.json";
  KOLU_FONTS_DIR          = "${pkgs.kolu-fonts}";
  KOLU_CLIPBOARD_SHIM_DIR = "${pkgs.kolu-clipboard-shims}/bin";
  KOLU_RANDOM_WORDS       = "${pkgs.kolu-worktree-words}";
}
