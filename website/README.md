# kolu website

Marketing site and blog for [Kolu](https://github.com/juspay/kolu) — built
with [Astro](https://astro.build/), [Tailwind v4](https://tailwindcss.com/),
and MDX, deployed to GitHub Pages at <https://juspay.github.io/kolu>.

The site is exposed as `packages.${system}.website` by the root flake and
reuses the root's pinned nixpkgs (via `../nix/nixpkgs.nix` → `npins`) — no
duplicate pin, no separate flake.

## Develop

```sh
# From the repo root
just website::dev          # Astro dev server with HMR → http://localhost:4321
just website::check        # Astro type-check + content schema validation
just website::build        # pnpm build → ./dist (fast, local)
just website::nix-build    # nix build .#website (reproducible) → /nix/store/...
just website::preview      # serve the Nix-built artefact on :4321
```

Recipes run inside the root's default `nix develop` shell automatically.
If you prefer an explicit shell:

```sh
nix develop                          # from repo root
cd website
pnpm install --ignore-workspace
pnpm dev
```

`--ignore-workspace` tells pnpm to skip the root's `pnpm-workspace.yaml`
(which lists `packages/**` only — the website is deliberately not a
workspace member to keep its deps and lockfile isolated from the main app).

## Authoring posts

Blog posts live in `src/content/blog/*.md` (or `.mdx`). Frontmatter schema
is declared in `src/content.config.ts`:

```yaml
---
title: "Post title"
description: "One-liner for SEO and blog listing."
pubDate: 2026-04-17
author: "Your name" # optional; defaults to Sridhar Ratnakumar
---
```

The first `<h1>` is rendered from frontmatter, so **don't** include a `# `
heading in the body.

## Deployment

`.github/workflows/pages.yml` runs on every push to `master` that touches
`website/**` (or the workflow file itself). It runs `nix build .#website`
and publishes the result to GitHub Pages.

CI (`just ci`) builds the website as part of the `nix` step — devour-flake
walks every output of the root flake, including `packages.${system}.website`,
so a broken website build fails CI before it can reach Pages.

## Updating dependencies

After `pnpm install`, if `website/pnpm-lock.yaml` changes, the
`fetchPnpmDeps` hash in `default.nix` must be refreshed. The root's
`just ci::pnpm-hash-fresh` step verifies both the main kolu lockfile and
the website lockfile — when the declared hash no longer matches, Nix
prints the expected value; paste it back into `website/default.nix` and
commit both files together.

## Directory layout

```
website/
├── astro.config.mjs      # Astro config — site/base URL, integrations
├── default.nix           # Nix build (imported by root flake.nix)
├── mod.just              # `just website::<recipe>` entrypoints
├── package.json
├── pnpm-lock.yaml
├── public/               # Static assets copied verbatim to dist/
└── src/
    ├── components/       # Header, Footer
    ├── content/blog/     # Blog posts (markdown + frontmatter)
    ├── content.config.ts # Content collection schema
    ├── layouts/          # BaseLayout
    ├── pages/            # index.astro, blog/index.astro, blog/[...slug].astro
    └── styles/global.css # Tailwind + design tokens + prose overrides
```
