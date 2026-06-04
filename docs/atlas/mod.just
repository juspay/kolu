# kolu Atlas — self-contained Astro project (internal, not published).
#
# Imported from the root justfile as `mod atlas`. Notes are authored as
# markdown/MDX in src/content/atlas/ and rendered to a committed, self-contained
# dist/ that previews in kolu's Code tab. Build locally; there is no deploy.
#
# NB: in just's module system `justfile_directory()` returns the root justfile's
# dir, not this module's. Use `source_directory()` for paths relative to here.

here := source_directory()
root := here / "../.."
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop ' + root + ' --accept-flake-config -c' }

# List available recipes
default:
    @just --list atlas

# Install pnpm deps (standalone project, outside the root workspace)
install:
    cd {{ here }} && {{ nix_shell }} pnpm install --ignore-workspace

# Live preview with HMR (astro dev) → http://127.0.0.1:4331
dev: install
    cd {{ here }} && {{ nix_shell }} pnpm dev

# Full check — astro type-check AND a real build. `astro check` alone does NOT
# catch MDX/JSX compile errors (malformed inline components, block-body arrow
# exports, `//` comments glued above an `export const`, …); only the build does.
# Run both so `just atlas::check` is a true "all errors" gate.
check: install
    cd {{ here }} && {{ nix_shell }} sh -c 'pnpm check && pnpm build'

# Build the self-contained Atlas → ./dist (committed for Code-tab preview).
# `build.format: "file"` already emits flat <slug>.html with relative links, so
# there is no post-processing — just build and commit dist/.
build: install
    cd {{ here }} && {{ nix_shell }} pnpm build

# CI gate (wired in as ci::atlas-sync): full check (types + build) + fail if the
# committed dist/ is stale — i.e. a note changed but the generated HTML wasn't
# regenerated and committed. Depends on `check` so the gate catches type AND
# MDX/build errors, not just staleness. This is the enforcement behind the .apm
# Atlas rule.
#
# It then enforces a second invariant: HTML generation must be IDEMPOTENT — a
# pure function of source, not of the build host. The gate rebuilds under a
# scrambled timezone + locale; if any output moves, the build leaked a
# host-dependent value (a TZ-formatted date, a LANG-ordered sort, …) and would
# render differently per machine — churning dist/ and producing spurious diffs.
check-sync: check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{ root }}"
    if git diff --quiet -- docs/atlas/dist; then
      echo "✓ docs/atlas/dist in sync with source"
    else
      echo "✗ docs/atlas/dist is out of sync — run 'just atlas::build' and commit docs/atlas/dist/ in the same change."
      git --no-pager diff --stat -- docs/atlas/dist
      exit 1
    fi
    echo "→ idempotency: rebuilding under a scrambled TZ + locale…"
    ( cd "{{ here }}" && {{ nix_shell }} sh -c 'TZ=America/Los_Angeles LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8 pnpm build' )
    if git diff --quiet -- docs/atlas/dist; then
      echo "✓ docs/atlas/dist is idempotent (host-independent)"
    else
      echo "✗ non-idempotent build — dist/ depends on the host TZ/locale. Make HTML generation a pure function of source (pin timeZone/locale)."
      git --no-pager diff --stat -- docs/atlas/dist
      git checkout -- docs/atlas/dist
      exit 1
    fi
