/** Command palette registry — declarative list of all app-level actions. */

import { randomName } from "@kolu/memorable-names";
import { availableThemes } from "@kolu/terminal-themes";
import type { RecentAgent, TerminalId } from "kolu-common/surface";
import { WorktreeNameSchema } from "kolu-git/schemas";
import type { Accessor, Component } from "solid-js";
import { batch, createMemo } from "solid-js";
import type {
  PaletteAction,
  PaletteCommand,
  PaletteHint,
  PaletteItem,
  PaletteLabel,
  PaletteValueInput,
} from "./CommandPalette";
import WorkspaceGrid from "./canvas/dock/WorkspaceGrid";
import type { DockSourceEntry } from "./canvas/dockModel";
import {
  ACTIONS,
  type ActionContext,
  actionPaletteCommand,
} from "./input/actions";
import { iconForCommand } from "./ui/agentDisplay";
import { TerminalIcon } from "./ui/Icons";
import { recentAgents, recentRepos } from "./wire";

/** Body component factory for the "Search workspaces" group. Captures
 *  the entries accessor + recency lookup in a closure so the palette
 *  engine only sees a `Component<{ query; closePalette }>` that the
 *  group's `body` slot accepts — no palette awareness of dock model
 *  internals. */
function workspaceGridBody(
  workspaceEntries: Accessor<DockSourceEntry[]>,
  getRecency: (id: TerminalId) => number,
  activate: (id: TerminalId) => void,
): Component<{ query: string; closePalette: () => void }> {
  return (props) => (
    <WorkspaceGrid
      entries={workspaceEntries()}
      getRecency={getRecency}
      query={props.query}
      onSelect={(id) => {
        activate(id);
        props.closePalette();
      }}
    />
  );
}

/** Live worktree-name validator — reuses the server schema so the rule
 *  has one source of truth. Returns the first issue's message, or null
 *  when the trimmed name passes. */
function validateWorktreeName(name: string): string | null {
  const result = WorktreeNameSchema.safeParse(name.trim());
  if (result.success) return null;
  return result.error.issues[0]?.message ?? "Invalid worktree name";
}

/** PaletteItems listing each recent agent command — used by the
 *  "Recent agents" drill-in group under Active Terminal. Icons mirror the
 *  worktree-naming leaf so agents render with the same visual treatment
 *  in both palettes. */
function agentItems(
  agents: RecentAgent[],
  onPick: (command: string) => void,
): PaletteItem[] {
  return agents.map(
    (a): PaletteAction => ({
      kind: "action",
      name: a.command,
      onSelect: () => onPick(a.command),
      icon: iconForCommand(a.command),
    }),
  );
}

/** Children of the worktree-naming leaf. Each row's `data` is the agent
 *  CLI string to launch (or `undefined` for plain shell). They render as
 *  passive labels — Enter/click routes through the value group's
 *  `onSubmit`, not these rows' own (absent) handler. */
function worktreeAgentOptions(
  agents: RecentAgent[],
): (PaletteLabel | PaletteHint)[] {
  return [
    {
      kind: "label",
      name: "Plain shell",
      data: undefined,
      icon: TerminalIcon,
    },
    ...agents.map(
      (a): PaletteLabel => ({
        kind: "label",
        name: a.command,
        data: a.command,
        icon: iconForCommand(a.command),
      }),
    ),
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
  // Intent — opens the editor for the active terminal.
  handleEditActiveIntent: () => void;
  // Dialogs
  setAboutOpen: (open: boolean) => void;
  setDiagnosticInfoOpen: (open: boolean) => void;
  // Canvas — desktop only (always active there); hidden on mobile where
  // the canvas isn't mounted at all.
  isMobile: () => boolean;
  canvasCenterActive: () => void;
  canvasAutoArrange: () => void;
  // Worktree
  handleCreateWorktree: (
    repoPath: string,
    name: string,
    initialCommand?: string,
  ) => void;
  handleClose: () => void;
  // Workspace search — the live-terminal source list and recency
  // accessor the "Search workspaces" group walks to populate its rows.
  workspaceEntries: Accessor<DockSourceEntry[]>;
  recencyOf: (id: TerminalId) => number;
  // Debug
  simulateAlert: () => void;
  handleClearLocalStorage: () => void;
}

export function createCommands(deps: CommandDeps): Accessor<PaletteCommand[]> {
  // Stable component reference — created once per `createCommands` call so
  // the `body` slot identity doesn't change on every reactive re-run of the
  // memo below. A changing `body` reference would cause SolidJS's `<Dynamic>`
  // to unmount/remount `WorkspaceGrid` on every terminal update, losing its
  // `repoFilter` signal and scroll position.
  const workspacesBody = workspaceGridBody(
    deps.workspaceEntries,
    deps.recencyOf,
    deps.activate,
  );

  return createMemo((): PaletteCommand[] => [
    // --- Workspaces ---
    ...(deps.terminalIds().length > 0
      ? [
          {
            kind: "body-group" as const,
            name: "Search workspaces",
            description: "Switch to a live terminal",
            section: "workspaces" as const,
            keybind: ACTIONS.openWorkspaceSwitcher.keybind,
            body: workspacesBody,
            bodyHint: "Pick a workspace to switch",
          },
        ]
      : []),
    {
      kind: "group",
      name: "New terminal",
      section: "workspaces",
      children: (): PaletteItem[] => {
        const repos = recentRepos();
        return [
          {
            kind: "action",
            name: "In current directory",
            onSelect: () => deps.handleCreate(deps.activeMeta()?.cwd),
          },
          ...repos.map(
            (r): PaletteValueInput => ({
              kind: "value",
              name: r.repoName,
              description: `New worktree in ${r.repoRoot}`,
              prefill: randomName,
              placeholder: "Worktree name",
              validate: validateWorktreeName,
              onSubmit: (name, selected) => {
                const agentCmd =
                  typeof selected.data === "string" ? selected.data : undefined;
                deps.handleCreateWorktree(r.repoRoot, name.trim(), agentCmd);
              },
              children: (): (PaletteLabel | PaletteHint)[] =>
                worktreeAgentOptions(recentAgents()),
            }),
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

    // --- Active Terminal (conditional on focus) ---
    ...(deps.activeId() !== null
      ? [
          {
            kind: "action" as const,
            name: "Close terminal",
            section: "active-terminal" as const,
            onSelect: () => deps.handleClose(),
          },
          actionPaletteCommand("toggleSubPanel", deps, {
            section: "active-terminal",
          }),
          actionPaletteCommand("createSubTerminal", deps, {
            section: "active-terminal",
          }),
          {
            kind: "action" as const,
            name: "Copy terminal text",
            section: "active-terminal" as const,
            onSelect: () => deps.handleCopyTerminalText(),
          },
          {
            kind: "action" as const,
            name: "Export scrollback as PDF",
            section: "active-terminal" as const,
            onSelect: () => deps.handleExportScrollbackAsPdf(),
          },
          ...(deps.activeMeta()?.agent
            ? [
                {
                  kind: "action" as const,
                  name: "Export agent session as HTML",
                  section: "active-terminal" as const,
                  description:
                    "Open a self-contained transcript of the current Claude Code, OpenCode, or Codex session",
                  onSelect: () => deps.handleExportSessionAsHtml(),
                },
              ]
            : []),
          actionPaletteCommand("screenshotTerminal", deps, {
            section: "active-terminal",
          }),
          // "Recent agents" — surfaces agent CLIs the user has previously run
          // in any kolu terminal, auto-detected via the preexec OSC 633;E
          // command mark. Promoted to a root-level drill-in under the
          // Active Terminal section now that the section framework exists.
          // Visible when at least one agent has been seen AND there is an
          // active terminal to prefill it into.
          ...(recentAgents().length > 0
            ? [
                {
                  kind: "group" as const,
                  name: "Recent agents",
                  section: "active-terminal" as const,
                  description: "Prefill an agent CLI into the active terminal",
                  children: (): PaletteItem[] =>
                    agentItems(recentAgents(), deps.handleRunInActiveTerminal),
                },
              ]
            : []),
          // Theme is a per-active-terminal property (`client.terminal.setTheme`
          // takes a terminal id), so both the drill-in chooser and the
          // shuffle action live alongside the other active-terminal
          // commands rather than in a global "Appearance" bucket.
          {
            kind: "group" as const,
            name: "Set theme",
            section: "active-terminal" as const,
            onCancel: () => deps.setPreviewThemeName(undefined),
            children: () =>
              availableThemes
                .filter((t) => t.name !== deps.committedThemeName())
                .map(
                  (t): PaletteAction => ({
                    kind: "action",
                    name: t.name,
                    onHighlight: () => deps.setPreviewThemeName(t.name),
                    onSelect: () =>
                      batch(() => {
                        deps.setPreviewThemeName(undefined);
                        deps.handleSetTheme(t.name);
                      }),
                  }),
                ),
          },
          actionPaletteCommand("shuffleTheme", deps, {
            section: "active-terminal",
            description:
              "Pick a theme whose background is perceptually distinct from every live terminal",
          }),
          // Intent — the single picker (kolu#178). One palette entry,
          // one editor; click → curated-emoji quick-row + markdown
          // textarea + live preview. The chip in the title bar, the
          // top-border pill, the dock-awaiting card, and the workspace
          // switcher card all surface what's edited here.
          {
            kind: "action" as const,
            name: "Edit intent",
            section: "active-terminal" as const,
            description: "Attach a freeform markdown note to this terminal",
            onSelect: () => deps.handleEditActiveIntent(),
          },
        ]
      : []),

    // --- Canvas (desktop only — spatial tile actions) ---
    ...(!deps.isMobile()
      ? [
          {
            kind: "action" as const,
            name: "Center on active tile",
            section: "canvas" as const,
            onSelect: () => deps.canvasCenterActive(),
          },
          // Hide arrange when only one tile exists — a single-tile arrange
          // is a visual no-op, and offering a command that does nothing
          // surfaces as broken.
          ...(deps.terminalIds().length > 1
            ? [
                {
                  kind: "action" as const,
                  name: "Arrange canvas by repo",
                  section: "canvas" as const,
                  onSelect: () => deps.canvasAutoArrange(),
                },
              ]
            : []),
        ]
      : []),

    // --- UI (panel/dock visibility — global UI chrome, not per-terminal) ---
    actionPaletteCommand("toggleRightPanel", deps, { section: "ui" }),
    actionPaletteCommand("toggleDock", deps, { section: "ui" }),

    // --- Help (reference + advanced) ---
    actionPaletteCommand("shortcutsHelp", deps, {
      name: "Keyboard shortcuts",
      section: "help",
    }),
    {
      kind: "action",
      name: "About kolu",
      section: "help",
      onSelect: () => deps.setAboutOpen(true),
    },
    // "Debug" — drill-in group under Help. The handful of internal
    // hatches don't warrant their own top-level section; nesting under
    // Help signals "advanced reference / introspection."
    {
      kind: "group",
      name: "Debug",
      section: "help",
      description: "Internal diagnostics and scaffolding",
      children: [
        {
          kind: "action",
          name: "Diagnostic info",
          description: "Runtime state — renderer, WS, terminals",
          onSelect: () => deps.setDiagnosticInfoOpen(true),
        },
        {
          kind: "action",
          name: "Simulate activity alert",
          onSelect: () => deps.simulateAlert(),
        },
        {
          kind: "action",
          name: "Clear localStorage",
          onSelect: () => deps.handleClearLocalStorage(),
        },
      ],
    },
  ]);
}
