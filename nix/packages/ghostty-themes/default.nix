# Nix derivation that produces a themes.json from all Ghostty theme files.
# Source: mbadolato/iTerm2-Color-Schemes (managed by npins, passed via overlay)
{ runCommand, python3, iTerm2-Color-Schemes }:

runCommand "ghostty-themes"
{
  nativeBuildInputs = [ python3 ];
} ''
  mkdir -p $out
  python3 ${./parse-themes.py} "${iTerm2-Color-Schemes}/ghostty" > $out/themes.json
''
