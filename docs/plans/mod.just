# docs/plans — kolu's plans (legacy; migrating into the website Atlas).
#
# Imported from the root justfile as `mod plans`. Holds the gate that keeps
# the hand-curated Map of Content (index.html) honest. The CI node
# `ci::docs-moc` is a one-line delegator to `plans::check`, so the check
# lives co-located with what it guards while still gating in the pipeline.
#
# NB: in just's module system `justfile_directory()` returns the root
# justfile's dir, not this module's. Use `source_directory()` for paths
# relative to this file.

here := source_directory()

# List available recipes
default:
    @just --list plans

# Verify the Map of Content: every *.html here must be linked from index.html,
# and every link must resolve. The MOC has no generator (by design) — this is
# what forces a new plan to be registered. See
# .apm/instructions/docs.instructions.md. Pure bash+grep, no deps.
check:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{ here }}"
    fail=0
    for f in *.html; do
      [ "$f" = index.html ] && continue
      grep -qF "$f" index.html || { echo "✗ unlisted: $f not linked in index.html"; fail=1; }
    done
    while read -r t; do
      [ -f "$t" ] || { echo "✗ dead link: index.html → $t"; fail=1; }
    done < <(grep -oE 'href="\./[^"]+\.html"' index.html | sed -E 's#href="\./##; s#"$##' | sort -u)
    if [ "$fail" -ne 0 ]; then
      echo "docs/plans Map of Content out of sync — fix index.html (see .apm/instructions/docs.instructions.md)."
      exit 1
    fi
    echo "✓ docs/plans Map of Content in sync"
