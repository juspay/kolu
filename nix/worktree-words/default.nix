# Curated word list for worktree branch names.
# Two words are picked at random → "calm-brook", "vivid-mesa".
{ pkgs }:

pkgs.copyPathToStore ./words.txt
