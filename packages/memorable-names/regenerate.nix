# Regenerate words.json from WordNet.
# Usage: just regenerate  (from this directory)
{ pkgs ? import ../../nix/nixpkgs.nix { } }:

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
pkgs.runCommand "regenerate-memorable-names" { nativeBuildInputs = [ pkgs.jq ]; } ''
  adj=$(awk '${extractAwk}' ${pkgs.wordnet}/dict/index.adj | sort -u)
  nouns=$(awk '${extractAwk}' ${pkgs.wordnet}/dict/index.noun | sort -u)
  mkdir -p $out
  jq -n \
    --argjson adjectives "$(echo "$adj" | jq -R . | jq -s .)" \
    --argjson nouns "$(echo "$nouns" | jq -R . | jq -s .)" \
    '{adjectives: $adjectives, nouns: $nouns}' \
    > $out/words.json
''
