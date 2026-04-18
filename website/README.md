# kolu website

Marketing site and blog for [Kolu](https://github.com/juspay/kolu) — built with
[Astro](https://astro.build/), [Tailwind v4](https://tailwindcss.com/), and
MDX, deployed to GitHub Pages at <https://juspay.github.io/kolu>.

The site has its own zero-input flake so its devShell is independent of the
main kolu build.

## Develop

```sh
# From the repo root
just website::dev          # Astro dev server with HMR → http://localhost:4321
just website::check        # Astro type-check + content schema validation
just website::build        # pnpm build → ./dist (fast, local)
just website::nix-build    # nix build (reproducible) → /nix/store/...
```

Recipes run inside the website's own `nix develop` shell automatically. If
you prefer an explicit shell:

```sh
cd website && nix develop
pnpm install --ignore-workspace
pnpm dev
```

`--ignore-workspace` tells pnpm to skip the root's `pnpm-workspace.yaml`
(which lists `packages/**` only — the website is deliberately not a workspace
member to keep its deps and lockfile isolated from the main app).

## Authoring posts

Blog posts live in `src/content/blog/*.md` (or `.mdx`). Frontmatter schema is
declared in `src/content.config.ts`:

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
`website/**` (or the workflow file itself). It builds via `nix build
./website#default` and publishes the result to GitHub Pages.

CI (`just ci`) builds the website as a `website@x86_64-linux` step in the
linux lane — so a broken build fails CI before it can reach Pages.

## Updating dependencies

After `pnpm install`, if `pnpm-lock.yaml` changes, the `fetchPnpmDeps` hash
in `default.nix` must be refreshed:

```sh
just website::pnpm-hash-fresh
```

Nix will print the expected hash on mismatch — paste it back into
`default.nix` and commit both files together.

## Directory layout

```
website/
├── astro.config.mjs      # Astro config — site/base URL, integrations
├── default.nix           # Nix build (static site output at $out)
├── flake.nix             # Zero-input flake (devShell + package)
├── mod.just              # `just website::<recipe>` entrypoints
├── nix/nixpkgs.nix       # Pinned nixpkgs (mirrors root npins revision)
├── package.json
├── pnpm-lock.yaml
├── public/               # Static assets copied verbatim to dist/
├── shell.nix             # Dev shell (nodejs + pnpm + just)
└── src/
    ├── components/       # Header, Footer
    ├── content/blog/     # Blog posts (markdown + frontmatter)
    ├── content.config.ts # Content collection schema
    ├── layouts/          # BaseLayout
    ├── pages/            # index.astro, blog/index.astro, blog/[...slug].astro
    └── styles/global.css # Tailwind + design tokens + prose overrides
```
