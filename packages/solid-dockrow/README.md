# @kolu/solid-dockrow

**kolu's Dock terminal row, whole** — the two-line row the on-canvas Dock is
built from, its indented split row, its needs-you entry, and the stylesheet that
paints all three.

`@kolu/solid-statepip` was the first act of this story: the status *indicator*
pulled out so a fleet mirror could render the identical pip. This is the second.
A mirror that wanted a terminal list still had to invent the rest of the row —
the annotation line, the status words, the wait chip, the repo card, the violet
"blocked on you" wash — and inventing it is how two surfaces end up disagreeing
about the same fleet. Now there is one row, and kolu's Dock renders through it
like any other consumer.

```tsx
import { DockRow } from "@kolu/solid-dockrow";
import {
  bindStatePip,
  displayRecencyAt,
  recencyMode,
  rowSubline,
} from "@kolu/solid-dockrow/rowValues";
import { activePr } from "@kolu/padi-client/surface";

const pip = bindStatePip({ meta, attention, unread });
const mode = recencyMode(pip);

<DockRow
  id={id}
  density="desktop"
  pip={pip}
  bucket={bucket}
  agentState={agent?.state}
  label={label}
  labelColor={annotationColor}
  renderLabel={(md) => <Markdown markdown={md} />}
  subline={rowSubline(meta)}
  pr={activePr(meta)}
  recency={{ mode, text: format(displayRecencyAt(mode, tileTs, rowTs)) }}
  onSelect={() => focus(id)}
/>;
```

Part of the kolu monorepo — `"@kolu/solid-dockrow": "workspace:*"`.

## What it owns

- **`<DockRow>`** — the full two-line row: `indicator · annotation · recency`
  over `[PR pip] status words`, on a three-track subgrid. It carries the shared
  `[data-dock-row]` attribute contract the stylesheet's washes key on, the repo
  stripe, the active highlight, the sleeping recede, and the two-line reserve
  that keeps row height constant so nothing reflows when a row lights up.
  `density` is `"desktop"` or `"touch"` — the ONE axis kolu's dock and its phone
  drawer differ by, and every pixel of that difference is a column of the
  density table rather than a second component.
- **`<DockSubRow>`** — a split terminal, indented one notch per hop under its
  real parent.
- **`<DockNeedsYouRow>`** — an entry in the pinned needs-you strip, at `full` or
  `icon` density.
- **`<PrPip>` · `<PrStateIcon>` · `<ChecksIndicator>` · `prTooltip`** — the PR
  badge and its glyphs. The row's, and the repo's only copy of them.
- **`<RecencyCell>` · `<RowLabel>`** — the two leaves the three rows share.
- **`rowValues`** — every pure fold: `bindStatePip` (and the paint / glyph /
  motion decisions under it), `dockRowAttrs`, `rowSubline`, `recencyMode`,
  `displayRecencyAt`, `paintDockRow`, and the geometry constants.
- **`dockrow.css`** — the repo card, the row label, and the attention washes.

## Two things it deliberately does NOT own

**The markdown renderer.** `renderLabel` is a required prop. The annotation line
is markdown, and a renderer costs a consumer `marked`, `dompurify`, `shiki` and
`yaml` in its *manifest* closure — real weight nothing else here needs — while
sanitisation and link policy are a different volatility from row layout. kolu
passes its inline intent renderer; a consumer that wants plain text passes
`(md) => md`. It is required rather than defaulted so the choice is a decision,
not a silent degradation.

**The clock.** `recency` arrives as `{ mode, text }` with the text already
formatted. A ticking `now` is ambient app state, and the cadence is the app's
call — kolu runs a 1 s tick for the wait chip (whose sub-minute seconds must
count up) and a plain `Date.now()` read for "3m ago". What the package still
owns is everything that is not the clock: which of the three renderings a row
gets (`recencyMode`), which timestamp that rendering means
(`displayRecencyAt`), the violet capsule, and the reserved 8ch track.

## What a consumer needs

1. **Tailwind v4.** The components spell utility classes. Point Tailwind at this
   package's sources or they are tree-shaken away:

   ```css
   @source "../../solid-dockrow/src";
   ```

2. **`@kolu/theme`.** Every colour resolves a theme token (`--color-alert`,
   `--color-attention`, `--color-surface-1`, `--color-fg-3`, …). Import it, and
   `@kolu/solid-statepip`'s sheet, before this one:

   ```css
   @import "tailwindcss";
   @import "@kolu/theme/theme.css";
   @import "@kolu/solid-statepip/statepip.css";
   @import "@kolu/solid-dockrow/dockrow.css";
   ```

3. **`--repo-color`**, set inline per section from whatever you hash a repo to.
   Every repo-tinted surface (spine, sticky header band, name ink) reads that one
   socket. The sheet defines `--dock-edge-stripe-w` and `--repo-ink` itself.

4. **The section grid.** A row is `grid-cols-subgrid`, so the container around it
   declares the tracks:

   ```tsx
   <section class={`dock-cards-section grid ${DOCK_ROW_GRID} ${DOCK_ROW_GAP} pl-3 pr-3`}>
   ```

## Why it depends on `@kolu/padi-client`

The row's folds read `TerminalMetadata` deeply — the active arm, the sleeping
arm, the restore target, the intent, the PR. Restating that as a narrower
"row value" type would be a large parallel shape whose only job is to drift from
the real one. The consumer this package exists for already dials `padiSurface`,
so the browser-safe client face costs it nothing it does not already install —
and `anyforge` (the PR badge's vocabulary) is already inside that manifest
closure. What it does NOT depend on is `@kolu/padi`, the daemon: the arrow
points at the *client* face, never at the PTY host.

One consequence to know before you compile it: `@kolu/padi-client/surface`
declares the whole `padiSurface` spec, whose types reach `@kolu/surface`'s
server-side modules, and those name `node:` builtins. This package's own
`tsconfig.json` therefore carries `"types": ["node"]`, and yours needs
`@types/node` in the program that compiles these sources. It costs a consumer of
`@kolu/padi-client` nothing new — that program already compiles the same spec —
but it is the kind of thing better read here than discovered as a `TS2591`.

## The attention feeds the wash needs

The violet "blocked on you" emphasis is not computed from the `terminals`
collection. It comes off two other members of the same surface — the `urgency`
cell and the `activity` stream — folded into `TerminalAttention { klass, live }`
by **`@kolu/padi-client/attention`**, which is where `bindStatePip`'s `attention`
argument comes from. Read that module's header for the three altitudes (per
terminal, per host, per scope) and why the class is never re-derived on the
client from a second input.
