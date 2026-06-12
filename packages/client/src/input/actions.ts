/**
 * Unified action registry — single source of truth for keyboard shortcuts,
 * the help overlay, and shared palette command metadata. The registry key is
 * the action's id; each entry carries label, keybind, optional altKeybind,
 * and optional handler.
 *
 * Adding or rebinding a global action touches this one file. The dispatcher
 * in `useShortcuts.ts` loops over `ACTIONS`; `ShortcutsHelp.tsx` walks
 * `HELP_ORDER` against the registry; `commands.ts` derives palette entries
 * via `actionPaletteCommand`.
 */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { nonEmpty } from "nonempty";
import type { Accessor, Setter } from "solid-js";
import type { PaletteAction, SectionId } from "../CommandPalette";
import { type Keybind, matchesKeybind } from "./keyboard";

/** Shared handler context — every dispatched action receives this. */
export interface ActionContext {
  terminalIds: Accessor<TerminalId[]>;
  /** Dock row order — recency-descending across all terminals. Drives
   *  the `Cmd+1..9` positional shortcuts so the keys target what the
   *  user visibly sees at the top of the dock, not insertion order.
   *  Same source the dock and mobile drawer render from. */
  dockOrderedIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  /** Make `id` the active terminal AND pan the canvas to it. The single
   *  writer for keyboard-driven activation (cycle, positional, MRU) so
   *  every shortcut gets viewport-follow without remembering a second
   *  call. Mirrors `store.activate` from `useViewState`. */
  activate: (id: TerminalId | null) => void;
  /** Terminal IDs in most-recently-used order; used for Alt+Tab / Ctrl+Tab cycling. */
  mruOrder: Accessor<TerminalId[]>;
  activeMeta: Accessor<TerminalMetadata | null>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  openNewTerminalMenu: () => void;
  openWorkspaceSwitcher: () => void;
  setPaletteOpen: Setter<boolean>;
  setShortcutsHelpOpen: Setter<boolean>;
  setSearchOpen: Setter<boolean>;
  /** Toggle sub-panel: creates first split if none exist, otherwise toggles visibility. */
  toggleSubPanel: (parentId: TerminalId) => void;
  cycleSubTab: (parentId: TerminalId, direction: 1 | -1) => void;
  handleShuffleTheme: () => void;
  handleScreenshotTerminal: () => void;
  toggleRightPanel: () => void;
  toggleDock: () => void;
  /** Flip the canvas between tiled and maximized posture. Wired to
   *  `useViewPosture().toggle`, whose own write guard makes it a no-op
   *  off the spatial canvas (mobile / narrow) or with zero terminals — so
   *  the keybind needs no extra guard. */
  toggleCanvasPosture: () => void;
  toggleRecordingPause: () => void;
}

interface AppActionBase {
  label: string;
  keybind: Keybind;
  /** Optional alternate keybind that triggers the same handler (e.g. Cmd+Enter for "New terminal"). */
  altKeybind?: Keybind;
  /** Optional attribute selector confining this chord to a focus region. When
   *  set, the dispatcher claims the chord ONLY if the dispatch-time `e.target`
   *  is inside a matching element; anywhere else it declines without running
   *  the handler or `preventDefault`ing, so the chord's native browser action
   *  proceeds. Used to confine Cmd/Ctrl+F to the terminal — the one surface
   *  where the browser's own find-in-page is useless (terminal content is
   *  canvas-rendered, invisible to the DOM) — and let it fall through to
   *  find-in-page everywhere else (Code tab, panels, palettes, bare chrome).
   *  The DOM read lives in the dispatcher (which already owns `e.target`); the
   *  registry only names the marker. `matchesAnyShortcut` needs no special
   *  case — a plain string field is inert there. */
  focusScopeMarker?: string;
}

/** An action whose dispatch flows through the registry's generic loop —
 *  every palette-callable action, the position-switch group, and every
 *  toggle/open chord. */
export type DispatchableAction = AppActionBase & {
  handler: (ctx: ActionContext) => void;
};

/** An action that's registered only for help/palette/passthrough display.
 *  Dispatch lives elsewhere because it needs state the registry can't
 *  carry: `cycleTerminalMru` snapshots MRU order in a closure inside
 *  `useShortcuts` and commits on modifier keyup; `zoom*` is owned by the
 *  per-terminal `createZoom` listener. They still appear in
 *  `matchesAnyShortcut` so xterm doesn't consume their chords. */
export type DisplayOnlyAction = AppActionBase;

export type AppAction = DispatchableAction | DisplayOnlyAction;

/** Type guard: does this action carry a registry-dispatched handler? */
export function isDispatchable(a: AppAction): a is DispatchableAction {
  return "handler" in a;
}

/** Cycle to the next/previous terminal by position. */
function cycleTerminalByPosition(ctx: ActionContext, direction: 1 | -1) {
  const ids = nonEmpty(ctx.terminalIds());
  if (!ids) return;
  const current = ids.indexOf(ctx.activeId() as TerminalId);
  const next = (current + direction + ids.length) % ids.length;
  // Tuple positional `ids[0]` is statically `TerminalId`; `?? ids[0]` is
  // a typed fallback the math never actually triggers.
  ctx.activate(ids[next] ?? ids[0]);
}

/** Mod+1 through Mod+9 — direct positional terminal switch. */
const SWITCH_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
type SwitchKey = (typeof SWITCH_KEYS)[number];
type SwitchId = `switchTo${SwitchKey}`;

const switchToActions = Object.fromEntries(
  SWITCH_KEYS.map((i) => [
    `switchTo${i}`,
    {
      label: `Switch to terminal ${i}`,
      keybind: { key: String(i), mod: true },
      handler: (ctx) => {
        // Targets dock row order (recency-sorted) so `Cmd+i` activates
        // whatever the user sees at row `i` — same surface the
        // Alt-held numeric hints overlay on the dock rows.
        const target = ctx.dockOrderedIds()[i - 1];
        if (target !== undefined) ctx.activate(target);
      },
    } satisfies DispatchableAction,
  ]),
) as { [K in SwitchId]: DispatchableAction };

/** HTML data-attribute name that marks a terminal subtree — the focus scope
 *  Cmd/Ctrl+F is confined to (outside it, the chord defers to the browser's
 *  find-in-page). Place `{...TERMINAL_SEARCH_ATTR_PROP}` on the terminal root
 *  and reference `TERMINAL_SEARCH_MARKER` (the CSS selector derived from it) in
 *  the action registry. Both share this single source of truth so they can't
 *  drift. */
export const TERMINAL_SEARCH_ATTR = "data-kolu-terminal-search";
/** CSS attribute selector derived from `TERMINAL_SEARCH_ATTR`. Used by the
 *  `findInTerminal` action's `focusScopeMarker` field for dispatcher scoping. */
export const TERMINAL_SEARCH_MARKER = `[${TERMINAL_SEARCH_ATTR}]`;
/** JSX spread props that stamp `TERMINAL_SEARCH_ATTR` onto an element. */
export const TERMINAL_SEARCH_ATTR_PROP: Record<string, string> = {
  [TERMINAL_SEARCH_ATTR]: "",
};

// `_ACTIONS` keeps each entry's literal shape so `keyof typeof _ACTIONS`
// produces the precise `ActionId` union. `ACTIONS` re-types it through
// `Record<ActionId, AppAction>` so consumers see a uniform `AppAction` at
// every access site (optional `handler`/`altKeybind` properly typed),
// instead of a discriminated union where some variants lack those fields.
const _ACTIONS = {
  ...switchToActions,
  createTerminal: {
    label: "New terminal",
    keybind: { key: "t", mod: true },
    altKeybind: { key: "Enter", mod: true },
    handler: (ctx) => ctx.handleCreate(ctx.activeMeta()?.cwd ?? undefined),
  },
  newTerminalMenu: {
    label: "New terminal menu",
    keybind: { key: "Enter", mod: true, shift: true },
    handler: (ctx) => ctx.openNewTerminalMenu(),
  },
  nextTerminal: {
    label: "Next terminal",
    keybind: { key: "]", code: "BracketRight", mod: true, shift: true },
    handler: (ctx) => cycleTerminalByPosition(ctx, 1),
  },
  prevTerminal: {
    label: "Previous terminal",
    keybind: { key: "[", code: "BracketLeft", mod: true, shift: true },
    handler: (ctx) => cycleTerminalByPosition(ctx, -1),
  },
  cycleTerminalMru: {
    label: "Cycle terminals by most recent use",
    // shiftOptional: shift modulates direction (forward/back) rather than
    // selecting a different chord. alt covers macOS Chrome, which captures
    // Ctrl+Tab. Dispatch is stateful (snapshot/cursor in useShortcuts).
    keybind: { key: "Tab", code: "Tab", ctrl: true, shiftOptional: true },
    altKeybind: { key: "Tab", code: "Tab", alt: true, shiftOptional: true },
  },
  commandPalette: {
    label: "Command palette",
    keybind: { key: "k", mod: true },
    handler: (ctx) => ctx.setPaletteOpen((v) => !v),
  },
  openWorkspaceSwitcher: {
    label: "Workspace switcher",
    keybind: { key: "K", code: "KeyK", mod: true, shift: true },
    handler: (ctx) => ctx.openWorkspaceSwitcher(),
  },
  shortcutsHelp: {
    label: "Shortcuts help",
    keybind: { key: "/", mod: true },
    handler: (ctx) => ctx.setShortcutsHelpOpen((v) => !v),
  },
  findInTerminal: {
    label: "Find in terminal",
    keybind: { key: "f", mod: true },
    // Confine Cmd/Ctrl+F to the terminal: kolu's xterm search is the right tool
    // ONLY there, because terminal content is canvas-rendered and invisible to
    // the browser's own find. Everywhere else — Code tab, previews, panels, the
    // command palette / workspace switcher, bare chrome — focus is in real DOM
    // or iframes, so the dispatcher declines without `preventDefault` and the
    // browser's native find-in-page takes over (it even spans the opaque-origin
    // preview iframe, which xterm search can't reach). The terminal root carries
    // `data-kolu-terminal-search`; the dispatcher does the `closest()` check and
    // claims the chord only when focus is inside it (useShortcuts.ts).
    focusScopeMarker: TERMINAL_SEARCH_MARKER,
    handler: (ctx) => ctx.setSearchOpen((v) => !v),
  },
  zoomIn: {
    label: "Zoom in",
    keybind: { key: "+", mod: true },
    // Dispatched by per-terminal createZoom listener.
  },
  zoomOut: {
    label: "Zoom out",
    keybind: { key: "-", mod: true },
  },
  zoomReset: {
    label: "Reset zoom",
    keybind: { key: "0", mod: true },
  },
  toggleSubPanel: {
    label: "Toggle terminal split",
    keybind: { key: "`", code: "Backquote", ctrl: true },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id) ctx.toggleSubPanel(id);
    },
  },
  createSubTerminal: {
    label: "Split terminal",
    keybind: { key: "`", code: "Backquote", ctrl: true, shift: true },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id)
        ctx.handleCreateSubTerminal(id, ctx.activeMeta()?.cwd ?? undefined);
    },
  },
  nextSubTab: {
    label: "Next split tab",
    keybind: { key: "PageDown", code: "PageDown", ctrl: true },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id) ctx.cycleSubTab(id, 1);
    },
  },
  prevSubTab: {
    label: "Previous split tab",
    keybind: { key: "PageUp", code: "PageUp", ctrl: true },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id) ctx.cycleSubTab(id, -1);
    },
  },
  shuffleTheme: {
    label: "Shuffle theme",
    // Mod+Shift+J — bare Mod+J on Linux collided with Claude Code's
    // in-PTY newline shortcut (Ctrl+J). The shifted chord stays
    // memorable, frees Ctrl+J to reach the PTY, and matches the
    // Mod+Shift+<letter> convention used by openWorkspaceSwitcher
    // and screenshotTerminal. Closes #873.
    keybind: { key: "J", code: "KeyJ", mod: true, shift: true },
    handler: (ctx) => ctx.handleShuffleTheme(),
  },
  screenshotTerminal: {
    label: "Screenshot terminal",
    keybind: { key: "S", code: "KeyS", mod: true, shift: true },
    handler: (ctx) => ctx.handleScreenshotTerminal(),
  },
  copySelection: {
    label: "Copy selection",
    // Physical Ctrl (not platform mod) — Linux/Windows terminal chord.
    // Dispatch is xterm-handler-local (Terminal.tsx) because xterm's
    // selection lives outside the textarea, so the action only makes
    // sense with a live xterm ref. Registered here for ShortcutsHelp
    // visibility and so matchesAnyShortcut sees it.
    keybind: { key: "C", code: "KeyC", ctrl: true, shift: true },
  },
  toggleRightPanel: {
    // The action toggles panel *visibility* only; it lands on whichever tab
    // is active (Code by default), so the label is tab-agnostic rather than
    // "inspector".
    label: "Toggle right panel",
    keybind: { key: "b", code: "KeyB", mod: true, alt: true },
    handler: (ctx) => ctx.toggleRightPanel(),
  },
  toggleDock: {
    label: "Toggle dock (rail / cards)",
    // Mod+Shift+B — bare Mod+B on Linux/Windows resolves to Ctrl+B,
    // which Claude Code claims as its in-PTY background-task chord.
    // The shifted form keeps the B mnemonic for the left panel and
    // frees Ctrl+B to reach the PTY. See `prohibitedKeybinds.ts`.
    keybind: { key: "B", code: "KeyB", mod: true, shift: true },
    handler: (ctx) => ctx.toggleDock(),
  },
  toggleCanvasPosture: {
    label: "Maximize / restore terminal",
    // Mod+Shift+M — M for maximize. The shifted form matches the
    // Mod+Shift+<letter> convention shared by toggleDock, shuffleTheme,
    // and screenshotTerminal, and stays clear of the in-PTY chords in
    // `prohibitedKeybinds.ts` (Ctrl+B, Ctrl+J).
    keybind: { key: "M", code: "KeyM", mod: true, shift: true },
    handler: (ctx) => ctx.toggleCanvasPosture(),
  },
  toggleRecordingPause: {
    label: "Pause / resume recording",
    keybind: { key: ".", code: "Period", mod: true, shift: true },
    handler: (ctx) => ctx.toggleRecordingPause(),
  },
} satisfies Record<string, AppAction>;

export type ActionId = keyof typeof _ACTIONS;
export const ACTIONS: Record<ActionId, AppAction> = _ACTIONS;

/** The chord to advertise for "new terminal" in welcome surfaces. Prefer the
 *  alt chord (Cmd+Enter): the primary Cmd+T is intercepted by browsers outside
 *  PWA-installed mode, so the alt is the universally-functional advert. */
export const advertisedNewTerminalKey: Keybind =
  ACTIONS.createTerminal.altKeybind ?? ACTIONS.createTerminal.keybind;

/** Match the event against an action's primary or alt keybind. This is the
 *  pure keybind rule, shared by both the dispatch path (`dispatch` in
 *  useShortcuts.ts, which layers the `focusScopeMarker` consultation on top)
 *  and the xterm path (`matchesAnyShortcut` below, which must NOT consult
 *  markers). */
export function actionMatchesKeybind(
  action: AppAction,
  e: KeyboardEvent,
): boolean {
  return (
    matchesKeybind(e, action.keybind) ||
    (action.altKeybind !== undefined && matchesKeybind(e, action.altKeybind))
  );
}

/** A focus-scoped action claims its chord ONLY when focus is inside its scope.
 *  Returns true when the action is scoped but the event target is NOT inside the
 *  marker — the dispatcher then declines the chord (no preventDefault), letting
 *  the browser's native default fire. Shared by the dispatch path (`dispatch` in
 *  useShortcuts.ts) and its unit test so both drive the same rule. */
export function isOutsideFocusScope(
  action: AppAction,
  e: KeyboardEvent,
): boolean {
  return (
    action.focusScopeMarker != null &&
    (e.target as Element | null)?.closest?.(action.focusScopeMarker) == null
  );
}

/**
 * Check if a KeyboardEvent matches any registered action's keybind.
 * Used by xterm's key handler to let app shortcuts bubble through
 * instead of being consumed by the terminal.
 */
export function matchesAnyShortcut(e: KeyboardEvent): boolean {
  for (const a of Object.values(ACTIONS)) {
    if (actionMatchesKeybind(a, e)) return true;
  }
  return false;
}

/** Action ids whose registry entry is a `DispatchableAction` — i.e. has a
 *  handler that the keyboard dispatcher and palette can both invoke. */
export type DispatchableId = {
  [K in ActionId]: (typeof _ACTIONS)[K] extends DispatchableAction ? K : never;
}[ActionId];

/**
 * Build a palette command from a registered action — same label, same keybind,
 * same handler. The id is constrained to `DispatchableId` so palette callers
 * can't accidentally mount a display-only action (which would render a
 * clickable entry that silently does nothing).
 */
export function actionPaletteCommand(
  id: DispatchableId,
  ctx: ActionContext,
  overrides: { name?: string; description?: string; section?: SectionId } = {},
): PaletteAction {
  const a = ACTIONS[id] as DispatchableAction;
  return {
    kind: "action",
    name: overrides.name ?? a.label,
    description: overrides.description,
    section: overrides.section,
    keybind: a.keybind,
    onSelect: () => a.handler(ctx),
  };
}
