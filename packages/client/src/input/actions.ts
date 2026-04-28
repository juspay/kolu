/**
 * Unified action registry — single source of truth for keyboard shortcuts,
 * the help overlay, and shared palette command metadata. Each entry binds an
 * id to its label, keybind, handler, and surface flags.
 *
 * Adding or rebinding a global action touches this one file. The dispatcher
 * in `useShortcuts.ts` loops over `ACTIONS`; `ShortcutsHelp.tsx` walks
 * `HELP_ORDER` against the registry; `commands.ts` derives palette entries
 * via `actionPaletteCommand`.
 */

import type { TerminalId, TerminalMetadata } from "kolu-common";
import { nonEmpty } from "nonempty";
import type { Accessor, Setter } from "solid-js";
import type { PaletteCommand } from "../CommandPalette";
import { type Keybind, matchesKeybind } from "./keyboard";

/** Shared handler context — every dispatched action receives this. */
export interface ActionContext {
  terminalIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  setActiveId: Setter<TerminalId | null>;
  /** Terminal IDs in most-recently-used order; used for Alt+Tab / Ctrl+Tab cycling. */
  mruOrder: Accessor<TerminalId[]>;
  activeMeta: Accessor<TerminalMetadata | null>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  openNewTerminalMenu: () => void;
  setPaletteOpen: Setter<boolean>;
  setShortcutsHelpOpen: Setter<boolean>;
  setSearchOpen: Setter<boolean>;
  /** Toggle sub-panel: creates first split if none exist, otherwise toggles visibility. */
  toggleSubPanel: (parentId: TerminalId) => void;
  cycleSubTab: (parentId: TerminalId, direction: 1 | -1) => void;
  handleShuffleTheme: () => void;
  handleScreenshotTerminal: () => void;
  toggleRightPanel: () => void;
  canvasCenterActive: () => void;
  toggleRecordingPause: () => void;
}

export interface AppAction {
  id: string;
  label: string;
  keybind: Keybind;
  /** Optional alternate keybind that triggers the same handler (e.g. Cmd+Enter for "New terminal"). */
  altKeybind?: Keybind;
  /** Handler invoked by the keyboard dispatcher and by palette entries derived
   *  via `actionPaletteCommand`. Absent for entries whose dispatch is
   *  inherently stateful or owned by another listener (e.g. `cycleTerminalMru`
   *  is committed on modifier keyup; `zoom*` is handled per-terminal in
   *  `createZoom`). The entry remains registered for help/palette display. */
  handler?: (ctx: ActionContext) => void;
}

/** Cycle to the next/previous terminal by position. */
function cycleTerminalByPosition(ctx: ActionContext, direction: 1 | -1) {
  const ids = nonEmpty(ctx.terminalIds());
  if (!ids) return;
  const current = ids.indexOf(ctx.activeId() as TerminalId);
  const next = (current + direction + ids.length) % ids.length;
  // Tuple positional `ids[0]` is statically `TerminalId`; `?? ids[0]` is
  // a typed fallback the math never actually triggers.
  ctx.setActiveId(ids[next] ?? ids[0]);
}

/** Mod+1 through Mod+9 — direct positional terminal switch. */
const SWITCH_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
type SwitchKey = (typeof SWITCH_KEYS)[number];
type SwitchId = `switchTo${SwitchKey}`;

const switchToActions = Object.fromEntries(
  SWITCH_KEYS.map((i) => [
    `switchTo${i}`,
    {
      id: `switchTo${i}`,
      label: `Switch to terminal ${i}`,
      keybind: { key: String(i), mod: true },
      handler: (ctx) => {
        const target = ctx.terminalIds()[i - 1];
        if (target !== undefined) ctx.setActiveId(target);
      },
    } satisfies AppAction,
  ]),
) as { [K in SwitchId]: AppAction };

// `_ACTIONS` keeps each entry's literal shape so `keyof typeof _ACTIONS`
// produces the precise `ActionId` union. `ACTIONS` re-types it through
// `Record<ActionId, AppAction>` so consumers see a uniform `AppAction` at
// every access site (optional `handler`/`altKeybind` properly typed),
// instead of a discriminated union where some variants lack those fields.
const _ACTIONS = {
  ...switchToActions,
  createTerminal: {
    id: "createTerminal",
    label: "New terminal",
    keybind: { key: "t", mod: true },
    altKeybind: { key: "Enter", mod: true },
    handler: (ctx) => ctx.handleCreate(ctx.activeMeta()?.cwd ?? undefined),
  },
  newTerminalMenu: {
    id: "newTerminalMenu",
    label: "New terminal menu",
    keybind: { key: "Enter", mod: true, shift: true },
    handler: (ctx) => ctx.openNewTerminalMenu(),
  },
  nextTerminal: {
    id: "nextTerminal",
    label: "Next terminal",
    keybind: { key: "]", code: "BracketRight", mod: true, shift: true },
    handler: (ctx) => cycleTerminalByPosition(ctx, 1),
  },
  prevTerminal: {
    id: "prevTerminal",
    label: "Previous terminal",
    keybind: { key: "[", code: "BracketLeft", mod: true, shift: true },
    handler: (ctx) => cycleTerminalByPosition(ctx, -1),
  },
  cycleTerminalMru: {
    id: "cycleTerminalMru",
    label: "Cycle terminals by most recent use",
    keybind: { key: "Tab", code: "Tab", ctrl: true },
    // Dispatched by the stateful Alt+Tab/Ctrl+Tab cycle in useShortcuts.
  },
  commandPalette: {
    id: "commandPalette",
    label: "Command palette",
    keybind: { key: "k", mod: true },
    handler: (ctx) => ctx.setPaletteOpen((v) => !v),
  },
  shortcutsHelp: {
    id: "shortcutsHelp",
    label: "Shortcuts help",
    keybind: { key: "/", mod: true },
    handler: (ctx) => ctx.setShortcutsHelpOpen((v) => !v),
  },
  findInTerminal: {
    id: "findInTerminal",
    label: "Find in terminal",
    keybind: { key: "f", mod: true },
    handler: (ctx) => ctx.setSearchOpen((v) => !v),
  },
  zoomIn: {
    id: "zoomIn",
    label: "Zoom in",
    keybind: { key: "+", mod: true },
    // Dispatched by per-terminal createZoom listener.
  },
  zoomOut: {
    id: "zoomOut",
    label: "Zoom out",
    keybind: { key: "-", mod: true },
  },
  zoomReset: {
    id: "zoomReset",
    label: "Reset zoom",
    keybind: { key: "0", mod: true },
  },
  toggleSubPanel: {
    id: "toggleSubPanel",
    label: "Toggle terminal split",
    keybind: { key: "`", code: "Backquote", ctrl: true },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id) ctx.toggleSubPanel(id);
    },
  },
  createSubTerminal: {
    id: "createSubTerminal",
    label: "Split terminal",
    keybind: { key: "`", code: "Backquote", ctrl: true, shift: true },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id)
        ctx.handleCreateSubTerminal(id, ctx.activeMeta()?.cwd ?? undefined);
    },
  },
  nextSubTab: {
    id: "nextSubTab",
    label: "Next split tab",
    keybind: { key: "PageDown", code: "PageDown", ctrl: true },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id) ctx.cycleSubTab(id, 1);
    },
  },
  prevSubTab: {
    id: "prevSubTab",
    label: "Previous split tab",
    keybind: { key: "PageUp", code: "PageUp", ctrl: true },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id) ctx.cycleSubTab(id, -1);
    },
  },
  shuffleTheme: {
    id: "shuffleTheme",
    label: "Shuffle theme",
    keybind: { key: "j", mod: true },
    handler: (ctx) => ctx.handleShuffleTheme(),
  },
  screenshotTerminal: {
    id: "screenshotTerminal",
    label: "Screenshot terminal",
    keybind: { key: "S", code: "KeyS", mod: true, shift: true },
    handler: (ctx) => ctx.handleScreenshotTerminal(),
  },
  toggleRightPanel: {
    id: "toggleRightPanel",
    label: "Toggle inspector panel",
    keybind: { key: "b", code: "KeyB", mod: true },
    handler: (ctx) => ctx.toggleRightPanel(),
  },
  canvasCenterActive: {
    id: "canvasCenterActive",
    label: "Center on active tile",
    keybind: { key: "C", code: "KeyC", mod: true, shift: true },
    handler: (ctx) => ctx.canvasCenterActive(),
  },
  toggleRecordingPause: {
    id: "toggleRecordingPause",
    label: "Pause / resume recording",
    keybind: { key: ".", code: "Period", mod: true, shift: true },
    handler: (ctx) => ctx.toggleRecordingPause(),
  },
} satisfies Record<string, AppAction>;

export type ActionId = keyof typeof _ACTIONS;
export const ACTIONS: Record<ActionId, AppAction> = _ACTIONS;

/**
 * Check if a KeyboardEvent matches any registered action's keybind.
 * Used by xterm's key handler to let app shortcuts bubble through
 * instead of being consumed by the terminal.
 */
export function matchesAnyShortcut(e: KeyboardEvent): boolean {
  // Alt+Tab is not a registry keybind (Ctrl+Tab is, via cycleTerminalMru) but
  // it triggers the same MRU cycle and must not leak to the terminal.
  if (e.altKey && e.key === "Tab") return true;
  for (const a of Object.values(ACTIONS)) {
    if (matchesKeybind(e, a.keybind)) return true;
    if (a.altKeybind !== undefined && matchesKeybind(e, a.altKeybind))
      return true;
  }
  return false;
}

/**
 * Build a palette command from a registered action — same label, same keybind,
 * same handler. Lets palette code reference an action by id and inherit its
 * metadata, instead of restating label/keybind/handler at the call site.
 */
export function actionPaletteCommand(
  id: ActionId,
  ctx: ActionContext,
  overrides: Partial<Pick<PaletteCommand, "name" | "description">> = {},
): PaletteCommand {
  const a = ACTIONS[id];
  return {
    name: overrides.name ?? a.label,
    description: overrides.description,
    keybind: a.keybind,
    onSelect: () => a.handler?.(ctx),
  };
}
