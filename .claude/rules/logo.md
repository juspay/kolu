---
paths:
  - "{packages/client/favicon.svg,packages/client/public/icon-192.png,packages/client/public/icon-512.png,packages/client/public/icon-512-maskable.png,packages/client/index.html,packages/client/src/AboutDialog.tsx,packages/client/src/WelcomeDialog.tsx,packages/client/src/ChromeBar.tsx,packages/client/src/MobileChromeSheet.tsx,packages/client/src/terminal/useActivityAlerts.ts,packages/client/src/screenshotTerminal.ts,packages/client/src/kaval/KavalInfoDialog.tsx,packages/server/src/index.ts,packages/server/src/pwaIdentity.ts,packages/server/src/pwaIdentity.test.ts,packages/padi/logo.svg,packages/kaval/logo.svg,packages/kaval/README.md,website/default.nix,website/public/favicon.svg,website/public/padi-logo.svg,website/public/kaval-logo.svg,website/src/**,README.md}"
---

## Kolu Logo

- Treat `packages/client/favicon.svg` as the source vector. Browser/chrome uses it transparent.
- Regenerate `packages/client/public/icon-192.png`, `icon-512.png`, and `icon-512-maskable.png` after changing it. These are the PWA/Dock assets and need a rounded-square backing with safe-zone-friendly artwork.
- Keep the mark readable at 16px: no text, no thin strokes, no crowded prompt glyph.
- Verify both surfaces: browser tab favicon and macOS Dock/PWA-sized icon.
- Keep app identity as `Kolu [host]`; do not reintroduce `kolu@host` or `short_name: "kolu"`.

## Website Palette

- Keep the website palette in sync with the Kolu logo. When `packages/client/favicon.svg` changes colour, update the website tokens in `website/src/styles/global.css` and any non-CSS consumers such as the OG RGB tuple in `website/src/site.ts`.
- Treat the logo as three colour roles on the website: the middle step is the primary action/link/hover colour; the top step is the formatting accent for code, prompts, markers, and warnings; the bottom step is the body/detail accent for rules, tips, quotes, diagram streams, and live/success accents.
- Use the website's palette variables (`--color-kolu-logo-*`, `--color-kolu-primary*`, `--color-kolu-top*`, `--color-kolu-bottom*`) instead of duplicating raw hex values or reintroducing old amber/purple/violet site tokens.
- If a website diagram or page represents Kolu, Padi, or Kaval, use the relevant program logo asset from `website/public/` rather than drawing an unrelated placeholder mark.

## Padi Logo

- Treat `packages/padi/logo.svg` as the source vector for Padi. The website copies it to `website/public/padi-logo.svg`.
- Keep the Padi SVG background transparent. Let the consuming surface provide any tile or panel behind it.

## Kaval Logo

- Treat `packages/kaval/logo.svg` as the source vector for Kaval. The website copies it to `website/public/kaval-logo.svg`, and the app imports it in `KavalInfoDialog`.
- Keep the Kaval SVG background transparent. Let the consuming surface provide any tile or panel behind it.
- Keep it icon-like, not wordmark-like: no long text, no tiny labels, no dense terminal clusters. It must read at 24px in the Kaval dialog and at favicon-adjacent sizes.
- Preserve the meaning: Kaval is the PTY daemon that guards/watches terminals. A simple prompt, shield/watch shape, and a small session cue are enough.
