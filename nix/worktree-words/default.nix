# Extract short common English words from scowl for worktree branch names.
# Produces a newline-delimited word list (e.g. "calm", "brook", "vale").
# The server picks two at random → "calm-brook".
{ pkgs }:

pkgs.runCommand "worktree-words" { } ''
  cat ${pkgs.scowl}/share/dict/wamerican.{10,20,35} \
    | grep -E '^[a-z]{3,6}$' \
    | sort -u \
    > $out
''
