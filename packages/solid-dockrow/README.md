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
  recencyText,
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
  recency={
    mode === "hidden"
      ? { mode }
      : { mode, text: recencyText(mode, displayRecencyAt(mode, tileTs, rowTs), now()) }
  }
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
  `identityColor`, `recencyMode`, `displayRecencyAt`, `recencyText`,
  `paintDockRow`, the geometry constants, and the closed-set NARROWING
  (`narrowRowVocab`, `narrowAgentState` and their sibling guards — see "Filling
  the bag from a flat wire").

  It is the PURE half by contract, not by intention: its import graph reaches no
  `.tsx` and no `solid-js` edge, so a server can fold rows with it without
  compiling a component library, and `rowValues.purity.test.ts` fails if a fold
  ever reaches for one.
- **`all.css`** — this package's stylesheet AND its prerequisites, in the one
  order that works. The import a consumer wants; see "What a consumer needs".
- **`dockrow.css`** — the repo card, the row label, and the attention washes, on
  their own. The piece `all.css` is composed from.

## Filling the bag from a flat wire

The worked case, because it is the one this package exists for. You have a wire
record with `agentState: string | null` and no `TerminalMetadata` in the browser
— your server dials padi, your browser gets a flat projection. Here is every
required prop and where its value comes from:

| prop | where it comes from |
| --- | --- |
| `pip` | `bindStatePip({ meta, attention, unread })` on the SERVER (it needs the record), shipped as a flat struct; or built field-by-field in the browser with the guards below |
| `bucket` | the row's ORDER bucket, NOT a fold of `pip.variant` — the two are different folds and kolu's disagree (a fresh `waiting` agent PAINTS `linger` while the order bucket ranks it `idle`). `bucket` drives `data-bucket` and the row's rank; a surface with no activity window of its own can pass `paintDockRow(meta, klass)`, which is a deliberate substitution rather than a derivation |
| `agentState` | your wire string, verbatim — `narrowAgentState(raw).attr`, or `dockRowFacts(meta).agentState` |
| `label` | `annotationLine(intent, branchLabel)` — exported; do not re-derive |
| `labelColor` | `identityColor(branchLabel)` — exported; do not re-derive |
| `subline` | `dockRowFacts(meta).subline` server-side (see below). From a flat wire: `{ text: summary ?? narrowAgentState(raw).label, fromAgent: true }` — the `summary ?? label` rule is the row's, do not drop the summary |
| `recency` | `{ mode }` when hidden, else `{ mode, text: recencyText(mode, at, now) }` — you own the clock, the package owns the words. A discriminated union: `hidden` has no `text`, and a `""` filler is not spellable |
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

**For the pip and the bucket, take all four at once.** Those guards have no text
channel to keep a strange word in — a `PipVariant` selects a CSS class, and
withholding it draws nothing, which reads as "there is nothing here" rather than
as "I don't know". So the mark IS drawn, from kolu's own default, and the word
survives beside it:

```ts
narrowRowVocab({ pip: wire.pip, bucket: wire.bucket })
// → { pip: StatePipBind; bucket: DockRowBucket }
//   & ({ known: true } | { known: false; unrecognised: { variant?, glyph?, bucket? } })
```

A UNION, so reading `unrecognised` means having checked `known` — the two are
one fact, and a `{ known: true, unrecognised: { variant: "zzz" } }` you could
build by hand would be a lie the type let you tell.

Each default is kolu's own answer, not a guess: an absent paint is the quiet
`idle` body (never `empty`, which would swallow the identity glyph), an unknown
driver is the `shell` prompt, and an unrecognised bucket ranks `idle`. Do not
spell these yourself: a hand-written fallback is silent, and nothing downstream
can then tell that one fired.

**Do not send `motion`** — the bag does not take it. It is a total function of
`variant` and `active` (`pipMotionKind`, the fold kolu's own producer runs), so
a wire carrying all three can say `spin` beside `active: false`: three fields
each honest alone and lying together. It is recomputed here from the variant
this build will actually PAINT, which after a fallback is not the one you sent.

The two arguments are SEPARATE because the two folds are. `pip.variant` is
PAINT; `bucket` is ORDER; kolu keeps them apart and they disagree.

## Two things it deliberately does NOT own

**The markdown renderer.** `renderLabel` is a required prop. The annotation line
is markdown, and a renderer costs a consumer `marked`, `dompurify`, `shiki` and
`yaml` in its *manifest* closure — real weight nothing else here needs — while
sanitisation and link policy are a different volatility from row layout. kolu
passes its inline intent renderer; a consumer that wants plain text passes
`(md) => md`. It is required rather than defaulted so the choice is a decision,
not a silent degradation.

**The clock, and ONLY the clock.** A ticking `now` is ambient app state and its
cadence is the app's call — kolu runs a 1 s tick for the wait chip (whose
sub-minute seconds must count up) and a plain `Date.now()` read for "3m ago",
deliberately different subscriptions. So `now` is a parameter.

Everything else is the package's, the WORDS included: which of the three
renderings a row gets (`recencyMode`), which timestamp that rendering means
(`displayRecencyAt`), what it says (`recencyText`), the violet capsule, and the
reserved 8ch track.

```ts
const mode = recencyMode(pip);
if (mode === "hidden") return { mode };
const at = displayRecencyAt(mode, windowRecencyAt, ownRecencyAt);
return { mode, text: recencyText(mode, at, yourClock()) };
```

The words used to be yours, and the first consumer to spell them diverged in both
modes at once — "7m" where the Dock says "5m ago", and the empty string where the
wait chip must say the dash, because a violet pill with no glyph reads as a
rendering bug rather than as "unknown". The two renderings answer a never-active
row differently, on purpose, and that is a row rule rather than a formatting
taste. `recencyText` does not accept `"hidden"`: that mode has no text, and a
`""` filler is what the `RowRecency` union exists to make unspellable.

## What a consumer needs

1. **Tailwind v4, and two lines of CSS.** That is the whole styling contract:

   ```css
   @import "tailwindcss";
   @import "@kolu/solid-dockrow/all.css";
   ```

   `all.css` brings its own prerequisites — `@kolu/solid-statepip`'s sheet, the
   `@kolu/theme` tokens every colour below resolves — in the one order that
   works, plus the `@source` directives that keep each package's utility classes
   from being tree-shaken away. Each package points Tailwind at ITSELF with a
   path relative only to itself, which is the only spelling correct from a
   workspace checkout, a `node_modules` copy and a hydrated tree alike.

   This used to be four `@import`s and two `@source`s you had to order
   correctly, and a wrong order renders a row with **no layout at all** — not a
   missing colour, no layout. That was an instruction, and an instruction that
   cannot be written correctly for every consumer's directory layout is one
   nobody can be sure they followed. It is an invariant now. kolu's own
   `index.css` reads it through this same door.

   The granular `./dockrow.css` and `@kolu/solid-statepip/statepip.css` doors
   remain — not as an escape hatch, but because they are the pieces `all.css` is
   composed from, and a surface assembling a different set legitimately reaches
   for them.

2. **`--repo-color`**, set inline per section from whatever you hash a repo to.
   Every repo-tinted surface (spine, sticky header band, name ink) reads that one
   socket. The sheet defines `--dock-edge-stripe-w` and `--repo-ink` itself.

3. **The containers — use the exported ones.** A row is `grid-cols-subgrid`, and
   every wash, the active highlight and the row dividers are scoped to the
   container's class. Both are shipped as components, so neither is yours to
   spell:

   ```tsx
   <DockSection surface="desktop" repoColor={hue} header={<YourHeaderContents />}>
     <DockRow … />
   </DockSection>

   <DockNeedsYouStrip density="full">
     <DockNeedsYouRow … />
   </DockNeedsYouStrip>
   ```

   Rendering a `<DockRow>` inside a container of your own gets you a
   structurally correct, attribute-complete row with **no violet "blocked on
   you" wash at all**, and nothing errors — which is exactly why the containers
   ship rather than being described here. There is no second door: the class names are
   deliberately NOT exported, because a receptacle that ships the step it says
   you must not miss is offering you the miss.

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
