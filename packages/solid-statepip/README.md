# @kolu/solid-statepip

**The shared agent-status *indicator* presentation leaf** — one SolidJS
component that folds three axes into a single glyph: the agent's coarse run-state
**core** (a spinning ring · a muted dot · a sleeping `☾`), a thin green **live
ring** that gently sweeps around it when the terminal is moving bytes, and a
small amber **alert badge** in the corner when a fired notification is unopened.

## What it owns

- **`<StatePip variant={…} live={…} alert={…}>`** — pure presentation. It takes
  a *precomputed* `PipVariant` for the core and two optional booleans for the
  outer axes:
  - `live` → the green `--color-ok` **ring** (a thin conic-gradient arc that
    gently sweeps — the terminal is moving bytes right now; the standalone
    live-activity dot, folded into the indicator's edge **on surfaces with a
    state core** — the glyph-only rail and sub-tabs still render the standalone
    `LiveActivityDot` corner dot, which has no core to ring);
  - `alert` → a small amber `--color-attention` **corner badge** (an unopened
    notification — the Dock's `unread`, pulam-web's notify-class). A badge, NOT a
    ring: a surrounding alert ring (especially nested with the live ring) read as
    overwhelming, so the two axes use different shapes and the state core stays
    fully visible.

  Both default off, so a bare `<StatePip variant={…} />` reads as a plain pip.
  The ring + badge visuals live in **`./statepip.css`** (a conic-gradient + mask
  sweep, an absolutely-positioned badge — neither expressible as Tailwind
  utilities); both consumers `@import` it. Their motion is gated under
  `prefers-reduced-motion: reduce`, owned here once, not re-spelled per surface.
- **`PipVariant`** — the core-state vocabulary (`awaiting` · `working` · `idle` ·
  `sleeping` · `empty`).
- **`pipForPaintClass`** + the ring/badge class constants (`LIVE_RING_CLASS`,
  `ALERT_BADGE_CLASS`) on the `./pipVariant` subpath — the shared agent-paint →
  pip fold plus the overlay class names. Both kolu's Dock (`pipVariant`) and
  pulam-web's fleet (`pipVariantFor`) route their state→variant mapping through
  the fold, and both render the same overlay classes (defined once in
  `statepip.css`), so the indicator a given (state, live, alert) triple shows is
  defined **once** and cannot drift between the two surfaces.

This exists so kolu's on-canvas **Dock** and the **pulam-web** fleet dashboard
render the *byte-identical* pip — the two fleet views mirror the Dock's
agent-state UX (see `.claude/rules/dock-fleet-mirror.md`); the pip is the pixel
half of that contract.

## What it knows nothing about

- **Agent-state semantics.** It never maps an `AgentInfo['state']` to a variant
  — each surface owns its own state→variant fold and hands in the result. The
  leaf is presentation-neutral (which is why it's *not* folded into
  `@kolu/terminal-workspace`).
- **The colour values.** Colours are the `@kolu/theme` tokens
  (`bg-alert` · `border-accent` · `text-moonlit`), resolved by whichever surface
  `@import`s the theme. The leaf carries the Tailwind class names, not hexes.
- **App chrome / transport / layout.** It is a leaf: the dependency arrow points
  *out* — `kolu-client → @kolu/solid-statepip` and
  `pulam-web → @kolu/solid-statepip`, neither importing the other through it.
- **Its own box size.** The wrapper is content-sized (it fits whatever
  text/gap context it lands in); a surface that reserves a fixed column passes
  that box in via the `class` prop (the dock + fleet rows use the exported
  `DOCK_ROW_PIP_BOX` 18 px circle), so the dock's column geometry never gets
  baked into the shared leaf and inline callers stay text-sized.

## Consumers

- `packages/client/` — the Dock row pip, the canvas tile-title pip.
- `packages/pulam-web/` — the fleet dashboard row pip.

Each `@source`-scans this package's `src/` from its own `index.css` so the pip's
Tailwind utilities survive tree-shaking.
