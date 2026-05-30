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
| 4 | extract `@kolu/solid-overlay` (useAnchoredPopover +test, OptionMenu; test now runs in-package) | 24,405 | **−257** | 2678d46 |
| 5 | extract `@kolu/platform` (keyboard, os, clipboard — framework-agnostic, no `solid-` prefix; 23 sites) | 24,201 | **−204** | ffe6fdf |
| — | fix: register the 5 new packages in `default.nix` build fileset + README | 24,201 | 0 | 3092585 |

**Final: 25,613 → 24,201 LOC (−1,412, −5.5%); 189 → 174 files.**
6 reusable packages now sit under `packages/` (5 new + the pre-existing
`solid-pierre` precedent).

## Dead ends

- **Full `solid-xterm` lifecycle rip.** Investigated lifting the whole xterm
  mount/dispose out of `Terminal.tsx`. Rejected: the async mount is a minefield
  of heap-leak fixes (#591/#606/#575) with *no automated guard* — only the
  WebGL-context sub-concern was safe to move. See Key findings.
- **Extracting `webglTracker.ts` into the package.** Rejected: it's explicitly
  *temporary* debug scaffolding ("remove when #591 is fixed"). Enshrining
  throwaway instrumentation as a package API is the wrong boundary (Hickey). It
  stays in the client; the primitive inverts it via optional hooks.
- **"Subpath exports break the production build."** A red herring. The nix build
  failed to resolve `@kolu/solid-ui/stackLayers`, which *looked* like a subpath-
  export problem — but `tsc`, the dev server, the local prod build, and Node's
  own resolver all handled it. The real cause: `default.nix`'s `src` fileset is
  an explicit allowlist and the 5 new package dirs weren't listed, so they were
  absent from the sandbox. Fixed by registering them. **Lesson: a new
  `packages/<x>` dir must be added to the `default.nix` fileset or the nix
  build silently can't see it.**
- **Candidates left in the client (diminishing returns).** `ModalDialog`
  (imports `canvas/activeTerminal`), `CodeContextMenu` (Kolu code menu),
  `lineRef` (entangled with `useLineSelection`/`CodeView`), `stickyModifiers`
  (Kolu mobile key-bar feature). All carry Kolu-domain coupling — extracting
  them is refactor work, not a clean move, so they're out of scope under the
  behaviour-preserving constraint.

## Verification

Every CI gate run locally and green on the final branch:
`typecheck` (`pnpm -r`), `biome lint`, `unit` (server+client+solid-overlay),
`fmt-check`, `nix build` (server+client), `pnpm-hash-fresh`,
`surface-example-build`, `smoke` (boots packaged binary, `/api/health` 200),
and e2e (106 scenarios across terminal/canvas/screenshot/sub-terminal +
command-palette/keyboard-shortcuts). The WebGL extraction specifically rides
the canvas-multi-tile and screenshot e2e paths.

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
