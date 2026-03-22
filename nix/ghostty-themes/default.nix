# Nix derivation that produces a themes.json from all Ghostty theme files.
# Source: mbadolato/iTerm2-Color-Schemes
{ pkgs }:
let
  iterm2-color-schemes = pkgs.fetchFromGitHub {
    owner = "mbadolato";
    repo = "iTerm2-Color-Schemes";
    rev = "6c0e481e0ae001b736dc54c9fbd5567d8f972c70";
    hash = "sha256-D4h9JnL+vdOdvwBJmhPbVXV3elcyQafixKxNBbEeNns=";
  };
in
pkgs.runCommand "ghostty-themes"
{
  nativeBuildInputs = [ pkgs.python3 ];
} ''
  mkdir -p $out
  python3 ${./parse-themes.py} "${iterm2-color-schemes}/ghostty" > $out/themes.json
''
