---
paths:
  - "{website/src/content/docs/**,packages/client/src/ui/DocLink.tsx}"
---

## Doc links — one registry, every surface

In-app links to kolu.dev product docs are owned by **one leaf module**:
`packages/client/src/ui/DocLink.tsx`.

- **Touch a doc page's existence or name** (add / rename / delete under
  `website/src/content/docs/*.mdx`) → update `DOC_SLUGS` in `DocLink.tsx` in the
  **same change**. The set-equality test in `DocLink.test.ts` fails both ways
  when they drift.
- **Link to docs from the UI only through `DocLink` / `docUrl`.** Never hand-roll
  a `https://kolu.dev/...` href (or any other `kolu.dev` literal) under
  `packages/client/src`. The grep law in `DocLink.test.ts` bans it outside
  `DocLink.tsx` itself. Button-chrome sites take `docUrl(slug)` for the href and
  keep their own styling; inline "learn more" text uses `<DocLink slug={…}>`.
- Tips that point at a docs page set optional `doc?: DocSlug` on the tip entry
  (`settings/tips.ts`); `TipBanner` renders the link when present.
