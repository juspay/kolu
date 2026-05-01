/** Command palette registry — declarative list of all app-level actions. */

import type { RecentAgent } from "kolu-common";
import type { Accessor } from "solid-js";
import { batch, createMemo } from "solid-js";
import { availableThemes } from "terminal-themes";
import type { PaletteCommand, PaletteItem } from "./CommandPalette";
import { type ActionContext, actionPaletteCommand } from "./input/actions";
import { client } from "./wire";
import { useActivityFeed } from "./settings/useActivityFeed";

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

/** Palette-only dependencies — anything `ActionContext` doesn't already
 *  provide for the keyboard dispatcher. */
export interface CommandDeps extends ActionContext {
  handleCopyTerminalText: () => void;
  handleRunInActiveTerminal: (command: string) => void;
  handleExportScrollbackAsPdf: () => void;
  handleExportSessionAsHtml: () => void;
  // Theme
  committedThemeName: Accessor<string>;
  setPreviewThemeName: (name: string | undefined) => void;
  handleSetTheme: (name: string) => void;
  // Dialogs
  setAboutOpen: (open: boolean) => void;
  setDiagnosticInfoOpen: (open: boolean) => void;
  // Canvas — desktop only (always active there); hidden on mobile where
  // the canvas isn't mounted at all.
  isMobile: () => boolean;
  canvasCenterActive: () => void;
  // Worktree
  handleCreateWorktree: (repoPath: string, initialCommand?: string) => void;
  handleClose: () => void;
  // Debug
  simulateAlert: () => void;
  handleCloseAll: () => void;
}

export function createCommands(deps: CommandDeps): Accessor<PaletteCommand[]> {
  const { recentRepos, recentAgents } = useActivityFeed();

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
          actionPaletteCommand("toggleSubPanel", deps),
          actionPaletteCommand("createSubTerminal", deps),
          {
            name: "Copy terminal text",
            onSelect: () => deps.handleCopyTerminalText(),
          },
          {
            name: "Export scrollback as PDF",
            onSelect: () => deps.handleExportScrollbackAsPdf(),
          },
          ...(deps.activeMeta()?.agent
            ? [
                {
                  name: "Export agent session as HTML",
                  description:
                    "Open a self-contained transcript of the current Claude Code, OpenCode, or Codex session",
                  onSelect: () => deps.handleExportSessionAsHtml(),
                },
              ]
            : []),
          actionPaletteCommand("screenshotTerminal", deps),
        ]
      : []),
    actionPaletteCommand("toggleRightPanel", deps),
    ...(!deps.isMobile()
      ? [
          {
            name: "Center on active tile",
            onSelect: () => deps.canvasCenterActive(),
          },
        ]
      : []),
    ...(deps.terminalIds().length > 0
      ? [
          {
            name: "Switch terminal",
            children: () =>
              deps.terminalIds().map((id, i) => ({
                ...(i < 9
                  ? actionPaletteCommand(
                      `switchTo${(i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`,
                      deps,
                      { name: `Switch to terminal ${i + 1}` },
                    )
                  : { name: `Switch to terminal ${i + 1}` }),
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
          actionPaletteCommand("shuffleTheme", deps, {
            description:
              "Pick a theme whose background is perceptually distinct from every live terminal",
          }),
        ]
      : []),
    actionPaletteCommand("shortcutsHelp", deps, { name: "Keyboard shortcuts" }),
    {
      name: "About kolu",
      onSelect: () => deps.setAboutOpen(true),
    },
    {
      name: "Debug",
      children: [
        {
          name: "Diagnostic info",
          description: "Runtime state — renderer, WS, terminals",
          onSelect: () => deps.setDiagnosticInfoOpen(true),
        },
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
