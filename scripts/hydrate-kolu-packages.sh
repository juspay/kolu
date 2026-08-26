#!/usr/bin/env sh
# Materialize kolu workspace package sources into ./node_modules/@kolu/<name>.
#
# THIS IS THE CANONICAL COPY. It lives in kolu, and consumers reach it through
# the same content-addressed pin they get the package sources from:
#
#   sh ${(import ./npins).kolu}/scripts/hydrate-kolu-packages.sh $ARGV
#
# It used to live in each consumer instead — juspay/odu wrote it, juspay/olai
# copied it, and the two bodies were kept byte-identical by a comment in each
# saying so. Comment-discipline is not a mechanism: nothing failed if they
# diverged, and the failure a divergence causes (a stale copy in one repo's
# node_modules) does not look like a script bug. One copy, in the repo whose
# layout it knows, arriving with the sources it copies.
#
# Usage: hydrate-kolu-packages.sh <src1> <dest1> [<src2> <dest2> ...]
#
# Each (src, dest) pair: copy <src> to ./node_modules/<dest>. Callers pass the
# whole argv, derived once — `nix/consumer.nix`'s `hydrateArgs` emits it from a
# consumer's SEED list, so no caller re-lists the package set.
#
# cp -rL (not symlink) because TypeScript and Bun both resolve transitive
# imports from the *real* file location: a symlink whose target sits in
# /nix/store has no adjacent node_modules, so `effect` and @effect/platform-node
# can't be found from a copied source. Copying lets resolution walk up to the
# consumer's own root node_modules where those packages live. (The drishti
# pattern — see github.com/srid/drishti.)
set -eu

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
    chmod -R u+w "node_modules/$dest" 2>/dev/null || true
  fi
  rm -rf "node_modules/$dest"
  cp -rL "$src" "node_modules/$dest"
  chmod -R u+w "node_modules/$dest"
done
