#!/usr/bin/env bash
# Every internal link and #anchor in a built site must resolve.
#
# Usage: linkcheck.sh <site-dir>   (./dist locally, the Nix build's $out in CI)
#
# Offline: external links are not fetched. Absolute links (`/surface/x#y`)
# resolve against <site-dir>. The committed Atlas (folded in at /atlas/ by the
# Nix build) is frozen history, so its own pages are not checked as sources —
# but a docs link into it still must resolve.
set -euo pipefail

site=$(realpath "${1:?usage: linkcheck.sh <site-dir>}")

exec lychee \
  --offline \
  --include-fragments \
  --root-dir "$site" \
  --index-files index.html \
  --exclude-path "^$site/atlas/" \
  --no-progress \
  --format detailed \
  "$site/**/*.html"
