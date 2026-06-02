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

# Type-check .astro/.mdx + TypeScript
check: install
    cd {{ here }} && {{ nix_shell }} pnpm check

# Build the self-contained Atlas → ./dist (committed for Code-tab preview).
# `build.format: "file"` already emits flat <slug>.html with relative links, so
# there is no post-processing — just build and commit dist/.
build: install
    cd {{ here }} && {{ nix_shell }} pnpm build
