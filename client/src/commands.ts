/** Command palette registry — declarative list of all app-level actions. */

import { createMemo, batch } from "solid-js";
import type { Accessor } from "solid-js";
import type { PaletteCommand, PaletteItem } from "./CommandPalette";
import { SHORTCUTS } from "./keyboard";
import { availableThemes } from "./theme";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import { useServerState } from "./useServerState";
import { client } from "./rpc";

export interface CommandDeps {
  terminalIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  setActiveId: (id: TerminalId) => void;
  activeMeta: Accessor<TerminalMetadata | null>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  handleCopyTerminalText: () => void;
  handleExportSessionAsPdf: () => void;
  getSubTerminalIds: (parentId: TerminalId) => TerminalId[];
  toggleSubPanel: (parentId: TerminalId) => void;
  // Theme
  committedThemeName: Accessor<string>;
  setPreviewThemeName: (name: string | undefined) => void;
  handleSetTheme: (name: string) => void;
  handleRandomizeTheme: () => void;
  // Dialogs
  setShortcutsHelpOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  // Worktree
  handleCreateWorktree: (repoPath: string) => void;
  handleClose: () => void;
  // Debug
  simulateAlert: () => void;
  handleCloseAll: () => void;
  setClaudeTranscriptOpen: (open: boolean) => void;
}

export function createCommands(deps: CommandDeps): Accessor<PaletteCommand[]> {
  const { recentRepos } = useServerState();

  return createMemo((): PaletteCommand[] => [
    {
      name: "New terminal",
      children: (): PaletteItem[] => {
        const repos = recentRepos();
        return [
          {
            name: "In current directory",
            onSelect: () => deps.handleCreate(deps.activeMeta()?.cwd),
          },
          ...repos.map((r) => ({
            name: r.repoName,
            description: `New worktree in ${r.repoRoot}`,
            onSelect: () => deps.handleCreateWorktree(r.repoRoot),
          })),
          ...(repos.length === 0
            ? [
                {
                  kind: "hint" as const,
                  text: "Repos you cd into will appear here",
                },
              ]
            : []),
        ];
      },
    },
    ...(deps.activeId() !== null
      ? [
          {
            name: "Close terminal",
            onSelect: () => deps.handleClose(),
          },
          {
            name: "Toggle terminal split",
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
            name: "Split terminal",
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
          {
            name: "Export session as PDF",
            keybind: SHORTCUTS.exportSessionAsPdf.keybind,
            onSelect: () => deps.handleExportSessionAsPdf(),
          },
        ]
      : []),
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
          name: "Simulate activity alert",
          onSelect: () => deps.simulateAlert(),
        },
        ...(deps.activeMeta()?.claude != null
          ? [
              {
                name: "Show Claude transcript",
                onSelect: () => deps.setClaudeTranscriptOpen(true),
              },
            ]
          : []),
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
          name: "Close all terminals",
          onSelect: () => deps.handleCloseAll(),
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
