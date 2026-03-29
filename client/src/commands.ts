/** Command palette registry — declarative list of all app-level actions. */

import { createMemo, batch } from "solid-js";
import type { Accessor } from "solid-js";
import type { PaletteCommand } from "./CommandPalette";
import type { MCMode } from "./MissionControl";
import { SHORTCUTS } from "./keyboard";
import { availableThemes } from "./theme";
import { toast } from "solid-sonner";
import { client } from "./rpc";
import type { TerminalId, TerminalMetadata } from "kolu-common";

export interface CommandDeps {
  terminalIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  setActiveId: (id: TerminalId) => void;
  activeMeta: Accessor<TerminalMetadata | null>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  handleKill: (id: TerminalId) => void;
  handleCopyTerminalText: () => void;
  getSubTerminalIds: (parentId: TerminalId) => TerminalId[];
  toggleSubPanel: (parentId: TerminalId) => void;
  // Theme
  committedThemeName: Accessor<string>;
  setPreviewThemeName: (name: string | undefined) => void;
  handleSetTheme: (name: string) => void;
  handleRandomizeTheme: () => void;
  // Dialogs
  setMcMode: (mode: MCMode) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  // Worktree
  handleCloseWorktreeTerminal: () => void;
}

export function createCommands(deps: CommandDeps): Accessor<PaletteCommand[]> {
  return createMemo((): PaletteCommand[] => [
    {
      name: "Create new terminal",
      keybind: [
        SHORTCUTS.createTerminal.keybind,
        SHORTCUTS.createTerminalAlt.keybind,
      ],
      onSelect: () => deps.handleCreate(),
    },
    ...(deps.activeMeta()?.git
      ? [
          {
            name: `New worktree (${deps.activeMeta()!.git!.repoName})`,
            onSelect: () => {
              const git = deps.activeMeta()!.git!;
              void (async () => {
                try {
                  const result = await client.git.worktreeCreate({
                    repoPath: git.mainRepoRoot,
                  });
                  toast(
                    result.isNew
                      ? `Created worktree ${result.branch}`
                      : `Opened worktree ${result.branch}`,
                  );
                  deps.handleCreate(result.path);
                } catch (err) {
                  toast.error(`Failed to create worktree: ${err}`);
                }
              })();
            },
          },
        ]
      : []),
    ...(deps.activeMeta()?.git?.isWorktree
      ? [
          {
            name: "Close terminal and remove worktree",
            onSelect: () => deps.handleCloseWorktreeTerminal(),
          },
        ]
      : []),
    ...(deps.activeId() !== null
      ? [
          {
            name: "Close terminal",
            onSelect: () => deps.handleKill(deps.activeId()!),
          },
          {
            name: "Toggle sub-panel",
            keybind: SHORTCUTS.toggleSubPanel.keybind,
            onSelect: () => {
              const id = deps.activeId()!;
              if (deps.getSubTerminalIds(id).length === 0) {
                deps.handleCreateSubTerminal(id, deps.activeMeta()?.cwd);
              } else {
                deps.toggleSubPanel(id);
              }
            },
          },
          {
            name: "New sub-terminal",
            keybind: SHORTCUTS.createSubTerminal.keybind,
            onSelect: () =>
              deps.handleCreateSubTerminal(
                deps.activeId()!,
                deps.activeMeta()?.cwd,
              ),
          },
          {
            name: "Copy terminal text",
            keybind: SHORTCUTS.copyTerminalText.keybind,
            onSelect: () => deps.handleCopyTerminalText(),
          },
        ]
      : []),
    {
      name: "Mission Control",
      keybind: [
        SHORTCUTS.missionControl.keybind,
        SHORTCUTS.nextTerminalTab.keybind,
      ],
      onSelect: () => deps.setMcMode({ mode: "browse" }),
    },
    ...(deps.terminalIds().length > 0
      ? [
          {
            name: "Switch terminal",
            children: () =>
              deps.terminalIds().map((id, i) => ({
                name: `Switch to terminal ${i + 1}`,
                keybind:
                  i < 9
                    ? SHORTCUTS[
                        `switchTo${(i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
                      ].keybind
                    : undefined,
                onSelect: () => deps.setActiveId(id),
              })),
          },
        ]
      : []),
    {
      name: "Theme",
      onCancel: () => deps.setPreviewThemeName(undefined),
      children: () =>
        availableThemes
          .filter((t) => t.name !== deps.committedThemeName())
          .map((t) => ({
            name: t.name,
            onHighlight: () => deps.setPreviewThemeName(t.name),
            onSelect: () =>
              batch(() => {
                deps.setPreviewThemeName(undefined);
                deps.handleSetTheme(t.name);
              }),
          })),
    },
    ...(deps.activeId() !== null
      ? [
          {
            name: "Random theme",
            keybind: SHORTCUTS.randomizeTheme.keybind,
            onSelect: () => deps.handleRandomizeTheme(),
          },
        ]
      : []),
    {
      name: "Keyboard shortcuts",
      keybind: SHORTCUTS.shortcutsHelp.keybind,
      onSelect: () => deps.setShortcutsHelpOpen(true),
    },
    {
      name: "About kolu",
      onSelect: () => deps.setAboutOpen(true),
    },
    {
      name: "Debug",
      children: [
        {
          name: "Trigger server error",
          onSelect: () =>
            void client.terminal.resize({
              id: "00000000-0000-0000-0000-000000000000",
              cols: 1,
              rows: 1,
            }),
        },
        {
          name: "Clear localStorage",
          onSelect: () => {
            localStorage.clear();
            location.reload();
          },
        },
      ],
    },
  ]);
}
