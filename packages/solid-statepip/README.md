# @kolu/solid-statepip

**The shared agent-status *pip* presentation leaf** — one SolidJS component that
renders an agent's coarse run-state as a small glyph (a filled disk · a spinning
ring · a muted dot · a sleeping `☾`).

## What it owns

- **`<StatePip variant={…}>`** — pure presentation. It takes a *precomputed*
  `PipVariant` and renders the matching shape · colour · animation. The
  pulse/spin animations carry `motion-reduce:animate-none`, so a
  `prefers-reduced-motion: reduce` preference holds the pip still on **every**
  consumer — the reduced-motion behaviour is owned here once, not re-spelled per
  surface.
- **`PipVariant`** — the variant vocabulary (`attention` · `awaiting` ·
  `working` · `idle` · `sleeping` · `empty`).
- **`pipForPaintClass`** (the `./pipVariant` subpath) — the shared agent-paint →
  pip fold. Both kolu's Dock (`pipVariant`) and pulam-web's fleet
  (`pipVariantFor`) route their state→variant mapping through it, so the pip a
  given agent state shows is defined **once** and cannot drift between the two
  surfaces.

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
