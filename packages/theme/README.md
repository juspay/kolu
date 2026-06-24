# @kolu/theme

**The one definition of the kolu colour palette** — a CSS-only package (no JS):
a single `theme.css` both browser surfaces import so the design palette resolves
identically on each.

## What it owns

- **`theme.css`** — a single `@theme { --color-* }` block. Tailwind registers
  the colour names (generating the `bg-*` / `text-*` / `border-*` utilities
  **and** the `--color-*` custom properties), so a `bg-alert` /
  `border-accent` / `text-fg-3` utility resolves to the same colour on every
  consumer. The values double as the **dark** palette; `:root:not(.dark)`
  overrides them for **light** mode.

Each surface imports it right after Tailwind:

```css
@import "tailwindcss";
@import "@kolu/theme/theme.css";
```

## What it knows nothing about

- **App-specific tokens.** `--breakpoint-sm`, `--font-sans`, and any
  surface-only token stay in each app's own `index.css` — this package is *only*
  the shared colour palette, nothing else.
- **JavaScript / components.** It ships no runtime; the lone export is
  `./theme.css`. A component that wants a colour reads the token Tailwind
  generated, it doesn't import a value from here.

## Consumers

- `packages/client/` — the on-canvas Dock + the rest of the desktop workspace.
- `packages/pulam-web/` — the fleet dashboard (`<html class="dark">` selects the
  dark values statically).

Dependency arrow points *out*: `kolu-client → @kolu/theme` and
`pulam-web → @kolu/theme`.

> The sleeping accent `--color-moonlit` (`#8895ad`) is deliberately **fixed**
> (no light-mode override) and shared with the client's dormant-tile palette
> (`packages/client/src/terminal/moonlit.ts`'s `MOONLIT.accent`). The two homes
> carry the same literal on purpose; a unit test
> (`packages/client/src/terminal/moonlit.test.ts`) pins them equal so neither
> drifts.
