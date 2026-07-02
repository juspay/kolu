---
paths:
  - "{packages/client/favicon.svg,packages/client/public/icon-192.png,packages/client/public/icon-512.png,packages/client/public/icon-512-maskable.png,packages/client/index.html,packages/client/src/AboutDialog.tsx,packages/client/src/WelcomeDialog.tsx,packages/client/src/ChromeBar.tsx,packages/client/src/MobileChromeSheet.tsx,packages/client/src/terminal/useActivityAlerts.ts,packages/client/src/screenshotTerminal.ts,packages/server/src/index.ts,packages/server/src/pwaIdentity.ts,packages/server/src/pwaIdentity.test.ts,website/public/favicon.svg,website/src/layouts/BaseLayout.astro,website/src/components/Header.astro,website/src/styles/global.css,website/src/pages/index.astro,README.md}"
---

## Kolu Logo

- Treat `packages/client/favicon.svg` as the source vector. Browser/chrome uses it transparent.
- Regenerate `packages/client/public/icon-192.png`, `icon-512.png`, and `icon-512-maskable.png` after changing it. These are the PWA/Dock assets and need a rounded-square backing with safe-zone-friendly artwork.
- Keep the mark readable at 16px: no text, no thin strokes, no crowded prompt glyph.
- Verify both surfaces: browser tab favicon and macOS Dock/PWA-sized icon.
- Keep app identity as `Kolu [host]`; do not reintroduce `kolu@host` or `short_name: "kolu"`.
