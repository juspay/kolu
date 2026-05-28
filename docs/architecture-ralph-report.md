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
|     5 | `client/src/scrollLock.ts` (zero-Kolu-coupling 120-LOC primitive) | move it bit-for-bit into `@kolu/solid-xterm` as `./scroll-lock`; drop the client-side copy | 0 lint Δ; consolidates third xterm-volatility axis (scrollback freeze-write + buffer.active.baseY/viewportY math) in the framework | Terminal.tsx import path change; net file count: −1 in client, +1 in solid-xterm | (cycle 5) | The file was already at the right altitude — `createScrollLock(enabled)` only depended on `@xterm/xterm` and `solid-js`. The new framework is its natural home. Reduces the count of "things in client/src/ that should be elsewhere" by one and grows `@kolu/solid-xterm`'s API surface from 2 → 3 exports. 172/172 client unit tests pass. |

---

## Dead ends

(populated as cycles produce "investigated but no improvement" results)

---

## Key findings

(populated at wrap-up)
