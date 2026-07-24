# kolu website

Marketing, docs, blog, and changelog for [kolu](https://github.com/juspay/kolu).
Astro + Tailwind v4, deployed to <https://kolu.dev> via GitHub Pages.

## Develop

```sh
just website::dev          # HMR on http://127.0.0.1:4321
just website::search-preview # production build + Pagefind search preview
just website::nix-build    # reproducible Nix build → /nix/store/...
```

Docs: `src/content/docs/*.{md,mdx}`, rendered at root-level URLs by
`src/pages/[slug].astro` (`quickstart.mdx` → `/quickstart`). Required
frontmatter is `title`; `description`, `order`, `section`, and `koluHero` are
optional. `order` controls sidebar and previous/next order; `section` groups the
sidebar. Docs render through `DocsLayout`, which provides the native site header,
sidebar, mobile docs menu, on-this-page TOC, previous/next links, Pagefind
metadata, and code-copy buttons.

Adding, renaming, or deleting a product-docs page also requires the same slug
change in `packages/client/src/ui/DocLink.tsx`. Its set-equality test keeps
in-app documentation links synchronized with the website.

Docs component kit: `src/components/docs/Aside.astro`, `Card.astro`,
`CardGrid.astro`, `LinkCard.astro`, and `Steps.astro`. Use normal Markdown first;
reach for these when the page needs callouts, repeated cards, navigation cards,
or numbered setup steps. Product screenshots can live under `public/` and be
wrapped in `<figure class="doc-shot">`.

Search: `pnpm build` runs `astro build && pagefind --site dist`. Search is not
available during `astro dev`; use `just website::search-preview` to build the
index and serve `dist` locally.

Code fences: every fence language used in `src/` is **derived and preloaded**
into shiki at build start (`src/shiki-config.mjs`, on the shared
`scripts/fence-langs.mjs` scanner; see the Atlas note
`bug-shiki-grammar-load-race`), so a fence in any real language just works, an
unbundled/typo'd language fails the build loudly, and a fence in a language
*new to the project* added while `astro dev` runs needs a dev-server restart
(the list is derived when the config evaluates; fences in already-used
languages work immediately). Unit pins live in `test/*.test.mjs`, run by
`just website::check` and the Nix build's `checkPhase`.

Blog posts: `src/content/blog/*.{md,mdx}` (schema in `src/content.config.ts`).
Frontmatter `title`, `description`, `pubDate`, optional `author` +
`authorUrl`. Don't include a leading `# ` heading — it comes from the
frontmatter `title`.

Changelog: `src/content/changelog/*.mdx`, rendered at `/changelog`
(`src/pages/changelog.astro`), schema in `src/content.config.ts`. One entry
per release (`1-0-0.mdx`, frontmatter `version` + `date: YYYY-MM-DD`) plus a
perpetual dateless `unreleased.mdx` (`version: Unreleased`) that `/be` appends
to under `### Added` / `Fixed` / `Changed` / `Heads-up` on every user-facing
PR. `/release X.Y.Z` stamps `unreleased.mdx` into a dated entry. The page lists
releases newest-first with Unreleased on top; the Pages deploy fires on the
`website/**` change.

## Deploy

`.github/workflows/pages.yml` runs `nix build ./website` on every push to
`master` that touches `website/**` and publishes the result. `just ci`
builds the site too (`ci::website-nix` builds every website-flake output).

## Update deps

Bumping `pnpm-lock.yaml` changes the `fetchPnpmDeps` hash in
`default.nix`. `just ci::pnpm-hash-fresh` verifies both the kolu and
website hashes — paste the printed hash back in on mismatch.
