#!/usr/bin/env sh
# cp -rL (not symlink) because TypeScript and Bun both resolve transitive
# imports from the *real* file location: a symlink whose target sits in
# /nix/store has no adjacent node_modules, so `effect` and @effect/platform-node
# can't be found from a copied source. Copying lets resolution walk up to the
# consumer's own root node_modules where those packages live. (The drishti
# pattern — see github.com/srid/drishti.)
set -eu

make_writable_best_effort() {
  chmod -R u+w "$1" 2>/dev/null || true
}

if [ $(( $# % 2 )) -ne 0 ] || [ $# -eq 0 ]; then
  echo "usage: hydrate-kolu-packages.sh <src> <dest> [<src> <dest> ...]" >&2
  exit 1
fi

while [ $# -gt 0 ]; do
  src=$1
  dest=$2
  shift 2
  if [ ! -d "$src" ]; then
    echo "hydrate-kolu-packages.sh: source is not a directory: $src" >&2
    exit 1
  fi
  mkdir -p "node_modules/$(dirname "$dest")"
  if [ -d "node_modules/$dest" ]; then
    make_writable_best_effort "node_modules/$dest"
  fi
  rm -rf "node_modules/$dest"
  cp -rL "$src" "node_modules/$dest"
  chmod -R u+w "node_modules/$dest"
done
