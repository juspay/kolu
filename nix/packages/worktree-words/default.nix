# POS-tagged word lists from WordNet for worktree branch names (ADJ-NOUN).
# Filtered to common words only (tagsense_cnt >= 2 = appeared in tagged corpus).
#
# Uses pre-generated static word lists (checked into the repo) to avoid pulling
# in the wordnet package during evaluation, which adds ~290ms to nix develop.
#
# To regenerate from WordNet:
#   nix build .#regenerate-worktree-words && cp result/* nix/packages/worktree-words/
{ runCommand }:

runCommand "worktree-words" { } ''
  mkdir -p $out
  cp ${./adjectives.txt} $out/adjectives.txt
  cp ${./nouns.txt} $out/nouns.txt
''
