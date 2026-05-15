/** Command palette registry — declarative list of all app-level actions. */

import type { RecentAgent, TerminalId } from "kolu-common/surface";
import { WorktreeNameSchema } from "kolu-git/schemas";
import { randomName } from "memorable-names";
import type { Accessor } from "solid-js";
import { batch, createMemo } from "solid-js";
import { availableThemes } from "terminal-themes";
import {
  agentBucket,
  bucketDescriptor,
  type DockEntry,
  type DockSourceEntry,
  resolvedPr,
  searchWorkspaceEntries,
} from "./canvas/dockModel";
import type {
  PaletteAction,
  PaletteCommand,
  PaletteHint,
  PaletteItem,
  PaletteLabel,
  PaletteValueInput,
} from "./CommandPalette";
import { type ActionContext, actionPaletteCommand } from "./input/actions";
import { agentNames, iconForCommand, stateLabels } from "./ui/agentDisplay";
import { repoColorDot, TerminalIcon } from "./ui/Icons";
import { formatTimeAgo } from "./terminal/staleness";
import { client } from "./wire";
import { recentAgents, recentRepos } from "./wire";

/** Workspace-row name — drop the empty branch label that pure-shell
 *  terminals carry so the row still reads as "the cwd you're in"
 *  rather than a blank line followed by a long description. */
function workspaceRowName(entry: DockEntry): string {
  const label = entry.label.trim();
  if (label.length > 0)
    return entry.suffix ? `${label} ${entry.suffix}` : label;
  // No git label — fall back to the cwd basename, which is what the
  // dock row eyebrow shows in the same situation.
  const cwd = entry.info.meta.cwd;
  const basename = cwd.split("/").filter(Boolean).at(-1) ?? cwd;
  return basename;
}

/** Compact metadata string for the workspace row's secondary text. Keeps
 *  the line short enough to fit alongside the branch name without
 *  truncating to nothing — full 20-field text lives in `searchText` so
 *  the filter can still see it. */
function workspaceRowDescription(entry: DockEntry): string {
  const parts: string[] = [entry.repoName];
  const pr = resolvedPr(entry.info.meta.pr);
  if (pr) parts.push(`#${pr.number}`);
  const agent = entry.info.meta.agent;
  const bucket = agentBucket(agent);
  const glyph = bucketDescriptor(bucket).glyph;
  if (agent) {
    parts.push(
      `${glyph} ${agentNames[agent.kind]} · ${stateLabels[agent.state]}`,
    );
  } else {
    const fg = entry.info.meta.foreground;
    if (fg?.title) parts.push(fg.title);
    else if (fg?.name) parts.push(fg.name);
  }
  const recency = formatTimeAgo(entry.info.meta.lastActivityAt);
  if (recency) parts.push(recency);
  return parts.join(" · ");
}

/** Map a live-terminal entry to a palette action — the engine handles
 *  highlight / selection / filter; this function just hands over the
 *  presentation fields plus the searchable text. */
function workspacePaletteAction(
  entry: DockEntry,
  activate: (id: TerminalId) => void,
): PaletteAction {
  return {
    kind: "action",
    name: workspaceRowName(entry),
    description: workspaceRowDescription(entry),
    searchText: entry.searchText,
    icon: repoColorDot(entry.info.repoColor),
    onSelect: () => activate(entry.id),
  };
}

/** Live worktree-name validator — reuses the server schema so the rule
 *  has one source of truth. Returns the first issue's message, or null
 *  when the trimmed name passes. */
function validateWorktreeName(name: string): string | null {
  const result = WorktreeNameSchema.safeParse(name.trim());
  if (result.success) return null;
  return result.error.issues[0]?.message ?? "Invalid worktree name";
}

/** PaletteItems listing each recent agent command. Used by the Debug →
 *  "Recent agents" entry (phase 1 prefill flow). Icons mirror the
 *  worktree-naming leaf below so the same recent agents render with the
 *  same visual treatment in both palettes. */
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
  handleCloseAll: () => void;
}

export function createCommands(deps: CommandDeps): Accessor<PaletteCommand[]> {
  return createMemo((): PaletteCommand[] => [
    {
      kind: "group",
      name: "New terminal",
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
    ...(deps.activeId() !== null
      ? [
          {
            kind: "action" as const,
            name: "Close terminal",
            onSelect: () => deps.handleClose(),
          },
          actionPaletteCommand("toggleSubPanel", deps),
          actionPaletteCommand("createSubTerminal", deps),
          {
            kind: "action" as const,
            name: "Copy terminal text",
            onSelect: () => deps.handleCopyTerminalText(),
          },
          {
            kind: "action" as const,
            name: "Export scrollback as PDF",
            onSelect: () => deps.handleExportScrollbackAsPdf(),
          },
          ...(deps.activeMeta()?.agent
            ? [
                {
                  kind: "action" as const,
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
          actionPaletteCommand("openWorkspaceSwitcher", deps),
          {
            kind: "action" as const,
            name: "Center on active tile",
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
                  onSelect: () => deps.canvasAutoArrange(),
                },
              ]
            : []),
        ]
      : []),
    ...(deps.terminalIds().length > 0
      ? [
          {
            kind: "group" as const,
            name: "Search workspaces",
            description: "Switch to a live terminal",
            children: () =>
              searchWorkspaceEntries(deps.workspaceEntries(), {
                getRecency: deps.recencyOf,
              }).map((entry) => workspacePaletteAction(entry, deps.activate)),
          },
        ]
      : []),
    {
      kind: "group",
      name: "Theme",
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
      kind: "action",
      name: "About kolu",
      onSelect: () => deps.setAboutOpen(true),
    },
    {
      kind: "group",
      name: "Debug",
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
        // "Recent agents" — surfaces agent CLIs the user has previously run
        // in any kolu terminal, auto-detected via the preexec OSC 633;E
        // command mark. Parked under Debug during phase 1 while the feature
        // is soft-launched. Only visible when at least one agent has been
        // seen AND there is an active terminal to prefill it into.
        ...(deps.activeId() !== null && recentAgents().length > 0
          ? [
              {
                kind: "group" as const,
                name: "Recent agents",
                description: "Prefill an agent CLI into the active terminal",
                children: (): PaletteItem[] =>
                  agentItems(recentAgents(), deps.handleRunInActiveTerminal),
              },
            ]
          : []),
        {
          kind: "action",
          name: "Trigger server error",
          onSelect: () =>
            void client.terminal.resize({
              id: "00000000-0000-0000-0000-000000000000",
              cols: 1,
              rows: 1,
            }),
        },
        {
          kind: "action",
          name: "Close all terminals",
          onSelect: () => deps.handleCloseAll(),
        },
        {
          kind: "action",
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
