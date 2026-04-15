# Regenerate themes.json from iTerm2-Color-Schemes.
# Usage: just regenerate-themes
{ runCommand, python3, iTerm2-Color-Schemes }:

runCommand "regenerate-terminal-themes"
{
  nativeBuildInputs = [ python3 ];
} ''
  mkdir -p $out
  python3 ${./parse-themes.py} "${iTerm2-Color-Schemes}/ghostty" > $out/themes.json
''
