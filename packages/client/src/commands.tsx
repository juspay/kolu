/** Command palette registry — declarative list of all app-level actions. */

import type { RecentAgent, TerminalId } from "kolu-common/surface";
import { WorktreeNameSchema } from "kolu-git/schemas";
import { randomName } from "memorable-names";
import type { Accessor, Component } from "solid-js";
import { batch, createMemo } from "solid-js";
import { availableThemes } from "terminal-themes";
import type {
  PaletteAction,
  PaletteCommand,
  PaletteHint,
  PaletteItem,
  PaletteLabel,
  PaletteValueInput,
} from "./CommandPalette";
import { aboutDialog } from "./AboutDialog";
import WorkspaceGrid from "./canvas/dock/WorkspaceGrid";
import type { DockSourceEntry } from "./canvas/dockModel";
import { posturedActionLabel, useViewPosture } from "./canvas/useViewPosture";
import { showsWelcome, supportsSpatialCanvas } from "./capabilities";
import { diagnosticDialog } from "./DiagnosticInfo";
import { welcomeDialog } from "./WelcomeDialog";
import {
  ACTIONS,
  type ActionContext,
  actionPaletteCommand,
} from "./input/actions";
import { iconForCommand } from "./ui/agentDisplay";
import { TerminalIcon } from "./ui/Icons";
import { restartDaemon } from "./kaval/useDaemonRestart";
import { daemonWarming } from "./kaval/useDaemonStatus";
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
  // Canvas — desktop only. The canvas isn't mounted on mobile, so these
  // commands are hidden there via `supportsSpatialCanvas`.
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
  /** Download the saved session as JSON (diagnostic backup). */
  handleExportSession: () => void;
  /** Pick a session JSON file and restore it on top of the current canvas. */
  handleImportSession: () => void;
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

  // Canvas posture — same reactive reader pattern as ChromeBar/Dock. The
  // memo reads `mode()`/`canMaximize()` so the command's label and
  // visibility track posture reactively. The *write* path stays on
  // `deps.toggleCanvasPosture` (the shared `ActionContext` seam the keyboard
  // shortcut also uses), so the two surfaces never drift if App later wraps
  // the toggle with a guard or telemetry.
  const posture = useViewPosture();

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
          // Connect to a remote host over ssh (P3, kaval-sessions): type an ssh
          // target (alias or user@host) and a terminal opens on that machine.
          {
            kind: "value",
            name: "Connect to host…",
            description: "Open a terminal on a remote host over ssh",
            prefill: () => "",
            placeholder: "ssh target — alias or user@host",
            validate: (v) => {
              const t = v.trim();
              if (t.length === 0) return "Enter an ssh target";
              if (/\s/.test(t)) return "No spaces in an ssh target";
              return null;
            },
            onSubmit: (target) => deps.handleCreate(undefined, target.trim()),
            children: () => [],
          } satisfies PaletteValueInput,
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
    ...(supportsSpatialCanvas()
      ? [
          // Maximize / restore — gated on a tile existing (posture's own
          // `canMaximize`, matching the ChromeBar button being disabled at
          // zero terminals). The label describes the action a select
          // performs, so when already maximized it reads "Restore canvas",
          // never "Maximize terminal" — same wording as the ChromeBar
          // affordance. Carries the keybind chip so the palette advertises
          // the Mod+Shift+M shortcut from one source of truth.
          ...(posture.canMaximize()
            ? [
                actionPaletteCommand("toggleCanvasPosture", deps, {
                  section: "canvas",
                  name: posturedActionLabel(posture.mode()),
                }),
              ]
            : []),
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
    // Hide "Toggle right panel" on an empty workspace: with no terminals the
    // panel host is unmounted (App's `showEmpty`) and `togglePanel()`
    // early-returns, so the command would close the palette and do nothing —
    // exactly the "offering a command that does nothing surfaces as broken"
    // case the canvas-arrange gate above avoids. The header button is disabled
    // for the same reason.
    ...(deps.terminalIds().length > 0
      ? [actionPaletteCommand("toggleRightPanel", deps, { section: "ui" })]
      : []),
    actionPaletteCommand("toggleDock", deps, { section: "ui" }),

    // --- Help (reference + advanced) ---
    actionPaletteCommand("shortcutsHelp", deps, {
      name: "Keyboard shortcuts",
      section: "help",
    }),
    // Tutorial re-summons the welcome — gated to surfaces that have one. Mobile
    // has no welcome by design (`showsWelcome()` false), so the command is
    // omitted there rather than opening a desktop-oriented dialog in the
    // compact layout.
    ...(showsWelcome()
      ? [
          {
            kind: "action" as const,
            name: "Tutorial",
            description: "Show the welcome screen",
            section: "help" as const,
            onSelect: () => welcomeDialog.openDialog(),
          },
        ]
      : []),
    {
      kind: "action",
      name: "About kolu",
      section: "help",
      onSelect: () => aboutDialog.openDialog(),
    },
    // "Debug" — drill-in group under Help. The handful of internal
    // hatches don't warrant their own top-level section; nesting under
    // Help signals "advanced reference / introspection."
    {
      kind: "group",
      name: "Debug",
      section: "help",
      description: "Internal diagnostics and scaffolding",
      children: (): PaletteItem[] => [
        {
          kind: "action",
          name: "Diagnostic info",
          description: "Runtime state — renderer, WS, terminals",
          onSelect: () => diagnosticDialog.openDialog(),
        },
        // Restart kaval — recycle the terminal daemon, capturing the session
        // first and offering it for restore on the fresh daemon (B3.2). The
        // kaval rail dialog and the degraded canvas are the primary,
        // state-contextual surfaces; this is the keyboard/search path (the
        // palette flattens leaves, so typing "restart"/"kaval" finds it).
        // Hidden while the daemon is already warming (a restart in flight or
        // booting) so the palette never offers what would be a no-op.
        // Intentionally gates on the weaker `daemonWarming()` — not the button's
        // `restartInFlight()`, which also folds in the local-click signal the
        // palette has no access to. So in the click-but-not-yet-warming window a
        // palette-then-button double-fire isn't caught here; the server's
        // restart coalescer is the backstop for that race.
        ...(!daemonWarming()
          ? [
              {
                kind: "action" as const,
                name: "Restart kaval",
                description:
                  "Recycle the terminal daemon and restore your session",
                onSelect: () => void restartDaemon(),
              },
            ]
          : []),
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
        {
          kind: "action",
          name: "Export session",
          description: "Download terminal session state as JSON",
          onSelect: () => deps.handleExportSession(),
        },
        {
          kind: "action",
          name: "Import session",
          description: "Restore terminals from a session JSON file",
          onSelect: () => deps.handleImportSession(),
        },
      ],
    },
  ]);
}
