{ pkgs }:
let
  sources = import ../npins;
  rhaiLsp = sources.rhai-lsp { inherit pkgs; };
  rhaiGrammar = pkgs.runCommand "rhai.tmLanguage.json" { } ''
    cp ${rhaiLsp}/editors/vscode/syntax/rhai.tmLanguage.json $out
  '';
  osfacts = import sources.osfacts { inherit pkgs; };

  requiredBin = package: exe: "${package}/bin/${exe}";
in
{
  KOLU_FONTS_DIR = pkgs.kolu-fonts;
  KOLU_SNAPSHOT_FONTS_DIR = pkgs.kolu-snapshot-fonts;
  KOLU_RHAI_GRAMMAR = rhaiGrammar;
  KOLU_GH_BIN = requiredBin pkgs.gh "gh";
  KOLU_OSFACTS_BIN = requiredBin osfacts "osfacts";
  KOLU_ACP_AGENT = requiredBin pkgs.kolu-acp-adapter "claude-agent-acp";
}
