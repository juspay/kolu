# DRY Violations on `feat/mission-control`

## High

### Card metadata footer (MissionControl.tsx + Sidebar.tsx)

Both render near-identical footer: label, git branch, PR+ChecksIndicator, ActivityGraph. Same `meta?.meta?.git?.branch` fallback pattern. Change one → must change other.

### Terminal label derivation (MissionControl.tsx + Sidebar.tsx)

`MissionControl.tsx` has `cardLabel()` using `repoName || cwdBasename || "terminal"`. Sidebar does the same inline with slight variation. Should share one function.

## Medium

### Tab cycling logic (useShortcuts.ts + MissionControl.tsx)

Both implement wrap-around index cycling for terminal switching. `useShortcuts.ts` triggers `quickSwitch` with direction; `MissionControl.tsx` does `(idx ± 1 + len) % len`. Related logic split across two files.

### `[data-testid='mission-control-card']` queried twice (MissionControl.tsx)

Same `querySelectorAll` in the auto-focus effect (line ~99) and the keydown handler (line ~149). Extract to a helper or ref-based approach.

### Test selectors inconsistent (mission_control_steps.ts)

`MC_SELECTOR` / `MC_CARD_SELECTOR` defined as constants but `terminal-preview`, `card-number` are hardcoded inline.

## Low

### Magic timeout `300` repeated 6× (mission_control_steps.ts)

`waitForTimeout(300)` after every interaction. Extract to `const INTERACTION_DELAY`.

### Focused-element getter duplicated (mission_control_steps.ts)

`document.activeElement?.getAttribute("data-terminal-id")` evaluated identically in two steps. Extract to helper.

### Capture-phase keydown boilerplate (useShortcuts.ts, MissionControl.tsx, CommandPalette.tsx)

All three do `makeEventListener(window, "keydown", handler, { capture: true })` with similar preventDefault/stopPropagation wrapping.
