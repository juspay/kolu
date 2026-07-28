# BUG.md — the dock's active-row highlight, still not right

**Read this first, then ask the user the ONE question at the bottom before writing code.**

Branch `fucknotif` · PR [#2019](https://github.com/juspay/kolu/pull/2019) · repo `/home/srid/code/kolu/.worktrees/fucknotif`
HEAD at handoff: `4ed6fc80` (pushed). Working tree clean apart from this file.

---

## 1. The user's verdict, verbatim

> "There's an improvement but the bug is not fully fixed."

That is **all** we know about the current symptom. They have deployed `baf4bf8b`/`4ed6fc80` and looked at it. Three prior recordings exist but the latest one has NOT been described in words, and it was not watched (a `.mov` cannot be read by the agent).

**Do not guess what remains.** Three fixes have already been shipped by guessing at this exact attribute, and two of them made things worse. Ask the question in §7.

---

## 2. What the feature is supposed to do

The dock lists terminals. A terminal can hold **splits** (sub-terminals), which this PR gave their own *indented sub-entries* under the parent row — because an agent working in a split was counted by the host tab and visible nowhere.

Two facts decide which rows are highlighted, and **they nest**:

| fact | means | applies to |
| --- | --- | --- |
| active **TILE** | the canvas selection | a top-level dock row |
| **focus** | where your keyboard actually is | a top-level row *or* a split entry |

A row gets `data-active` when it **is the selected tile OR is the split your keyboard is in**. Both can be lit at once — you are in that split, inside that tile.

The user asked for the split highlight (screenshot: clicking a split's entry lit nothing). The user then reported the parent going dark, which is the opposite error. The nesting model is the reconciliation of those two reports.

---

## 3. Three regressions already shipped here — do not repeat them

All three were in the **same attribute**, and all three passed a green unit suite.

1. **`SubAgentRow` hardcoded `active: false`** (commit `1ea67bc3` fixed). `dockRowAttrs` took `active` as a *parameter*, so every row computed it and the split entry fabricated one. Root shape: a flat facts-product — the exact thing this whole PR exists to abolish (`bindStatePip` stopped taking loose booleans for this reason).
2. **The focus read SEEDED state** (commit `33cd886f` fixed). The reader called `getSubPanel`, which calls `ensureState`, which seeds `focusTarget: "sub"`. So *asking* where focus was created the answer "you're in the split" — from inside a `createMemo`, writing during a derivation. Any terminal that merely HAD a split lost its parent highlight. Fixed with `peekSubPanel` (read-only) + absence-means-the-tile.
3. **Exclusive instead of nested** (commit `0f550d89` fixed). Lighting the split entry, I took `data-active` OFF the parent, reasoning "one lit row". Wrong: the e2e contract `[data-testid="dock-row"][data-active]` targets the PARENT of a split-holding terminal. Two e2e scenarios failed on both platforms.
4. **The attribute was carried but never styled** (commit `baf4bf8b` fixed). The highlight was a per-component Tailwind variant `data-[active]:bg-accent/15 data-[active]:border-l-accent`, present in `Dock.tsx` and `DockList.tsx`, **absent from `SubAgentRow.tsx`**. So the split entry got the attribute and rendered no visible change. Moved to one CSS rule keyed on the shared `[data-dock-row]` hook in `index.css` (~line 705), same move already used for the attention wash and the blocked-subline rule. Sub-entry also gained the `border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent` stripe track the highlight paints into.

**The pattern across all four: a contract held by each component remembering to spell something.** If the remaining bug is of the same family, look for the next place that is true.

---

## 4. The code, and where to look

| file | role |
| --- | --- |
| `packages/client/src/terminal/useFocusedTerminal.ts` | `useFocusedTerminal()` shared root → `{ focusedId, isFocused(id), isActiveTile(id) }`, plus the pure `resolveFocusedTerminal(activeTileId, panelOf)` |
| `packages/client/src/canvas/dock/dockRowAttrs.ts` | the shared data-attribute bag; `isActiveRow(id) = isActiveTile(id) \|\| isFocused(id)`. **No `active` parameter — deliberately.** |
| `packages/client/src/canvas/dock/SubAgentRow.tsx` | the indented split entry |
| `packages/client/src/canvas/dock/Dock.tsx` / `DockList.tsx` | desktop + touch top-level rows |
| `packages/client/src/terminal/useSubPanel.ts` | the sub-panel store. **`getSubPanel` SEEDS; `peekSubPanel` does not.** Seed default is `focusTarget: "sub"`, `collapsed: false`, `activeSubTab: null`. |
| `packages/client/src/terminal/TerminalContent.tsx` | the only honest focus recorders: `handleMainFocus`/`handleSubFocus` → `setFocusTarget(id, "main"\|"sub")` |
| `packages/client/src/canvas/dock/useDockFocus.ts` | the LANDING seam: resolves a split's parent itself from `store.getMetadata(id).parentId` |
| `packages/client/src/index.css` ~697-715 | `.dock-cards-section > [data-dock-row][data-active]` highlight + the `--attn` wash below it |

`resolveFocusedTerminal` rule, in words: no tile → null. No panel state → the tile. Panel collapsed → the tile. `focusTarget !== "sub"` → the tile. Else `activeSubTab ?? tile`.

---

## 5. Tests that exist (and the level that matters)

- **`packages/client/src/canvas/dock/dockRowActive.test.tsx`** — **THE ONE THAT MATTERS.** happy-dom; renders through the real `dockRowAttrs` with the real sub-panel store, mocks only `useTileStore`, and enumerates 7 states asserting which of {parent, split} carry `data-active`. **Add the reproduction here.** Every prior regression was invisible to lower-level tests.
- `packages/client/src/terminal/focusedTerminal.test.ts` — 9 cases on the pure resolver.
- `packages/client/src/attention/attentionMarks.test.ts` — re-run-count test proving a class read does not wake on the ~1 s byte tick.
- e2e: `packages/tests/features/sub-terminal.feature:144,151` (`the active dock row should show sub-terminal count N`, keyed on `[data-testid="dock-row"][data-active]`) and `features/claude-code.feature:18` (pip vocabulary).

**Discipline the user requires, non-negotiable:** reproduce in a test that is **RED first**, then fix. A repro that passes means the repro is wrong, not that there is no bug. Prove red by sabotaging the fix and watching it fail, if the bug is already fixed by the time you write it.

---

## 6. State of `/be` (what remains after the bug)

Done: interview → implement → draft PR → **full gauntlet** (architecture, lowy∥hickey lens 30 findings, Grok debate approved in 2 rounds, simplify 20 items, code-police 2) → performance pass (3 wins banked in `docs/atlas/.../performance.mdx`) → master merged → 3 PR comments posted.

**Outstanding:**
1. This bug.
2. **CI green on both platforms.** Last full data: linux **539/539 e2e green** at `0f550d8`; darwin failed only `code-tab.feature:393,419` — the documented flake (tracker row, verbatim signature match, and those `right-panel/` files came from master's #2017 merge, not this branch). CI was **stopped mid-run** at the user's request (coordinator pid killed; leases on `rasam` + `kolu-ci-2` may need a moment to release — check `nix run ./ci#odu -- hosts`).
3. e2e metrics PR comment — script ready and **verified against a real settled ledger** at `/tmp/claude-1000/-home-srid-code-kolu--worktrees-fucknotif/cf3963c2-3542-4a86-800f-7fa15458f681/scratchpad/e2e-metrics.sh` (args: `<sha7> <seq> [pr]`).
4. `just ci::protect --dry-run` gate with **both** `--platform` flags. CodeQL already clean (query `pr=2019`, never a branch ref).
5. Done report + `/self-improve`.

Evidence capture is **skipped by the user's explicit instruction** — they test by deploying.

## 7. ASK THIS BEFORE WRITING CODE

> "What exactly do you see now? Specifically: click a split's entry — which rows light up (parent / split / neither / both), and is it the wrong row, no row, the right rows but wrong-looking, or does it light and then go away?"

Guessing has cost three rounds. One sentence from the user replaces all of it.
