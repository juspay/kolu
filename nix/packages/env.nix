# Shared env vars consumed by the kolu build, the devShell, and the wrapper.
# KOLU_COMMIT_HASH excluded — it busts the derivation cache on every commit.
# The build uses a placeholder; koluStamped stamps the real hash afterwards.
{ ghosttyThemes, fonts, worktreeWords, clipboard-shims }:
{
  KOLU_THEMES_JSON = "${ghosttyThemes}/themes.json";
  KOLU_FONTS_DIR = "${fonts}";
  KOLU_CLIPBOARD_SHIM_DIR = "${clipboard-shims}/bin";
  KOLU_RANDOM_WORDS = "${worktreeWords}";
}
