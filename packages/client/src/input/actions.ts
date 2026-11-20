import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { nonEmpty } from "nonempty";
import type { Accessor } from "solid-js";
import type { PaletteAction, SectionId } from "../CommandPalette";
import { type Keybind, matchesKeybind } from "./keyboard";

export interface ActionContext {
  terminalIds: Accessor<TerminalId[]>;
  dockOrderedIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  activate: (id: TerminalId | null) => void;
  mruOrder: Accessor<TerminalId[]>;
  activeMeta: Accessor<TerminalMetadata | null>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  openNewTerminalMenu: () => void;
  openWorkspaceSwitcher: () => void;
  openHostSwitcher: () => void;
  togglePalette: () => void;
  toggleShortcutsHelp: () => void;
  toggleSearch: () => void;
  toggleSubPanel: (parentId: TerminalId) => void;
  cycleSubTab: (parentId: TerminalId, direction: 1 | -1) => void;
  handleShuffleTheme: () => void;
  handleScreenshotTerminal: () => void;
  toggleRightPanel: () => void;
  toggleDock: () => void;
  toggleCanvasPosture: () => void;
  toggleConductor: () => void;
  toggleRecordingPause: () => void;
}

interface AppActionBase {
  label: string;
  keybind: Keybind;
  altKeybind?: Keybind;
  focusScopeMarker?: string;
}

export type DispatchableAction = AppActionBase & {
  handler: (ctx: ActionContext) => void;
};

export type DisplayOnlyAction = AppActionBase;

export type AppAction = DispatchableAction | DisplayOnlyAction;

export function isDispatchable(a: AppAction): a is DispatchableAction {
  return "handler" in a;
}

function activeLiveTileId(ctx: ActionContext): TerminalId | null {
  return activeArm(ctx.activeMeta()) ? ctx.activeId() : null;
}

function cycleTerminalByPosition(ctx: ActionContext, direction: 1 | -1) {
  const ids = nonEmpty(ctx.terminalIds());
  if (!ids) return;
  const current = ids.indexOf(ctx.activeId() as TerminalId);
  const next = (current + direction + ids.length) % ids.length;
  ctx.activate(ids[next] ?? ids[0]);
}

const SWITCH_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
type SwitchKey = (typeof SWITCH_KEYS)[number];
type SwitchId = `switchTo${SwitchKey}`;

const switchToActions = Object.fromEntries(
  SWITCH_KEYS.map((i) => [
    `switchTo${i}`,
    {
      label: `Switch to terminal ${i}`,
      keybind: { key: String(i), modifier: "cmdOrCtrl" },
      handler: (ctx) => {
        const target = ctx.dockOrderedIds()[i - 1];
        if (target !== undefined) ctx.activate(target);
      },
    } satisfies DispatchableAction,
  ]),
) as { [K in SwitchId]: DispatchableAction };

export const TERMINAL_SEARCH_ATTR = "data-kolu-terminal-search";
export const TERMINAL_SEARCH_MARKER = `[${TERMINAL_SEARCH_ATTR}]`;
export const TERMINAL_SEARCH_ATTR_PROP: Record<string, string> = {
  [TERMINAL_SEARCH_ATTR]: "",
};

const _ACTIONS = {
  ...switchToActions,
  createTerminal: {
    label: "New terminal",
    keybind: { key: "t", code: "KeyT", modifier: "app" },
    altKeybind: { key: "Enter", code: "Enter", modifier: "app" },
    handler: (ctx) => ctx.handleCreate(ctx.activeMeta()?.cwd ?? undefined),
  },
  newTerminalMenu: {
    label: "New terminal menu",
    keybind: { key: "Enter", modifier: "cmdOrCtrl", shift: true },
    handler: (ctx) => ctx.openNewTerminalMenu(),
  },
  nextTerminal: {
    label: "Next terminal",
    keybind: {
      key: "]",
      code: "BracketRight",
      modifier: "cmdOrCtrl",
      shift: true,
    },
    handler: (ctx) => cycleTerminalByPosition(ctx, 1),
  },
  prevTerminal: {
    label: "Previous terminal",
    keybind: {
      key: "[",
      code: "BracketLeft",
      modifier: "cmdOrCtrl",
      shift: true,
    },
    handler: (ctx) => cycleTerminalByPosition(ctx, -1),
  },
  cycleTerminalMru: {
    label: "Cycle terminals by most recent use",
    keybind: { key: "Tab", code: "Tab", modifier: "ctrl", shiftOptional: true },
    altKeybind: { key: "Tab", code: "Tab", alt: true, shiftOptional: true },
  },
  commandPalette: {
    label: "Search everything",
    keybind: { key: "k", code: "KeyK", modifier: "app" },
    handler: (ctx) => ctx.togglePalette(),
  },
  openWorkspaceSwitcher: {
    label: "Terminal switcher",
    keybind: { key: "K", code: "KeyK", modifier: "cmdOrCtrl", shift: true },
    handler: (ctx) => ctx.openWorkspaceSwitcher(),
  },
  openHostSwitcher: {
    label: "Hosts",
    keybind: { key: "H", code: "KeyH", modifier: "cmdOrCtrl", shift: true },
    handler: (ctx) => ctx.openHostSwitcher(),
  },
  shortcutsHelp: {
    label: "Shortcuts help",
    keybind: { key: "/", modifier: "cmdOrCtrl" },
    handler: (ctx) => ctx.toggleShortcutsHelp(),
  },
  findInTerminal: {
    label: "Find in terminal",
    keybind: { key: "f", code: "KeyF", modifier: "app" },
    focusScopeMarker: TERMINAL_SEARCH_MARKER,
    handler: (ctx) => ctx.toggleSearch(),
  },
  zoomIn: {
    label: "Zoom in",
    keybind: { key: "+", modifier: "cmdOrCtrl" },
  },
  zoomOut: {
    label: "Zoom out",
    keybind: { key: "-", modifier: "cmdOrCtrl" },
  },
  zoomReset: {
    label: "Reset zoom",
    keybind: { key: "0", modifier: "cmdOrCtrl" },
  },
  toggleSubPanel: {
    label: "Toggle terminal split",
    keybind: { key: "`", code: "Backquote", modifier: "ctrl" },
    handler: (ctx) => {
      const id = activeLiveTileId(ctx);
      if (id) ctx.toggleSubPanel(id);
    },
  },
  createSubTerminal: {
    label: "Split terminal",
    keybind: { key: "`", code: "Backquote", modifier: "ctrl", shift: true },
    handler: (ctx) => {
      const id = activeLiveTileId(ctx);
      if (id)
        ctx.handleCreateSubTerminal(id, ctx.activeMeta()?.cwd ?? undefined);
    },
  },
  nextSubTab: {
    label: "Next split tab",
    keybind: { key: "PageDown", code: "PageDown", modifier: "ctrl" },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id) ctx.cycleSubTab(id, 1);
    },
  },
  prevSubTab: {
    label: "Previous split tab",
    keybind: { key: "PageUp", code: "PageUp", modifier: "ctrl" },
    handler: (ctx) => {
      const id = ctx.activeId();
      if (id) ctx.cycleSubTab(id, -1);
    },
  },
  shuffleTheme: {
    label: "Shuffle theme",
    keybind: { key: "J", code: "KeyJ", modifier: "cmdOrCtrl", shift: true },
    handler: (ctx) => ctx.handleShuffleTheme(),
  },
  screenshotTerminal: {
    label: "Screenshot terminal",
    keybind: { key: "S", code: "KeyS", modifier: "cmdOrCtrl", shift: true },
    handler: (ctx) => ctx.handleScreenshotTerminal(),
  },
  copySelection: {
    label: "Copy selection",
    keybind: { key: "C", code: "KeyC", modifier: "ctrl", shift: true },
  },
  toggleRightPanel: {
    label: "Toggle right panel",
    keybind: { key: "b", code: "KeyB", modifier: "cmdOrCtrl", alt: true },
    handler: (ctx) => ctx.toggleRightPanel(),
  },
  toggleDock: {
    label: "Toggle dock (rail / cards)",
    keybind: { key: "B", code: "KeyB", modifier: "cmdOrCtrl", shift: true },
    handler: (ctx) => ctx.toggleDock(),
  },
  toggleCanvasPosture: {
    label: "Maximize / restore terminal",
    keybind: { key: "M", code: "KeyM", modifier: "cmdOrCtrl", shift: true },
    handler: (ctx) => ctx.toggleCanvasPosture(),
  },
  toggleConductor: {
    label: "Conductor",
    keybind: { key: "O", code: "KeyO", modifier: "app", shift: true },
    handler: (ctx) => ctx.toggleConductor(),
  },
  toggleRecordingPause: {
    label: "Pause / resume recording",
    keybind: { key: ".", code: "Period", modifier: "cmdOrCtrl", shift: true },
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

export function actionMatchesKeybind(
  action: AppAction,
  e: KeyboardEvent,
): boolean {
  return (
    matchesKeybind(e, action.keybind) ||
    (action.altKeybind !== undefined && matchesKeybind(e, action.altKeybind))
  );
}

export function isOutsideFocusScope(
  action: AppAction,
  e: KeyboardEvent,
): boolean {
  return (
    action.focusScopeMarker != null &&
    (e.target as Element | null)?.closest?.(action.focusScopeMarker) == null
  );
}

export function matchesAnyShortcut(e: KeyboardEvent): boolean {
  for (const a of Object.values(ACTIONS)) {
    if (actionMatchesKeybind(a, e)) return true;
  }
  return false;
}

export type DispatchableId = {
  [K in ActionId]: (typeof _ACTIONS)[K] extends DispatchableAction ? K : never;
}[ActionId];

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
