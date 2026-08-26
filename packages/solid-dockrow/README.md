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
  surface="desktop"
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
  `surface` is `"desktop"` or `"touch"` — the one axis kolu's dock and its phone
  drawer differ by. Room and input both follow from it (a mouse hovers, a finger
  presses; a desktop row wears a focus ring), and every pixel of the difference
  is a column of `DOCK_ROW_SURFACE` rather than a second component.
- **`<DockSubRow>`** — a split terminal, indented one notch per hop under its
  real parent.
- **`<DockNeedsYouRow>`** — an entry in the pinned needs-you strip, at `full` or
  `icon` density.
- **`<DockSection>` · `<DockNeedsYouStrip>`** — the two CONTAINERS. They carry
  the classes the stylesheet scopes every wash and divider to, and declare the
  grid the rows subgrid into. Not optional sugar: a row outside them loses its
  attention wash silently.
- **`<PrPip>` · `<PrStateIcon>` · `<ChecksIndicator>` · `prTooltip`** — the PR
  badge and its glyphs. The row's, and the repo's only copy of them.
- **`<RecencyCell>` · `<RowLabel>`** — the two leaves the three rows share.
- **`dockRowFacts(meta)`** — the three facts a row reads off ONE terminal record
  (`agentState`, `subline`, `pr`), fused so a row's words and its PR cannot come
  from two different terminals.
- **`rowValues`** — every pure fold: `bindStatePip` (and the paint / glyph /
  motion decisions under it), `dockRowAttrs`, `rowSubline`, `annotationLine`,
  `identityColor`, `recencyMode`, `displayRecencyAt`, `paintDockRow`, the
  geometry constants, and the closed-set NARROWING (`narrowAgentState` and its
  ten sibling guards — see "Filling the bag from a flat wire").
- **`dockrow.css`** — the repo card, the row label, and the attention washes.

## Filling the bag from a flat wire

The worked case, because it is the one this package exists for. You have a wire
record with `agentState: string | null` and no `TerminalMetadata` in the browser
— your server dials padi, your browser gets a flat projection. Here is every
required prop and where its value comes from:

| prop | where it comes from |
| --- | --- |
| `pip` | `bindStatePip({ meta, attention, unread })` on the SERVER (it needs the record), shipped as a flat struct; or built field-by-field in the browser with the guards below |
| `bucket` | the `pip.variant`'s bucket, or `paintDockRow(meta, klass)` server-side. `bucket` drives `data-bucket` — a styling/e2e hook, not a paint decision — so a surface with no activity window of its own can pass the paint bucket it already has |
| `agentState` | your wire string, verbatim — `narrowAgentState(raw).attr`, or `dockRowFacts(meta).agentState` |
| `label` | `annotationLine(intent, branchLabel)` — exported; do not re-derive |
| `labelColor` | `identityColor(branchLabel)` — exported; do not re-derive |
| `subline` | `dockRowFacts(meta).subline` server-side (see below). From a flat wire: `{ text: summary ?? narrowAgentState(raw).label, fromAgent: true }` — the `summary ?? label` rule is the row's, do not drop the summary |
| `recency` | `{ mode: recencyMode(pip), text }` — you own the clock, the package owns the rest |
| `pr` | `dockRowFacts(meta).pr`, or your own `PrInfo` |
| `renderLabel` | your markdown renderer, or `(md) => md` |

**If you hold a `TerminalMetadata`** — most likely on your server, where you
dial padi — take the three record-derived facts in one call:

```ts
const { agentState, subline, pr } = dockRowFacts(meta);
```

They are three independent derivations over one record, and every row surface
needs all three. Spelled separately they are three chances to pair one
terminal's words with another terminal's PR; fused, a row's facts come from one
record by construction.

Two of those rows are the whole reason this section exists: `label` and
`labelColor` look like something you would just write, and both hide a rule.
`annotationLine` takes intent line 1 and NOT the branch when an intent exists —
never both stacked. `identityColor` hashes the key ALONE, never the set of keys
on screen, which is why the dock, a palette and a restore card paint one repo
one hue. Re-deriving either gives you a row whose words and hues differ from the
Dock's, in the package built so they cannot.

### The narrowing — the closed sets, and what an unknown state does

Your wire carries kolu's vocabulary as text, and it should: kolu's agent-state
literals do not exist as an array anywhere upstream — they live in five
per-agent packages and compose as a union — so importing them into an outline
wire spec compiles that whole schema graph into it. So narrow against the
vocabulary rather than declaring your own copy of the literals, which is a
second closed set for one fact, and the drift is silent (kolu's `satisfies
never` fences fire in kolu).

Every closed set the bag names is enumerable and guarded, from `./rowValues`:

```ts
ROW_AGENT_STATES  / isRowAgentState    PIP_VARIANTS      / isPipVariant
DOCK_ROW_BUCKETS  / isDockRowBucket    PIP_MOTION_KINDS  / isPipMotionKind
RECENCY_MODES     / isRecencyMode      PIP_GLYPH_IDS     / isPipGlyphId
```

and one fold for the common case:

```ts
narrowAgentState("awaiting_user")
// → { state: "awaiting_user", attr: "awaiting_user",
//     label: "Awaiting input", known: true }

narrowAgentState("compacting_context")   // a newer padi than your pin
// → { state: undefined, attr: "compacting_context",
//     label: "compacting_context", known: false }
```

**Unknown degrades visibly.** No fold is handed a state it cannot decide
(`state` is withheld), but the word is not dropped: it reaches
`data-agent-state` and the subline, so you read the strange word on the row.
That is kolu's own answer for an unrecognised state — rank it idle, paint it
quiet, print the word.

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

4. **The containers — use the exported ones.** A row is `grid-cols-subgrid`, and
   every wash, the active highlight and the row dividers are scoped to the
   container's class. Both are shipped as components, so neither is yours to
   spell:

   ```tsx
   <DockSection surface="desktop" repoColor={hue} header={<YourHeader />}>
     <DockRow … />
   </DockSection>

   <DockNeedsYouStrip density="full">
     <DockNeedsYouRow … />
   </DockNeedsYouStrip>
   ```

   Rendering a `<DockRow>` inside a container of your own gets you a
   structurally correct, attribute-complete row with **no violet "blocked on
   you" wash at all**, and nothing errors — which is exactly why the containers
   ship rather than being described here. If you genuinely need your own
   element, `DOCK_SECTION_CLASS` and `DOCK_NEEDS_YOU_STRIP_CLASS` are exported
   beside the grid constants so it can still land inside the rules.

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
