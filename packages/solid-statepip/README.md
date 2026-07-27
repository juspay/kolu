# @kolu/solid-statepip

**The shared agent-attention presentation leaves** — the per-terminal *status
indicator* (identity glyph + state paint + activity motion + unread badge) and
the *attention summary* both surfaces roll up into.

## What it owns

- **`<StatePip variant motion bytesLive alert glyph>`** — pure presentation:
  - `glyph` → brand mark or shell `#`
  - `variant` → state paint (`text-busy` working · **full** `text-alert` violet
    `awaiting` (blocked on you) · **dimmed** violet `linger` (post-turn lull) · …)
  - `motion` → spin / glow / none (activity channel; CSS in `./statepip.css`)
  - `bytesLive` → a11y "live output" when PTY bytes are flowing
  - `alert` → amber unread corner badge

  Callers should use kolu's `bindStatePip` so surfaces cannot drift. A bare
  `<StatePip variant={…} />` is still valid.

- **`<AttentionTriplet working asking unseen sizeClass onAsking onUnseen>`** —
  the attention summary every altitude renders identically (host tab, host
  switcher row, mobile host chip, dock repo-section header), so one fact cannot
  grow four dialects. Its rule: the two **actionable** counts wear a capsule and
  become real `<button>`s when a jump handler is passed; **working** is a bare
  count + spinner and never clickable. Callers inside an already-interactive
  parent omit the handlers and get plain spans (valid HTML, same vocabulary).
  `sizeClass` is the only per-surface pixel.

- **`PipVariant`**, **`pipForPaintClass`**, box sizes, and the count classes on
  `./pipVariant` — `NEEDS_YOU_PILL_CLASS` (violet, blocked on you),
  `UNSEEN_COUNT_CLASS` (amber, finished and unopened), and `WORKING_COUNT_CLASS`
  (rust, informational). The two pills share geometry and split by hue; neither
  is the deliberately-quiet one.

## What it knows nothing about

- Agent-state → paint / motion folds (caller's `bindStatePip` / `pipMotionKind`)
- Theme hex values (`@kolu/theme` tokens)
- Layout / dock geometry (pass `class={DOCK_ROW_PIP_BOX}` etc.)

## Consumers

- `packages/client/` — dock row, dock section header, title, workspace switcher,
  host tab / switcher row / mobile host chip
