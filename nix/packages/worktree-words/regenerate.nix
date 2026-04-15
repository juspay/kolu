# Regenerate worktree word lists from WordNet.
# Usage: nix build .#regenerate-worktree-words && cp result/* nix/packages/worktree-words/
{ runCommand, wordnet }:

let
  extractAwk = ''
    /^[a-z]{3,6} /{
      for (i = NF; i >= 1; i--)
        if ($i !~ /^[0-9]{8}$/) {
          if ($i + 0 >= 2) print $1
          break
        }
    }
  '';
in
runCommand "regenerate-worktree-words" { } ''
  mkdir -p $out
  awk '${extractAwk}' ${wordnet}/dict/index.adj | sort -u > $out/adjectives.txt
  awk '${extractAwk}' ${wordnet}/dict/index.noun | sort -u > $out/nouns.txt
''
