{ pkgs }:
let
  sources = import ../npins;
  rhaiLsp = sources.rhai-lsp { inherit pkgs; };
  rhaiGrammar = pkgs.runCommand "rhai.tmLanguage.json" { } ''
    cp ${rhaiLsp}/editors/vscode/syntax/rhai.tmLanguage.json $out
  '';
  osfacts = import sources.osfacts { inherit pkgs; };
in
{
  KOLU_FONTS_DIR = pkgs.kolu-fonts;
  KOLU_SNAPSHOT_FONTS_DIR = pkgs.kolu-snapshot-fonts;
  KOLU_RHAI_GRAMMAR = rhaiGrammar;
  KOLU_GH_BIN = "${pkgs.gh}/bin/gh";
  KOLU_OSFACTS_BIN = "${osfacts}/bin/osfacts";
  KOLU_ACP_AGENT = "${pkgs.kolu-acp-adapter}/bin/claude-agent-acp";
}
