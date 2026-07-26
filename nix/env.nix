# Shared env vars consumed by the kolu build, the devShell, and the wrapper.
# KOLU_COMMIT_HASH excluded — it busts the derivation cache on every commit.
# The build uses a placeholder; koluClientDist stamps the real hash afterwards.
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
  # ONE definition — same store path as `nix build .#osfacts` / `nix run ./osfacts`.
  osfacts = import ../osfacts { inherit pkgs; };
in
{
  KOLU_FONTS_DIR = pkgs.kolu-fonts;
  # Official Rhai TextMate grammar, pinned through npins and exposed as a file
  # so Vite can lazy-load it without vendoring an upstream snapshot.
  KOLU_RHAI_GRAMMAR = rhaiGrammar;
  # Pinned gh binary — the server's GitHub provider consumes this directly.
  # Required, not optional: github.ts throws at startup if unset. Set here so
  # both the packaged wrapper (default.nix) and the dev shell (shell.nix)
  # pick it up via `koluEnv`.
  KOLU_GH_BIN = "${pkgs.gh}/bin/gh";
  # osfacts — the single OS process/socket fact sampler padi's port scan spawns
  # (OSF2). Same footing as `KOLU_GH_BIN`: a required absolute path baked by Nix,
  # present in the packaged wrappers AND the dev shell, with no PATH fallback in
  # the reader. Lives here rather than only in default.nix because
  # `portScan.live.test.ts` runs under bare vitest and never sees the padi
  # wrapper — the drift that made every live test throw when the bake was
  # wrapper-only.
  KOLU_OSFACTS_BIN = "${osfacts}/bin/osfacts";
}
