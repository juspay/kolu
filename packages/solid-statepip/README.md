# @kolu/solid-statepip

**The shared agent-status *indicator* presentation leaf** — one SolidJS
component that renders identity glyph + state paint + activity motion + unread
badge as a single mark.

## What it owns

- **`<StatePip variant motion bytesLive alert glyph>`** — pure presentation:
  - `glyph` → brand mark or shell `#`
  - `variant` → state paint (`text-busy` working · violet linger awaiting · …)
  - `motion` → spin / glow / none (activity channel; CSS in `./statepip.css`)
  - `bytesLive` → a11y "live output" when PTY bytes are flowing
  - `alert` → amber unread corner badge

  Callers should use kolu's `bindStatePip` so surfaces cannot drift. A bare
  `<StatePip variant={…} />` is still valid.

- **`PipVariant`**, **`pipForPaintClass`**, box sizes, and the two host-tab count
  pill classes on `./pipVariant` — `NEEDS_YOU_PILL_CLASS` (violet, blocked on you)
  and `UNSEEN_COUNT_CLASS` (amber, finished and unopened). Same geometry, split by
  hue; neither is the deliberately-quiet one.

## What it knows nothing about

- Agent-state → paint / motion folds (caller's `bindStatePip` / `pipMotionKind`)
- Theme hex values (`@kolu/theme` tokens)
- Layout / dock geometry (pass `class={DOCK_ROW_PIP_BOX}` etc.)

## Consumers

- `packages/client/` — dock row, title, workspace switcher, host pills
