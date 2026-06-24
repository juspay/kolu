# @kolu/solid-statepip

**The shared agent-status *indicator* presentation leaf** — one SolidJS
component that folds three axes into a single glyph: the agent's coarse run-state
**core** (a spinning ring · a muted dot · a sleeping `☾`), a green **live ring**
around it when the terminal is moving bytes, and an amber **alert halo** when a
fired notification is unopened.

## What it owns

- **`<StatePip variant={…} live={…} alert={…}>`** — pure presentation. It takes
  a *precomputed* `PipVariant` for the core and two optional booleans for the
  outer axes:
  - `live` → the green `--color-ok` **ring** (the terminal is moving bytes right
    now — the old standalone live-activity dot, now folded into the indicator's
    edge);
  - `alert` → the amber `--color-attention` **halo** + pulse (an unopened
    notification — the Dock's `unread`, pulam-web's notify-class), wrapping the
    state core instead of replacing it, so you read needs-attention *and* the
    live state at once.

  Both default off, so a bare `<StatePip variant={…} />` reads as a plain pip.
  The pulse/spin animations carry `motion-reduce:animate-none` /
  `motion-safe:`, so a `prefers-reduced-motion: reduce` preference holds the
  indicator still on **every** consumer — the reduced-motion behaviour is owned
  here once, not re-spelled per surface.
- **`PipVariant`** — the core-state vocabulary (`awaiting` · `working` · `idle` ·
  `sleeping` · `empty`).
- **`pipForPaintClass`** + **`indicatorWrapperClass`** (the `./pipVariant`
  subpath) — the shared agent-paint → pip fold *and* the ring/halo class fold.
  Both kolu's Dock (`pipVariant`) and pulam-web's fleet (`pipVariantFor`) route
  their state→variant mapping through the first, and both surfaces' ring + halo
  through the second, so the indicator a given (state, live, alert) triple shows
  is defined **once** and cannot drift between the two surfaces.

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

## Consumers

- `packages/client/` — the Dock row pip, the canvas tile-title pip.
- `packages/pulam-web/` — the fleet dashboard row pip.

Each `@source`-scans this package's `src/` from its own `index.css` so the pip's
Tailwind utilities survive tree-shaking.
