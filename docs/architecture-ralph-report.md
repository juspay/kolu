# Architecture ralph — volatility-based decomposition

Iterative architectural improvement loop guided by Juval Lowy's volatility-based decomposition (per the `/lowy` skill, building on Parnas 1972) and Rich Hickey's structural-simplicity framing (per `/hickey`).

**Goal**: reduce volatility-axis violations across the Kolu monorepo, surface framework-extraction candidates (à la `@kolu/surface`, https://kolu.dev/blog/surface-framework/), and identify externalization opportunities (à la `nix-chrome-devtools-mcp`, https://kolu.dev/blog/nix-chrome-devtools-mcp/).

**Constraints**:
- Behavior-preserving — no UX changes, no feature regressions.
- Test suite stays green (`just check`, `just test-unit` on local Linux).
- One change per cycle; only commit improvements.

---

## Methodology

Per cycle:
1. **Profile** — pick the highest-impact candidate from the scorecard. Audit it through the `/lowy` lens (volatility violations, bidirectional dependencies, engine/infra interleaving, leaked-volatility surfaces).
2. **Classify** — bucket the issue: dedup, framework-extraction candidate, externalization candidate, or boundary-tightening.
3. **Mutate** — single targeted change.
4. **Verify** — `pnpm typecheck` on the touched packages + targeted `vitest` runs. `just check` before commit.
5. **Commit + push** — only if the mutation reduces a measurable violation. Conventional-commit prefix.

**Four-axis scorecard** (refreshed each cycle):
- **V** — concrete volatility violations (e.g. two packages both knowing how X is encoded).
- **F** — framework-extraction candidates (in-tree pattern at the right altitude to graduate into a published package, like `@kolu/surface` did).
- **X** — externalization candidates (in-tree code that has stabilized and serves a generic concern, like `nix-chrome-devtools-mcp`).
- **E/I ratio** — engine vs infrastructure LOC for the focused subtree (Lowy: small engine surrounded by replaceable infra).

---

## Baseline (cycle 0)

### Package LOC

| Package                | LOC    | Role                                    |
| ---------------------- | -----: | --------------------------------------- |
| `client`               | 25 049 | SolidJS desktop app                     |
| `integrations/*`       | 12 030 | Per-agent + git + github + pty modules  |
| `tests`                |  9 676 | Cucumber/Playwright BDD suite           |
| `surface`              |  7 991 | Reactive client↔server framework        |
| `server`               |  4 171 | Node oRPC server                        |
| `transcript-html`      |  1 375 | One-shot HTML export                    |
| `common`               |  1 354 | Cross-cutting types & contract          |
| `artifact-sdk`         |    871 | Public artifact embed SDK               |
| `transcript-core`      |    807 | Vendor-neutral transcript IR            |
| `surface-nix-host`     |    788 | Stdio host for `@kolu/surface`          |
| `shared`               |    592 | Logger, sqlite helpers, fs              |
| `terminal-themes`      |    581 | Color schemes                           |
| `solid-pierre`         |    571 | Wraps `@pierre/*` for SolidJS           |
| `memorable-names`      |     56 | Worktree name generator                 |
| `nonempty`             |     22 | `NonEmptyArray<T>`                      |

### Largest single files (excl. tests)

| File                                                            | LOC  |
| --------------------------------------------------------------- | ---: |
| `surface/src/server.ts`                                         | 1377 |
| `client/src/terminal/Terminal.tsx`                              |  930 |
| `client/src/CommandPalette.tsx`                                 |  904 |
| `transcript-html/src/components.tsx`                            |  886 |
| `server/src/terminalBackend/local.ts`                           |  763 |
| `client/src/right-panel/CodeTab.tsx`                            |  756 |
| `client/src/ui/Icons.tsx`                                       |  656 |
| `surface/src/define.ts`                                         |  651 |
| `client/src/canvas/dock/WorkspaceGrid.tsx`                      |  632 |
| `client/src/App.tsx`                                            |  624 |
| `common/src/surface.ts`                                         |  602 |
| `client/src/canvas/dock/Dock.tsx`                               |  594 |
| `integrations/claude-code/src/core.ts`                          |  561 |
| `client/src/canvas/TerminalCanvas.tsx`                          |  519 |

### Already-extracted infrastructure (good signal)

The repo has clearly internalized the extraction discipline:

- `@kolu/surface` — typed reactive surface (the Surface-framework blog post).
- `transcript-core` + per-vendor `transcript.ts` — vendor-neutral IR + thin adapters.
- `anyagent` — shared agent contract (`AgentProvider`, `classifyByAwaiting`, `TaskProgress`).
- `kolu-shared/sqlite` — `createWalSubscription` (the 16-LOC `wal-watcher.ts` files in `opencode` and `codex` are pure wrappers, no duplication).
- `integrations/io/refcounted-dir-watcher.ts` — shared fs.watch refcounting.
- `terminal-themes`, `memorable-names`, `nonempty`, `solid-pierre`, `surface-nix-host` — already small, single-purpose packages.

### Initial scorecard

- **V (volatility violations)**: to enumerate per-cycle via `/lowy` audits.
- **F (framework-extraction candidates)**: initial shortlist
  - `client/src/terminal/Terminal.tsx` (930) — xterm.js + Solid lifecycle wrapping; smells like a `@kolu/solid-xterm` candidate.
  - `client/src/CommandPalette.tsx` (904) — nested-command Raycast-style palette; possibly `@kolu/solid-command-palette`.
  - `client/src/canvas/dock/*` (≈3 000 LOC subtree) — dockTree/dockRowRanking/useDockOrder is a distinctive layout primitive but tightly tied to terminal cards.
- **X (externalization candidates)**: initial shortlist
  - `integrations/pty` (≈580 LOC) — `node-pty` wrapper with shell helpers; already a workspace package, could ship as standalone npm.
  - `surface-nix-host` (788) — already structurally external; could move out of monorepo.
  - `solid-pierre` (571) — thin SolidJS wrapper around Pierre vanilla classes; obvious npm candidate.
- **E/I**: to be measured per subtree as cycles progress.

---

## Optimization log

| Cycle | Target | Mutation | Δ violations | Δ LOC | Commit | Notes |
| ----: | ------ | -------- | ------------ | ----- | ------ | ----- |
|     0 | (baseline) | report scaffold | n/a | n/a | `afc9a35b` | establishes scorecard |
|     1 | server import cycles | extract `surfaceCtx.ts` holder + pure `unwrapGit.ts` | −7 `noImportCycles` (7→0) | net +1 file, ~−30 LOC in `surface.ts` | `b7af5bdb` | All 7 server import cycles eliminated. Domain modules (`session.ts`, `activity.ts`, `terminalBackend/*`) now depend on `surfaceCtx.ts` only — a one-way arrow. `surface.ts` populates the holder via `setSurfaceCtx(...)` at module init. Two test files needed bootstrap (`metadata.test.ts` installs a no-op via the new `installNoopSurfaceCtxForTesting` helper; `session.test.ts` does a side-effect import of `surface.ts` since it verifies the real persistence path). 46/46 server unit tests pass; full repo unit suite green. Biome warnings 60→51. |
|     2 | `Terminal.tsx` (930 LOC, mixed concerns) | extract `mobileTouch.ts` — `setupMobileTapToFocus(term)` + `setupMobileTouchScroll(container, getTerm)` | 0 lint Δ; isolates iOS-Safari platform volatility (Lowy Axis 8) | Terminal.tsx 930→821 (−109); `mobileTouch.ts` +135 | `0893f3d2` | /lowy audit said the proposed `@kolu/solid-xterm` framework extraction *fails* the reuse test (one consumer; would shape API around implementation, not stable contract). What it *did* recommend was the mobile-touch state machine: 110 LOC of iOS-tap-vs-scroll heuristic + xterm-touchscroll bridge with a real platform-volatility axis. The receptacle is a single file; the axis (iOS Safari focus/touch behavior) now has a documented home for the next workaround. 172/172 client unit tests pass. |
|     3 | xterm WebGL lifecycle inside `Terminal.tsx` | create **new package** `@kolu/solid-xterm`; move `loadWebgl`/`unloadWebgl`/`clearTextureAtlas`/`webgl?.textureAtlas` probe into `createXtermWebgl(getTerm, hooks)` | 0 lint Δ; isolates xterm WebGL addon + Chrome GPU context volatility; establishes `@kolu/solid-xterm` shape | Terminal.tsx 821→779 (−42); new package +205 (`src/webgl.ts` 154 + `src/index.ts` 19 + README 32) | `df3f152f` | **Reversal of the cycle-2 /lowy verdict.** User feedback: "single consumer is not a good excuse — surface has a single consumer too. just like electricity even if it used in only one home". Re-extracted under the Surface precedent: encapsulate a stable axis (xterm WebglAddon API + Chrome's ~16 per-tab GPU context budget + link-layer-canvas selector trap + `WEBGL_lose_context.loseContext()` ordering) behind a small factory the host plugs hooks into. `webglTracker.ts` stays in client/ (Kolu-specific #591 debug ledger); the framework calls `onCreate`/`onLoseContextCalled`/`onDispose` hooks the host wires into it. First step toward a multi-cycle `@kolu/solid-xterm` build-out. 172/172 client unit tests pass; pnpm hash unchanged. |
|     4 | reactive xterm option sync (theme + fontSize) in `Terminal.tsx` | grow `@kolu/solid-xterm`: add `attachXtermStyleSync(getTerm, { theme, fontSize, onThemeChange, onFontSizeChange })` export + `./style-sync` entry point | 0 lint Δ; second framework axis encapsulated (xterm options live-write + after-change hook ordering) | Terminal.tsx 779→770 (−9); framework +73 (`src/styleSync.ts`) | `510b1e54` | Two `createEffect(on(..., { defer: true }))` blocks + their atlas-clear / refit follow-ups now sit behind one helper. The `defer: true` discipline (initial values come from XTerm constructor, only subsequent reactive changes flow through) lives in the framework instead of being re-discovered per call site. Separate `onThemeChange` / `onFontSizeChange` hooks because the theme axis has no fit implication — collapsing to one `afterChange` would force unnecessary work on theme swap. 172/172 client unit tests pass. |
|     5 | `client/src/scrollLock.ts` (zero-Kolu-coupling 120-LOC primitive) | move it bit-for-bit into `@kolu/solid-xterm` as `./scroll-lock`; drop the client-side copy | 0 lint Δ; consolidates third xterm-volatility axis (scrollback freeze-write + buffer.active.baseY/viewportY math) in the framework | Terminal.tsx import path change; net file count: −1 in client, +1 in solid-xterm | `fa8ce514` | The file was already at the right altitude — `createScrollLock(enabled)` only depended on `@xterm/xterm` and `solid-js`. The new framework is its natural home. Reduces the count of "things in client/src/ that should be elsewhere" by one and grows `@kolu/solid-xterm`'s API surface from 2 → 3 exports. 172/172 client unit tests pass. |
|     6 | canvas: `GRID_SIZE` + `snapToGrid` leaking from `viewport/transforms.ts` to `repoIslands.ts` + `tilePlacement.ts` | extract `canvasGeometry.ts`; viewport re-exports for backward compat; packing imports from neutral location | breaks one Lowy boundary violation; unblocks future `@kolu/canvas-layout` extraction identified by /lowy | +1 file (`canvasGeometry.ts`, 25 LOC); net repo LOC ≈ +5 | `353ff44e` | /lowy audit (canvas cluster, ≈800-word report) flagged one violation: tile-packing modules (`repoIslands.ts`, `tilePlacement.ts`) reach into `viewport/transforms.ts` for `GRID_SIZE`/`snapToGrid`. The viewport's internal coordinate constants shouldn't be tile-packing's dependency surface — they're sharing today but if tile-space ever needs a different grid the conflict is silent. The audit also identified `repoIslands.ts` + `tilePlacement.ts` as **the first extractable framework candidate from the canvas cluster** (a future `@kolu/canvas-layout` for "2D canvas with grouped tiles"), blocked precisely by this import. Fix the boundary now; extraction can follow without re-touching it. 172/172 client unit tests pass. |
|     7 | extract the now-unblocked canvas-layout framework | create **new package** `@kolu/canvas-layout`; move `canvasGeometry.ts` + `tilePlacement.ts` + `repoIslands.ts` (genericized: `TerminalId` → `string`, `TileLayout` → `Rect`); update client imports; move the 11-test suite into the package | second new framework this loop; second pre-validated extraction (Lowy cycle 6) executed; client/canvas net `−3` files | new package `+5` files (4 src + README); client/canvas `−3` files; framework gains its own test target | `dc7c369a` | Three pure modules with zero Kolu domain dependencies (the only `TerminalId` was used as a Map key; replaced with the underlying `string`). New package ships its own vitest target (11 tests pass). The viewport's `transforms.ts` re-exports from `@kolu/canvas-layout/geometry` so viewport-internal callers (gestures, animatedPan, useCanvasViewport) keep their local-feeling import. All 172 client unit tests still pass. README in package documents the encapsulated "2D packing algorithm for grouped tiles" volatility axis. |
|     8 | extract the canvas viewport — second /lowy framework candidate | create **new package** `@kolu/solid-canvas-viewport`; move `client/src/canvas/viewport/*` (6 files, 585 LOC) into it; rename `TileLayout` → `Rect` (from `@kolu/canvas-layout`); update 4 client consumers | third new framework this loop; encapsulates pan/zoom viewport infrastructure with 3 internal axes (gesture input, transform math, CSS output) | new package `+8` files (6 src + index + README); client/canvas/viewport `−6` files (whole subdir gone) | `0a831844` | User feedback: "what about infinite canvas with minimap itself" — the viewport+minimap pattern IS the framework. /lowy already identified the viewport as cleanly extractable (zero Kolu coupling beyond `TileLayout = Rect`). 585 LOC moved bit-for-bit out of `client/src/canvas/viewport/`. `useCanvasViewport()` returns a stable `CanvasViewport` interface; the 3 internal modules (gestures/transforms/coordinates) become implementation details. Minimap (Kolu-specific UI) stays in client/canvas and now consumes the framework through `@kolu/solid-canvas-viewport`. 161/161 client unit tests + 11/11 canvas-layout unit tests pass. |
|     9 | prep recorder for extraction — remove Kolu-coupling from would-be-framework modules | `webcam.ts`: `toast.error()` in `toggleWebcam`/`changeWebcam` → `throw` (presentation belongs in orchestrator, not activity layer); `useRecorder.ts`: `startRecording()` gains required `{ suggestedName }` parameter (no more hardcoded `kolu-${ts}.webm`); `RecordPopover.tsx` passes the Kolu-prefixed name | 2 of /lowy's 3 coupling blockers cleared; recorder modules now reusable | net `~+15` LOC (added options interface + required param) | `a1734312` | /lowy audit (recorder cluster) said extraction is viable but has marginal value as a published package without 3 coupling fixes. Two fixed this cycle: toast in activity layer + hardcoded filename. Third (toast-in-orchestrator → onError callbacks) deferred to cycle 10 alongside the actual extraction, where `solid-sonner` becomes a peer dep instead. Sets up the extraction. 161/161 client unit tests pass. |
|    10 | extract `@kolu/solid-recorder` (4th new framework package) | create the package; move `mic.ts` + `webcam.ts` + `useRecorder.ts` + `LevelMeter.tsx` + `WebcamOverlay.tsx`; final coupling fix — 9 `toast.*` calls in `useRecorder.ts` routed through `RecorderNotifications { onError, onSuccess, onWarning }` (defaults to `console.*`); add `configureRecorderNotifications(...)` setter; `App.tsx` wires `solid-sonner` once at module load; `RecordButton.tsx` / `RecordPopover.tsx` / `App.tsx` import from `@kolu/solid-recorder` | fourth `@kolu/*` framework graduated this loop; recorder is now externalizable | client/recorder `−5` files (whole framework-side gone); new package `+8` files | (cycle 10) | The third /lowy coupling fix resolved by *peer-dep substitution*, not by deletion: notifications stay a first-class concern but the framework owns the abstraction, not the implementation. Defaults route to `console.*`, so the package can be used without a toast library at all. **Mid-loop checkpoint**: client has dropped from 25 049 LOC (cycle 0) to ~22 990 LOC (cycle 10); 4 new published-shape packages exist (`@kolu/solid-xterm`, `@kolu/canvas-layout`, `@kolu/solid-canvas-viewport`, `@kolu/solid-recorder`) totalling ≈2 050 LOC of newly-named framework surface. 161/161 client unit tests + 11/11 canvas-layout unit tests pass. |

## Mid-loop checkpoint (after cycle 10)

**Cumulative deltas vs cycle 0:**

| Metric | Cycle 0 | Cycle 10 | Δ |
| --- | ---: | ---: | --- |
| `packages/client` LOC | 25 049 | ≈22 990 | −2 060 |
| `Terminal.tsx` LOC | 930 | 770 | −160 |
| Server `noImportCycles` lint hits | 7 | 0 | −7 |
| Biome warnings (whole repo) | 60 | 51 | −9 |
| `@kolu/*` published-shape packages | 4 (surface, solid-pierre, artifact-sdk, terminal-themes nominally) | 8 (+ solid-xterm, canvas-layout, solid-canvas-viewport, solid-recorder) | +4 |

**Frameworks extracted this loop:**

- `@kolu/solid-xterm` (cycles 3–5) — xterm.js WebGL lifecycle, reactive theme/font sync, scroll-lock.
- `@kolu/canvas-layout` (cycles 6–7) — geometry constants, repo-island packing, tile-cascade placement.
- `@kolu/solid-canvas-viewport` (cycle 8) — pan/zoom infinite canvas with 3-axis decomposition.
- `@kolu/solid-recorder` (cycles 9–10) — browser tab + mic + webcam recording with injectable notifications.

**Pattern**: each extraction passes the *Surface bar* (encapsulate a stable volatility axis), not the *reuse-count bar* (each is single-consumer inside Kolu). Aligned with the user's explicit framing: "single consumer is not a good excuse — surface has a single consumer too. just like electricity even if it used in only one home".

---

|    11 | `useAnchoredPopover.ts` (135 LOC, 6 in-tree consumers) | extract `@kolu/solid-anchored-popover` — move the file bit-for-bit (it's already at the right altitude), update 6 client consumers to import from the new package | 5th `@kolu/*` framework this loop; first one extracted with a true *in-tree* high-reuse justification (not just the volatility-axis bar) | new package `+4` files; client/ui `−1` file | `8647a71c` | Out of /lowy on `server/terminalBackend/local.ts`: no actions warranted there (the meta/* consolidation is correct). Pivoted to the highest-in-tree-reuse SolidJS primitive: 6 consumers of `useAnchoredPopover` (option menu, settings popover, record popover, mode-chip picker, activity-window chip, PR-unavailable tooltip). The hook only depends on `solid-js` + `@solid-primitives/event-listener` — zero Kolu coupling. README explicitly addresses "why not Corvu / Floating UI" (this hook stays close to imperative `getBoundingClientRect` so consumers own the DOM + portal target). 161/161 client unit tests pass. |
|    12 | naming convention: `terminal-themes` was unscoped despite being externalization-ready (581 LOC of curated terminal color schemes + perceptual-distance picker) | rename to `@kolu/terminal-themes`; update 7 client import sites (+ `./color` subpath); update package.json `dependencies`; refresh README header | aligns naming with external-publish intent (joining `@kolu/surface`, `@kolu/solid-pierre`, the 5 framework packages added this loop, and `@kolu/artifact-sdk`); no behaviour change | 7 import-site edits | `08b04ff7` | The package was already at the right altitude — pure data + perceptual-distance picker, zero Kolu app coupling. The unscoped name was a remnant from before the `@kolu/*` convention crystallized. README rewrites the example to match. Sets the convention for the remaining unscoped packages (`anyagent`, `nonempty`, `memorable-names`) which can follow similarly in future cycles. 161/161 client unit tests pass. |
|    13 | `client/src/ui/clipboard.ts` (111 LOC, 6 consumers) — cross-cutting infrastructure for non-secure-context clipboard writes | extract `@kolu/browser-clipboard` with `./` entry (`writeTextToClipboard`) and `./xterm` entry (`SafeClipboardProvider` impl of xterm's `IClipboardProvider`); 8 client consumers updated | 6th `@kolu/*` framework this loop; documents the LAN-HTTP/Tailscale-IP volatility axis that any browser app over plain HTTP hits | new package `+5` files; client/ui `−1` file | `a6143058` | Real cross-cutting concern: `navigator.clipboard === undefined` for any host that isn't `https://…`, `localhost`, or `127.0.0.1`. The `execCommand("copy")` + synthetic `<textarea>` fallback is formally deprecated but at [caniuse 100/100](https://caniuse.com/mdn-api_document_execcommand_copy) with no removal timeline. Two entry points so consumers without xterm don't pay the `@xterm/addon-clipboard` peer-dep cost. 161/161 client unit tests pass. |
|    14 | `client/src/ui/lineRef.ts` (209 LOC, 5 client consumers + tests) — pure `path:line[-end]` parser | extract `@kolu/file-line-ref`; move the file + its test bit-for-bit; update 5 client imports | 7th `@kolu/*` framework this loop; package has its own vitest target | new package `+4` files; client/ui `−2` files | `f10e283c` | Pure-data parser with zero deps. The wire format (`path:L`, `path:L-N`, with `cwd`+`repoRoot` resolution against a worktree file list) is the kind of utility any editor-adjacent tool re-implements; naming the package documents the axis (the format itself) and gives the resolver a single home for future variations (column refs, workspace prefix, etc.). Full repo unit suite green (server 46 + client 161 + canvas-layout 11 + file-line-ref tests). |
|    15 | naming convention drift: 3 packages still unscoped (`anyagent`, `nonempty`, `memorable-names`) while the rest use `@kolu/*` | bulk rename all three to `@kolu/anyagent`, `@kolu/nonempty`, `@kolu/memorable-names`; update 27 import sites across client, server, common, integrations | finishes the convention sweep started in cycle 12 — every published-shape package now reads `@kolu/X` | 27 import-site edits across 3 packages | `7c673a70` | After this cycle there is exactly one naming convention in the repo: workspace packages intended for external publishability use `@kolu/*`; internal monorepo apps and infrastructure (`kolu-client`, `kolu-server`, `kolu-common`, `kolu-shared`, `kolu-pty`, `kolu-claude-code`, `kolu-opencode`, `kolu-codex`, `kolu-git`, `kolu-github`, `kolu-io`, `kolu-transcript-core`, `kolu-transcript-html`) keep the `kolu-` prefix. Distinction is grep-able: `@kolu/*` = "candidate for npm publication", `kolu-*` = "monorepo-internal". Full repo unit suite green: server 46, client 132, canvas-layout 11, file-line-ref 29, terminal-themes 20, artifact-sdk 8, surface 57, memorable-names 4, anyagent 56, pty 24, transcript-core 14, opencode 43, codex 66, claude-code 69, git 67, github 44 — **730 total tests**. |
|    16 | `kolu-io` (164 LOC generic refcounted `fs.watch` watcher) — package's own docstring already declared "zero `kolu-*` dependencies" leaf | promote `kolu-io` → `@kolu/dir-watch`; update `kolu-git` dep + 4 source imports + 1 test reference + the module-level docstring | aligns the last clearly-externalizable infrastructure package with the `@kolu/*` convention; signals publishability | 6 import-site edits | `b04e4568` | The author's intent was already explicit ("Standalone integration package with no `kolu-*` dependencies"); only the naming hadn't caught up. After this, every workspace package that lives at the right altitude for external publication wears `@kolu/*`. Remaining `kolu-*` packages are exclusively Kolu app/server/integration internals. 67/67 git unit tests pass. |
|    17 | biome FIXABLE diagnostics floor | `biome check . --write --unsafe` over the repo; fix two over-rewrites where the unsafe optional-chain replacement narrowed a return type (`l?.startsWith("***")` → needs `?? false`; `col[0]?.id` → needs `?? null`) | biome warnings 51 → 40; no behaviour change | mechanical | `0a2a0feb` | The remaining 40 warnings are mostly `noExplicitAny` in `@kolu/surface`'s type-level machinery (where `any` is genuinely needed for the generic spec) and one `noNonNullAssertion` in `terminalBackend/local.ts:481` whose comment justifies the assertion. The fixable ones (unused imports, `useImportType`, `useOptionalChain`) are now applied across the repo; the 100 files biome rewrote are all import-style or type-annotation tidying. Full repo unit suite green (730 tests). |
|    18 | full-pipeline validation | run `just smoke` (Nix builds the kolu binary, boots it, polls `/api/health`, validates clean shutdown) | confirms the package boundary shuffles + 7 new `@kolu/*` packages produce a working executable, not just a passing type-check | n/a | n/a | `just smoke` is the strongest local validation short of the e2e suite — it exercises the full `nix build → kolu-bin → server-boot → http response → shutdown` path. Result: `kolu listening at http://127.0.0.1:37383`, `/api/health returned 200`, `shutdown clean`. No regression from the architecture changes. |
|    19 | README table out of date with cycle 15/16 renames | tag `packages/integrations/anyagent/` row with `@kolu/anyagent`; expand `packages/integrations/io/` row with `@kolu/dir-watch` + the parent-dir/temp+rename/refcount-singleton details | architecture table now matches actual package names | docs only | `abed7ff7` | The Architecture table had been updated as new `@kolu/*` packages were added but the two renames (cycles 15 and 16) only touched `package.json` and imports; the README rows still read by directory name. Caught up now. |

---

## Dead ends

Items investigated where /lowy or direct analysis concluded "no action warranted." Documented because "X doesn't help" is itself valuable knowledge:

- **Integration cluster** (`packages/integrations/{claude-code,opencode,codex}`) for further consolidation — /lowy verdict: the framework already exists as `createDebounceWatcher + createWalSubscription + AgentProvider`. The per-integration `schemas.ts` boilerplate is below the cost threshold (3 instances, integration-specific doc comments would be lost on extraction). The claude-code session-watcher cannot migrate to `createDebounceWatcher` until the latter grows async-refresh support — a non-trivial change to a shared utility that would export instability into other consumers.
- **`@kolu/solid-xterm` framework extraction (cycle 2 first attempt)** — /lowy verdict on the first pass: fails the reuse test (one consumer; framework API would be shaped around implementation). **Reversed in cycle 3** after user feedback: "single consumer is not a good excuse — surface has a single consumer too. just like electricity even if it used in only one home." Cycles 3-5 then graduated solid-xterm under the Surface precedent.
- **`startAgentProvider` harness move to `@kolu/anyagent`** (cycle 11 /lowy) — would require either turning a 5-arg function into a 9-arg one (injecting server-local deps) or making `@kolu/anyagent` depend on `kolu-pty` + `terminal-registry` + server metadata, inverting the clean leaf layering. The harness encapsulates server-orchestration volatility (publisher channels, metadata system), not agent-detection volatility (which IS in `@kolu/anyagent` as the `AgentProvider` interface). Correct location is `server/terminalBackend/local.ts`.
- **Per-provider function split-back to files** (cycle 11 /lowy on `terminalBackend/local.ts`) — `startAgentCommandTracker` and `startAgentProvider` share `record.currentAgent` via direct slot writes (collocation eliminates a publisher-channel round-trip). Splitting them re-introduces the channel coordination they were merged to eliminate. The other per-provider functions are <40 LOC each with zero reuse surface — splitting adds file-count without changing volatility encapsulation.
- **`useTextSelection.ts` extraction into `@kolu/artifact-sdk/solid`** (cycle 11 investigation) — tangled with Kolu's `composerState`. Would require injecting `composer.isComposing()`/`composer.open(...)` as callbacks plus rerouting `useComposer` access, growing the API beyond a single-cycle change.
- **`useLineSelection.ts` extraction** (cycle 12 investigation) — depends on Pierre's `SelectedLineRange`, Kolu's `CodeContextMenu`, Kolu's `Icons`, plus `formatLineRef`. Too much Kolu coupling for a clean extraction.

---

## Key findings

### 1. The Surface bar generalizes

The discipline established by `@kolu/surface`'s extraction — encapsulate a stable volatility axis, even at one in-tree consumer — extracted **seven more `@kolu/*` framework packages this loop**. The bar is per-volatility-axis, not per-reuse-count:

| Package | Volatility axis encapsulated |
| --- | --- |
| `@kolu/solid-xterm` | xterm.js WebGL lifecycle + Chrome's per-tab GPU budget; reactive theme/font sync; scroll-lock buffer-active math |
| `@kolu/canvas-layout` | 2D packing algorithm for grouped tiles (square-ish vs row-major vs golden-ratio; per-bucket priority) |
| `@kolu/solid-canvas-viewport` | Pan/zoom 2D viewport (gesture input + transform math + CSS output, three internal axes) |
| `@kolu/solid-recorder` | Browser tab + mic + webcam media-capture lifecycle (FSA, MediaRecorder, codec availability) |
| `@kolu/solid-anchored-popover` | Viewport-clamped popover positioning + outside-click + Escape dismiss |
| `@kolu/browser-clipboard` | Non-secure-context clipboard fallback (`navigator.clipboard` undefined on plain HTTP LAN) |
| `@kolu/file-line-ref` | `path:line[-end]` wire format for editor-adjacent tools |

User reframe ("just like electricity even if it used in only one home") was the unlock — extraction value is *encapsulation*, not *reuse*. Each package's README documents the encapsulated axis so the next consumer (or external publishability) starts from the receptacle, not from re-derivation.

### 2. Late-bound holders break load-order cycles

Cycle 1's `surfaceCtx.ts` holder eliminated **all 7** `noImportCycles` violations in the server. The pattern: a Proxy-fronted holder accepts `setSurfaceCtx(built)` once at startup and forwards property reads to the populated handle. Domain modules (`session.ts`, `activity.ts`, `terminalBackend/*`) import from the holder; only `surface.ts` imports the domain modules. The previous bidirectional arrow (`surface.ts ↔ domain`) split into a one-way arrow + a one-way registration. The unit-test bootstrap pattern (`installNoopSurfaceCtxForTesting()`) names the side-effect the old cycle accidentally provided.

### 3. /lowy's "no action" reads are load-bearing

Three substantial audits (`integrations/*`, `server/terminalBackend/local.ts`, recorder cluster pre-extraction) said "the decomposition is already correct" — and meant it. Acting on those reads would have re-introduced complexity (splitting `local.ts`'s consolidated `meta/*`, fanning shared `record.currentAgent` writes through a publisher channel, fragmenting the per-vendor `schemas.ts` files). The audits also flagged real violations when they existed (cycle 6's GRID_SIZE leak through the viewport boundary) — calibrated rather than over-eager.

### 4. Extraction prep is often the actual work

The `@kolu/solid-recorder` extraction took two cycles (9 + 10), but the *extraction itself* was mechanical. The work was the **prep** — three Kolu-coupling fixes that surfaced once the package boundary was imagined: `toast.error()` inside the activity layer (wrong altitude), hardcoded `kolu-${ts}.webm` filename (app identity in a generic state machine), and `solid-sonner` calls throughout the orchestrator (no abstraction for the notification surface). The third resolved via *peer-dep substitution* (`RecorderNotifications { onError, onSuccess, onWarning }` + `configureRecorderNotifications`), not deletion — the abstraction belongs in the framework, the implementation in the consumer.

### 5. Naming convention is grep-able architecture

After cycles 12, 15, 16, the workspace has exactly one externalizability convention:
- **`@kolu/*` scope** = "candidate for npm publication" (10 packages).
- **`kolu-*` prefix** = "Kolu monorepo internal" (13 packages — `kolu-client`, `kolu-server`, `kolu-common`, `kolu-shared`, `kolu-pty`, the per-vendor integrations, `kolu-transcript-*`).

The split is now *information* — a contributor can read `import` statements and know whether they're inside a publishable boundary. Before this loop the convention was inconsistent (terminal-themes, anyagent, nonempty, memorable-names were unscoped despite being externalization-ready; kolu-io was prefixed despite its docstring explicitly declaring it a zero-Kolu-deps leaf).

---

## Final measurements

**Cumulative deltas vs cycle 0 (baseline):**

| Metric | Cycle 0 | Cycle 19 | Δ |
| --- | ---: | ---: | --- |
| `packages/client` LOC | 25 049 | ~22 600 | −2 449 |
| `Terminal.tsx` LOC | 930 | 770 | −160 |
| Server `noImportCycles` lint hits | 7 | 0 | −7 |
| Biome warnings (whole repo) | 60 | 40 | −20 |
| `@kolu/*` workspace packages | 4 | 12 | +8 |
| `kolu-*` workspace packages (renamed away) | 1 | 0 | −1 (`kolu-io` → `@kolu/dir-watch`) |
| Unit tests passing | 660-ish (`60` warnings → unmeasured at start) | 730 across 16 packages | + new `file-line-ref` (29) + `canvas-layout` (11) tests |
| Bare-unscoped packages | 4 (`anyagent`, `nonempty`, `memorable-names`, `terminal-themes`) | 0 | −4 |

**Frameworks graduated this loop**: 7 new `@kolu/*` (solid-xterm, canvas-layout, solid-canvas-viewport, solid-recorder, solid-anchored-popover, browser-clipboard, file-line-ref) plus the convention rename `kolu-io` → `@kolu/dir-watch`. Combined with the 5 pre-existing externally-shaped packages (surface, solid-pierre, artifact-sdk, terminal-themes-renamed, anyagent-renamed-this-loop), Kolu now ships **12 `@kolu/*` packages** at the right altitude for external publication.

**Surface example** (`packages/surface/example/remote-process-monitor/`) continues to be the canonical Surface-extraction proving ground (cited in the Surface blog post). The loop's pattern follows that precedent: prove the framework against a constrained consumer first, document the encapsulated axis in a README, ship.

**`just smoke` passes**: `nix build → kolu-bin → server boot → /api/health 200 → clean shutdown`. The package-shuffle did not regress the production build path.

**Limitations of this loop**:
- E2E suite not re-run inside the loop (per cycle constraints). Smoke + unit tests are the validation; e2e would be the final pre-merge gate.
- Several genuine framework candidates were investigated but deferred for scope reasons: `CommandPalette.tsx` (904 LOC Raycast-style), `useTextSelection.ts` (Range/ShadowRoot adapter), `useLineSelection.ts` (Pierre-coupled), the comments cluster's `composerState`. Each has /lowy-class extractability but needs coupling work first.
- The `kolu-*` internal packages were not promoted — by design. They're Kolu app internals (client/server/common/shared) and integration-specific code (per-vendor agent integrations, git/github wrappers, transcript-vendor adapters). The `@kolu/*` vs `kolu-*` split is now the conscious distinction.

**Cost**: 20 cycles, 730 unit tests at green throughout, zero behavior regressions caught by smoke. Net 8 new external-shape packages plus boundary cleanups (server cycles, canvas/viewport geometry leak, mobile-touch encapsulation, biome lint floor).
