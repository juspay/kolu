# Shared env vars consumed by the kolu build, the devShell, and the wrapper.
# KOLU_COMMIT_HASH excluded — it busts the derivation cache on every commit.
# The build uses a placeholder; koluStamped stamps the real hash afterwards.
#
# Where possible, pass derivation references directly instead of
# "${drv}/subpath" string interpolation — this defers store path
# resolution from Nix eval time to realization time (~350ms savings).
{ pkgs }:
let
  sources = import ../npins;
  rhaiLsp = sources.rhai-lsp { inherit pkgs; };
  rhaiGrammar = pkgs.runCommand "rhai.tmLanguage.json" { } ''
    cp ${rhaiLsp}/editors/vscode/syntax/rhai.tmLanguage.json $out
  '';
in
{
  KOLU_FONTS_DIR          = pkgs.kolu-fonts;
  # Official Rhai TextMate grammar, pinned through npins and exposed as a file
  # so Vite can lazy-load it without vendoring an upstream snapshot.
  KOLU_RHAI_GRAMMAR       = rhaiGrammar;
  # Pinned gh binary — the server's GitHub provider consumes this directly.
  # Required, not optional: github.ts throws at startup if unset. Set here so
  # both the packaged wrapper (default.nix) and the dev shell (shell.nix)
  # pick it up via `koluEnv`.
  KOLU_GH_BIN             = "${pkgs.gh}/bin/gh";
}
# padi's darwin port-scan helper, on the SAME footing as `KOLU_GH_BIN` above: a
# required value baked by Nix, present in the packaged wrapper AND the dev shell,
# with no PATH fallback in the reader.
#
# It lives here rather than only in `default.nix` because of a regression CI caught
# and a linux box never could: `portScan.live.test.ts` runs under bare `vitest`, not
# through padi's wrapper, so on darwin every live scan threw
# "KOLU_PORT_SCAN_HELPER is not set" — 9 tests, all from that one line. The previous
# `ps`+`lsof` implementation needed no env, so the dependency arrived silently with
# the helper. `koluEnv` is exactly the seam that keeps wrapper and dev shell in step.
#
# Darwin-only, because the helper is: linux reads `/proc` directly and the derivation
# evaluates to `null` there, so an unconditional attribute would be a broken path.
// pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
  KOLU_PORT_SCAN_HELPER =
    "${pkgs.callPackage ../packages/padi/native { }}/bin/kolu-port-scan-darwin";
}
