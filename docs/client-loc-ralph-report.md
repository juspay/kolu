# Slimming Kolu — `solid-*` package extraction (Ralph report)

**Goal:** Reduce `packages/client/src` surface area by extracting app-agnostic
SolidJS code into reusable `@kolu/solid-*` packages under `packages/`, following
the existing `@kolu/solid-pierre` precedent.

**Metric:** Total lines of `*.ts` + `*.tsx` under `packages/client/src`
(tests included — they move with their module). Deterministic, so a single
measurement per cycle suffices (no sampling).

**Measurement command:**
```sh
find packages/client/src \( -name '*.ts' -o -name '*.tsx' \) | xargs wc -l | tail -1
```

**Constraints (from user):**
- Behaviour-preserving only — pure mechanical move + re-export.
- CI green every commit (`just check` + `just test-unit`).
- Run Linux CI locally if the `pu` box fails.

## Baseline

| Metric | Value |
|---|---|
| `client/src` LOC | **25,613** |
| `client/src` files | 189 |
| Existing `solid-*` packages | `@kolu/solid-pierre` |

## Decomposition (volatility axes — Lowy/Hickey)

Boundaries chosen so each package encapsulates one axis of change, not merely
"things that look similar":

| Package | Modules | Volatility axis | ~LOC |
|---|---|---|---|
| `@kolu/solid-icons` | `Icons.tsx` | icon-set content (icons added/removed) | 615 |
| `@kolu/solid-ui` | `Toggle`, `Kbd`, `SegmentedControl`, `Row`, `Section`, `Surface`, `stackLayers`, `Tip` | design-system / presentation | ~285 |
| `@kolu/solid-overlay` | `useAnchoredPopover`(+test), `OptionMenu` | anchored positioning / overlays | ~256 |
| `@kolu/solid-platform` | `keyboard`, `platform`, `clipboard` | browser / platform-API | ~207 |

Order = biggest-contributor-first (Ralph rule).

## Optimization log

| Cycle | Change | client/src LOC | Δ | Commit |
|---|---|---|---|---|
| 0 | baseline | 25,613 | — | — |
| 1 | extract `@kolu/solid-icons` (Icons.tsx, 38 components, 26 import sites) | 24,998 | **−615** | 6bf9f39 |
| 2 | extract `@kolu/solid-xterm` (`createXtermWebgl` — WebGL-context lifecycle out of Terminal.tsx) | 24,942 | **−56** | f39fc9d |
| 3 | extract `@kolu/solid-ui` (Toggle, Kbd, SegmentedControl, Row, Section, Surface, stackLayers, Tip; 36 sites) | 24,662 | **−280** | f4fc1e1 |
| 4 | extract `@kolu/solid-overlay` (useAnchoredPopover +test, OptionMenu; test now runs in-package) | 24,405 | **−257** | _pending_ |

## Dead ends

_(none yet)_

## Key findings

- **`solid-xterm` is an extract-and-refactor, not a clean move.** Unlike the UI
  atoms, xterm usage is complected with Kolu's session wiring in the 950-LOC
  `Terminal.tsx`. There is *no automated guard* for the #591/#606/#575 heap
  leaks — they were caught only by manual heap snapshots, and the cucumber e2e
  covers terminal *behaviour* (resize/scroll/screenshot/file-refs) but not
  disposal/memory. So a wholesale rip of the leak-critical async mount would be
  irresponsible without heap-test infrastructure. The responsible seam is the
  **WebGL-context lifecycle** (`createXtermWebgl`): the most reusable, hardest-won,
  self-contained xterm knowledge (Chrome's ~16-context limit, the `loseContext`
  canvas capture, link-layer exclusion, texture-atlas management). The
  leak-critical mount/cleanup *ordering* stays at the call site; only the WebGL
  function bodies move. The temporary `#591` zombie-context tracker stays in the
  client (it's throwaway debug scaffolding) and is inverted into the primitive via
  optional lifecycle hooks — so the library carries no Kolu debug dependency.
  Gated by 74 passing e2e scenarios (canvas multi-tile + screenshot exercise the
  WebGL paths) on top of unit + typecheck.
