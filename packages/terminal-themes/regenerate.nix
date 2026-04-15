# Regenerate themes.json from iTerm2-Color-Schemes.
# Usage: just regenerate  (from this directory)
{ pkgs ? import ../../nix/nixpkgs.nix { }
, iTerm2-Color-Schemes
}:

pkgs.runCommand "regenerate-terminal-themes"
{
  nativeBuildInputs = [ pkgs.python3 ];
} ''
  mkdir -p $out
  python3 ${./parse-themes.py} "${iTerm2-Color-Schemes}/ghostty" > $out/themes.json
''
