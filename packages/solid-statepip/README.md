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

- **`<AttentionTriplet active asking unseen viewing sizeClass onAsking onUnseen>`** —
  the attention summary every altitude renders identically (host tab, host
  switcher row, mobile host chip, dock repo-section header), so one fact cannot
  grow four dialects. Its rule: the two **actionable** counts wear a capsule and
  become real `<button>`s when a jump handler is passed; **active** is a bare
  count + spinner and never clickable. A capsule falls back to a plain span
  wherever its surface has nowhere to send you — a caller inside an
  already-interactive parent omits the handlers (valid HTML, same vocabulary),
  and a host tab passes no `onUnseen` because switching to the machine is what
  clears that count. `viewing` says the caller is LOOKING at the scope, and the
  unseen suppression lives here rather than as an `active ? 0 : count` ternary
  re-spelled at every call site. `sizeClass` is the only per-surface pixel.

- **`<NeedsYouCapsule>`** — the violet silhouette with arbitrary content, for a
  surface that wants the shape carrying something other than a count (the dock
  wait chip carries a duration). Reach for it instead of composing
  `NEEDS_YOU_PILL_CLASS` with your own padding.

- **`PipVariant`**, **`pipForPaintClass`**, box sizes, and the count classes on
  `./pipVariant` — `NEEDS_YOU_PILL_CLASS` (violet, blocked on you),
  `UNSEEN_COUNT_CLASS` (amber, finished and unopened), and `ACTIVE_COUNT_CLASS`
  (rust, informational — `active`, not `working`: the leg counts settling agents
  and printing shells too). The two pills share geometry and split by hue;
  neither is the deliberately-quiet one.

## What a consumer needs

Two lines:

```css
@import "tailwindcss";
@import "@kolu/solid-statepip/all.css";
```

`all.css` carries its own prerequisites — the `@kolu/theme` tokens every colour
here resolves — and the `@source` that keeps the pip's Tailwind utility classes
from being tree-shaken away. It points Tailwind at this package with a path
relative only to ITSELF, which is the only spelling that is correct from a
workspace checkout, a `node_modules` copy and a hydrated tree alike.

`./statepip.css` remains the granular door — not as an escape hatch, but because
it is the piece `all.css` is composed from. On its own it under-renders: the
utility classes go, and the colours have no tokens to resolve. Reach for it only
when you are assembling the prerequisites yourself.

(A consumer rendering the whole Dock row imports `@kolu/solid-dockrow/all.css`
instead, which brings this one with it.)

## What it knows nothing about

- Agent-state → paint / motion folds (caller's `bindStatePip` / `pipMotionKind`)
- Theme hex values (`@kolu/theme` tokens)
- Layout / dock geometry (pass `class={DOCK_ROW_PIP_BOX}` etc.)

## Consumers

- `packages/client/` — dock row, dock section header, title, workspace switcher,
  host tab / switcher row / mobile host chip
