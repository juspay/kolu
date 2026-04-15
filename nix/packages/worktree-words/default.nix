# POS-tagged word lists from WordNet for worktree branch names (ADJ-NOUN).
# Filtered to common words only (tagsense_cnt >= 2 = appeared in tagged corpus).
#
# Single runCommand instead of symlinkJoin + 2 separate runCommands to reduce
# Nix evaluation overhead (fewer derivations to instantiate).
{ runCommand, wordnet }:

let
  # Extract short (3-6 char) words with tagsense_cnt >= 2 from a WordNet index file.
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
runCommand "worktree-words" { } ''
  mkdir -p $out
  awk '${extractAwk}' ${wordnet}/dict/index.adj | sort -u > $out/adjectives.txt
  awk '${extractAwk}' ${wordnet}/dict/index.noun | sort -u > $out/nouns.txt
''
