# POS-tagged word lists from WordNet for worktree branch names (ADJ-NOUN).
# Filtered to common words only (tagsense_cnt >= 2 = appeared in tagged corpus).
{ pkgs }:

let
  # Extract short (3-6 char) words with tagsense_cnt >= 2 from a WordNet index file.
  extract = file:
    pkgs.runCommand "extract-words" { } ''
      awk '/^[a-z]{3,6} /{
        for (i = NF; i >= 1; i--)
          if ($i !~ /^[0-9]{8}$/) {
            if ($i + 0 >= 2) print $1
            break
          }
      }' ${file} | sort -u > $out
    '';
in
pkgs.symlinkJoin {
  name = "worktree-words";
  paths = [ ];
  postBuild = ''
    ln -s ${extract "${pkgs.wordnet}/dict/index.adj"} $out/adjectives.txt
    ln -s ${extract "${pkgs.wordnet}/dict/index.noun"} $out/nouns.txt
  '';
}
