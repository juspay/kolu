/** Command palette registry — declarative list of all app-level actions. */

import { createMemo, batch } from "solid-js";
import type { Accessor } from "solid-js";
import type { PaletteCommand, PaletteItem } from "./CommandPalette";
import { SHORTCUTS } from "./input/keyboard";
import { availableThemes } from "./theme";
import type { TerminalId, TerminalMetadata, RecentAgent } from "kolu-common";
import { useServerState } from "./settings/useServerState";
import { client } from "./rpc/rpc";

/** PaletteItems listing each recent agent command. Used by the Debug →
 *  "Recent agents" entry (phase 1 prefill flow). */
function agentItems(
  agents: RecentAgent[],
  onPick: (command: string) => void,
): PaletteItem[] {
  return agents.map((a) => ({
    name: a.command,
    onSelect: () => onPick(a.command),
  }));
}

/** PaletteItems for a "create fresh terminal, optionally with an agent"
 *  flow. Prepends "Plain shell" to the agent list so the default (empty
 *  worktree) stays the keyboard-flow default. Used by phase 2's
 *  recent-repo sub-palette under "New terminal". */
function agentItemsWithPlainShell(
  agents: RecentAgent[],
  onPickPlainShell: () => void,
  onPickAgent: (command: string) => void,
): PaletteItem[] {
  return [
    { name: "Plain shell", onSelect: onPickPlainShell },
    ...agentItems(agents, onPickAgent),
  ];
}

export interface CommandDeps {
  terminalIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  setActiveId: (id: TerminalId) => void;
  activeMeta: Accessor<TerminalMetadata | null>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  handleCopyTerminalText: () => void;
  handleRunInActiveTerminal: (command: string) => void;
  handleExportSessionAsPdf: () => void;
  /** Toggle sub-panel: creates first split if none exist, otherwise toggles visibility. */
  toggleSubPanel: (parentId: TerminalId) => void;
  // Theme
  committedThemeName: Accessor<string>;
  setPreviewThemeName: (name: string | undefined) => void;
  handleSetTheme: (name: string) => void;
  handleRandomizeTheme: () => void;
  handleVariegateTheme: () => void;
  // Dialogs
  setShortcutsHelpOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  // Right panel
  toggleRightPanel: () => void;
  // Worktree
  handleCreateWorktree: (repoPath: string, initialCommand?: string) => void;
  handleClose: () => void;
  // Debug
  simulateAlert: () => void;
  handleCloseAll: () => void;
}

export function createCommands(deps: CommandDeps): Accessor<PaletteCommand[]> {
  const { recentRepos, recentAgents } = useServerState();

  return createMemo((): PaletteCommand[] => [
    {
      name: "New terminal",
      children: (): PaletteItem[] => {
        const repos = recentRepos();
        // `hasAgents` decides leaf-vs-group shape at memo time; the nested
        // `children` accessor re-reads `recentAgents()` live so the sub-
        // palette reflects agent MRU changes between drilling into "New
        // terminal" and drilling into a specific repo. Mirrors the pattern
        // used by the Debug → "Recent agents" entry below.
        const hasAgents = recentAgents().length > 0;
        return [
          {
            name: "In current directory",
            onSelect: () => deps.handleCreate(deps.activeMeta()?.cwd),
          },
          // Recent-repo entries. When the user has any known-agent CLI in
          // their MRU, picking a repo opens a sub-palette (Plain shell +
          // agents). With no recent agents, the entry stays a flat leaf
          // that creates a plain-shell worktree — exact pre-phase-2
          // behavior, so first-run UX is unchanged.
          ...repos.map((r) =>
            hasAgents
              ? {
                  name: r.repoName,
                  description: `New worktree in ${r.repoRoot}`,
                  children: (): PaletteItem[] =>
                    agentItemsWithPlainShell(
                      recentAgents(),
                      () => deps.handleCreateWorktree(r.repoRoot),
                      (cmd) => deps.handleCreateWorktree(r.repoRoot, cmd),
                    ),
                }
              : {
                  name: r.repoName,
                  description: `New worktree in ${r.repoRoot}`,
                  onSelect: () => deps.handleCreateWorktree(r.repoRoot),
                },
          ),
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
            onSelect: () => deps.toggleSubPanel(deps.activeId()!),
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
    {
      name: "Toggle inspector panel",
      keybind: SHORTCUTS.toggleRightPanel.keybind,
      onSelect: () => deps.toggleRightPanel(),
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
          {
            name: "Variegated theme",
            description:
              "Pick a theme whose background is perceptually distinct from this terminal's current one",
            keybind: SHORTCUTS.variegateTheme.keybind,
            onSelect: () => deps.handleVariegateTheme(),
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
        // "Recent agents" — surfaces agent CLIs the user has previously run
        // in any kolu terminal, auto-detected via the preexec OSC 633;E
        // command mark. Parked under Debug during phase 1 while the feature
        // is soft-launched. Only visible when at least one agent has been
        // seen AND there is an active terminal to prefill it into.
        ...(deps.activeId() !== null && recentAgents().length > 0
          ? [
              {
                name: "Recent agents",
                description: "Prefill an agent CLI into the active terminal",
                children: (): PaletteItem[] =>
                  agentItems(recentAgents(), deps.handleRunInActiveTerminal),
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
