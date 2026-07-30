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

# Everything in `check` except the build — `astro sync && tsc --noEmit` (the
# generated Astro types and TS/TSX files) plus the `node --test` pass over the
# stable-inline-styles normalizer (the #1209 cross-note-locality invariant,
# which a build can't prove on its own). Factored out so `check-sync` gets it
# without paying for an extra build: check-sync's own fresh build already serves
# as the MDX/JSX compile gate.
_static: install
    cd {{ here }} && {{ nix_shell }} sh -c 'pnpm check && node --test build/*.test.mjs'

# Full check — the static checks above plus a real build, which is what catches
# MDX/JSX compile errors (malformed inline components, block-body arrow exports,
# `//` comments glued above an `export const`, …). Run both so
# `just atlas::check` is a true "all errors" gate.
#
# The build lands in a throwaway dir OUTSIDE the worktree and is discarded: only
# `atlas::build` may write the committed dist/. See `check-sync` for why.
[doc('Types + a real build + the build-helper unit tests (writes nothing)')]
check: _static
    #!/usr/bin/env bash
    set -euo pipefail
    scratch=$(mktemp -d "${TMPDIR:-/tmp}/atlas-check.XXXXXX")
    trap 'rm -rf "$scratch"' EXIT
    cd "{{ here }}" && {{ nix_shell }} pnpm build --outDir "$scratch/site"

# Build the self-contained Atlas → ./dist (committed for Code-tab preview).
# `build.format: "file"` emits flat <slug>.html with relative links; the
# stable-inline-styles integration then canonicalizes each page's inlined <head>
# CSS (see astro.config.mjs / #1209). Just build and commit dist/.
build: install
    cd {{ here }} && {{ nix_shell }} pnpm build

# CI gate (wired in as ci::atlas-sync): types + a real build + fail if the
# committed dist/ is stale — i.e. a note changed but the generated HTML wasn't
# regenerated and committed. The fresh build below doubles as the compile gate,
# so this catches type AND MDX/build errors, not just staleness. This is the
# enforcement behind the .apm Atlas rule.
#
# NON-MUTATING BY CONSTRUCTION — the gate never writes the worktree. Every CI
# lane on a platform shares one checkout, so a gate that rebuilt the tracked
# docs/atlas/dist/ *in place* would hand any concurrent lane a half-written
# tree: nix reported it both as `Path 'docs/atlas/dist' … is not tracked by Git`
# (paths momentarily absent from the index) and as a store path whose "contents
# have changed" mid-copy — see the flaky-test tracker. So both builds land in a
# scratch dir outside the worktree and the answer comes from comparing
# directories, not from asking git what changed. Nothing is written, so there is
# nothing to repair afterwards either.
#
# It then enforces a second invariant: HTML generation must be IDEMPOTENT — a
# pure function of source, not of the build host. The gate rebuilds under a
# scrambled timezone + locale; if any output moves, the build leaked a
# host-dependent value (a TZ-formatted date, a LANG-ordered sort, …) and would
# render differently per machine — churning dist/ and producing spurious diffs.
#
# A third invariant — CROSS-NOTE LOCALITY (editing one note must not rewrite an
# unrelated note's inlined CSS, #1209) — is enforced structurally by the
# stable-inline-styles build integration and unit-tested under `check`, not here:
# a build-based "add a note, diff the rest" probe is vacuous (Astro's chunking
# doesn't reliably reshuffle on a synthetic note), so it would sail green and
# hide the regression rather than catch it.
[doc('CI gate: fail if the committed dist/ is stale or host-dependent (writes nothing)')]
check-sync: _static
    #!/usr/bin/env bash
    set -euo pipefail
    # Deliberately NOT trap-cleaned: on the failure path both sides of a
    # divergence must outlive the gate. The tracker's atlas-sync byte-shrink
    # flake was twice diagnosed from luck and once lost outright, when a
    # diagnostic rebuild overwrote the only copy of the divergent bytes. Here the
    # committed side is safe in git and the fresh side is in $scratch, so they
    # survive by construction — the only rule is not to delete them.
    scratch=$(mktemp -d "${TMPDIR:-/tmp}/atlas-check-sync.XXXXXX")
    cd "{{ here }}"

    {{ nix_shell }} pnpm build --outDir "$scratch/fresh"
    if delta=$(diff -rq "$scratch/fresh" dist); then
      echo "✓ docs/atlas/dist in sync with source"
    else
      echo "✗ docs/atlas/dist is out of sync — run 'just atlas::build' and commit docs/atlas/dist/ in the same change."
      printf '%s\n' "$delta"
      echo "→ both sides preserved: freshly built $scratch/fresh vs committed {{ here }}/dist"
      exit 1
    fi

    echo "→ idempotency: rebuilding under a scrambled TZ + locale…"
    {{ nix_shell }} env TZ=America/Los_Angeles LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8 pnpm build --outDir "$scratch/scrambled"
    if delta=$(diff -rq "$scratch/fresh" "$scratch/scrambled"); then
      echo "✓ docs/atlas/dist is idempotent (host-independent)"
    else
      echo "✗ non-idempotent build — dist/ depends on the host TZ/locale. Make HTML generation a pure function of source (pin timeZone/locale)."
      printf '%s\n' "$delta"
      echo "→ both builds preserved: $scratch/fresh vs $scratch/scrambled"
      exit 1
    fi
    rm -rf "$scratch"
