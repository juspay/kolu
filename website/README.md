# kolu website

Marketing + blog for [kolu](https://github.com/juspay/kolu). Astro + Tailwind
v4, deployed to <https://kolu.dev> via GitHub Pages.

## Develop

```sh
just website::dev          # HMR on http://127.0.0.1:4321
just website::nix-build    # reproducible Nix build → /nix/store/...
```

Blog posts: `src/content/blog/*.md` (schema in `src/content.config.ts`).
Frontmatter `title`, `description`, `pubDate`, optional `author` +
`authorUrl`. Don't include a leading `# ` heading — it comes from the
frontmatter `title`.

## Deploy

`.github/workflows/pages.yml` runs `nix build .#website` on every push to
`master` that touches `website/**` and publishes the result. `just ci`
builds the site too (devour-flake walks the root flake's outputs).

## Update deps

Bumping `pnpm-lock.yaml` changes the `fetchPnpmDeps` hash in
`default.nix`. `just ci::pnpm-hash-fresh` verifies both the kolu and
website hashes — paste the printed hash back in on mismatch.
