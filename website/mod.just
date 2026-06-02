# Kolu website — Astro static site.
#
# Imported from the root justfile as `mod website`. The website is built
# by the root flake (packages.${system}.website); there is no separate
# website flake. Recipes reuse the root's default devShell.
#
# NB: in just's module system `justfile_directory()` returns the root
# justfile's dir, not this module's. Use `source_directory()` for paths
# relative to this file.

here := source_directory()
root := here / ".."
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop ' + root + ' --accept-flake-config -c' }

# List available recipes
default:
    @just --list website

# Install pnpm deps for the website (standalone, not part of the root workspace)
install:
    cd {{ here }} && {{ nix_shell }} pnpm install --ignore-workspace

# Live preview with HMR (astro dev) → http://127.0.0.1:4321
dev: install
    cd {{ here }} && {{ nix_shell }} pnpm dev

# Type-check .astro files and TypeScript
check: install
    cd {{ here }} && {{ nix_shell }} pnpm check

# Build the static site via pnpm (fast, local) — emits ./dist
build: install
    cd {{ here }} && {{ nix_shell }} pnpm build

# Build the static site via Nix (reproducible) — prints the store path
nix-build:
    nix build {{ root }}#website --print-out-paths

# Serve the Nix-built site locally to inspect the deploy artefact
preview:
    #!/usr/bin/env bash
    set -euo pipefail
    out=$(nix build {{ root }}#website --print-out-paths --no-link)
    echo "Serving $out on http://127.0.0.1:4321"
    cd {{ here }} && {{ nix_shell }} pnpm exec astro preview --port 4321

# Build the site, then flatten ONLY the Atlas output: <slug>/index.html ->
# <slug>.html. Astro's build.format is global (directory|file|preserve), so to
# leave the blog's URLs untouched we post-process just the Atlas subtree. The
# flattened, self-contained files are what get committed + previewed in the
# Code tab. Atlas slugs are flat, so this is a single level.
build-atlas: install
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ here }}
    {{ nix_shell }} pnpm build
    cd dist/atlas
    for d in */; do
      [ -f "${d}index.html" ] || continue
      mv "${d}index.html" "${d%/}.html"
      rm -rf "$d"
    done
    # Rewrite Atlas-internal links to relative flattened filenames so the committed
    # pages navigate in kolu's Code tab. Astro emits absolute /atlas/... paths, which
    # the iframe resolves against the server root (not the sibling file); the live site
    # keeps those absolute routes (it builds via nix, not this recipe).
    sed -i -E 's#href="/atlas/([^"/]+)"#href="./\1.html"#g; s#href="/atlas"#href="./index.html"#g' *.html
    echo "Atlas flattened + relinked to relative <slug>.html"
