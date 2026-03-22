# Nix derivation that produces a themes.json from curated Ghostty theme files.
# Source: mbadolato/iTerm2-Color-Schemes
{ pkgs }:
let
  iterm2-color-schemes = pkgs.fetchFromGitHub {
    owner = "mbadolato";
    repo = "iTerm2-Color-Schemes";
    rev = "6c0e481e0ae001b736dc54c9fbd5567d8f972c70";
    hash = "sha256-D4h9JnL+vdOdvwBJmhPbVXV3elcyQafixKxNBbEeNns=";
  };

  # Curated list of popular themes (names must match filenames in ghostty/ dir)
  themes = [
    "Atom One Dark"
    "Ayu"
    "Ayu Light"
    "Catppuccin Latte"
    "Catppuccin Mocha"
    "Dracula"
    "Everforest Dark Hard"
    "Flexoki Dark"
    "Flexoki Light"
    "GitHub Dark"
    "GitHub Light Default"
    "Gruvbox Dark"
    "Gruvbox Light"
    "Kanagawa Wave"
    "Material Ocean"
    "Monokai Pro"
    "Nord"
    "Rose Pine"
    "Rose Pine Moon"
    "Snazzy"
    "Solarized Dark Patched"
    "TokyoNight Night"
    "TokyoNight Storm"
    "Tomorrow Night"
    "Ubuntu"
  ];
in
pkgs.runCommand "ghostty-themes"
{
  nativeBuildInputs = [ pkgs.python3 ];
} ''
  mkdir -p $out
  python3 ${./parse-themes.py} \
    "${iterm2-color-schemes}/ghostty" \
    ${pkgs.lib.concatMapStringsSep " " (t: ''"${t}"'') themes} \
    > $out/themes.json
''
