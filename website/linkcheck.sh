#!/usr/bin/env bash
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
