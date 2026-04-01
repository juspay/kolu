# Nix derivation that produces a themes.json from all Ghostty theme files.
# Source: mbadolato/iTerm2-Color-Schemes (managed by nixtamal)
{ pkgs }:
let
  inputs = import ../tamal { };
in
pkgs.runCommand "ghostty-themes"
{
  nativeBuildInputs = [ pkgs.python3 ];
} ''
  mkdir -p $out
  python3 ${./parse-themes.py} "${inputs.iTerm2-Color-Schemes}/ghostty" > $out/themes.json
''
