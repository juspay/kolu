import AgentDistroLogo from "@kolu/agent-distro/solid";
import { AGENTS_CHECK_NOW } from "@kolu/agent-distro/status";
import {
  activeArm,
  type RecentAgent,
  sleepingArm,
} from "@kolu/padi-client/surface";
import { agentLaunchLine } from "kolu-agents/vocab";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { isValidWorktreeName, WORKTREE_NAME_MESSAGE } from "kolu-git/schemas";
import type { NeedsYou, WorkRow } from "kolu-work";
import { randomName } from "memorable-names";
import type { Accessor, Component } from "solid-js";
import { createMemo } from "solid-js";
import { availableThemes } from "terminal-themes";
import { aboutDialog } from "./AboutDialog";
import { agentDistroListing, checkAgentsNow } from "./agents/useAgentDistro";
import type {
  PaletteAction,
  PaletteCommand,
  PaletteHint,
  PaletteItem,
  PaletteLabel,
  PaletteValueInput,
} from "./CommandPalette";
import {
  posturedActionLabel,
  useViewPosture,
  type ViewPostureMode,
} from "./canvas/useViewPosture";
import {
  showsAmbientTips,
  showsWelcome,
  supportsSpatialCanvas,
} from "./capabilities";
import { diagnosticDialog } from "./DiagnosticInfo";
import {
  forwardFromPalette,
  forwardInputError,
} from "./forwards/forwardFromPalette";
import { recentAgents, recentRepos } from "./hostScope/activeWire";
import {
  ACTIONS,
  type ActionContext,
  actionPaletteCommand,
} from "./input/actions";
import { offerRestartVerb } from "./kaval/daemonPresentation";
import { restartDaemon } from "./kaval/useDaemonRestart";
import { activeKavalPresence } from "./kaval/useDaemonStatus";
import { conductorMode } from "./conductor/useConductorMode";
import { useNeedsYou, useWorks } from "./conductor/useWorks";
import { showWork } from "./conductor/workListing";
import { workHost, workSubtitle } from "./conductor/workReadings";
import {
  hostRootActions,
  terminalHostGroups,
  terminalSwitchActions,
} from "./palette/fleetActions";
import {
  type FleetTerminalRow,
  useFleetTerminalIndex,
} from "./palette/fleetTerminals";
import { HOSTS_GROUP_NAME } from "./palette/hostsGroup";
import { NEW_TERMINAL_GROUP } from "./palette/newTerminalGroup";
import { TERMINALS_GROUP_NAME } from "./palette/terminalsGroup";
import { runAction, type UiAction } from "./runAction";
import { stateBackupsDialog } from "./StateBackupsDialog";
import { useTerminalCrud } from "./terminal/useTerminalCrud";
import { themePaletteGroup } from "./themePalette";
import { type TileStore, useTileStore } from "./tile/useTileStore";
import { iconForKind } from "./ui/agentDisplay";
import { TerminalIcon } from "./ui/Icons";
import { welcomeDialog } from "./WelcomeDialog";
import { padiMap, preferences, updatePreferences } from "./wire";

const AgentsIcon: Component<{ class?: string }> = () => (
  <AgentDistroLogo size={12} />
);

function validateWorktreeName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "branch name cannot be empty";
  return isValidWorktreeName(trimmed) ? null : WORKTREE_NAME_MESSAGE;
}

interface RecentAgentRow {
  readonly kind: string;
  readonly command: string;
}

function recentAgentRows(agents: readonly RecentAgent[]): RecentAgentRow[] {
  const rows: RecentAgentRow[] = [];
  for (const a of agents) {
    const command = agentLaunchLine(a.kind, a.argv);
    if (command !== null) rows.push({ kind: a.kind, command });
  }
  return rows;
}

function agentItems(
  agents: readonly RecentAgent[],
  onPick: (command: string) => void,
): PaletteItem[] {
  return recentAgentRows(agents).map(
    (a): PaletteAction => ({
      kind: "action",
      name: a.command,
      onSelect: () => onPick(a.command),
      icon: iconForKind(a.kind),
    }),
  );
}

function worktreeAgentOptions(
  agents: readonly RecentAgent[],
): (PaletteLabel | PaletteHint)[] {
  return [
    {
      kind: "label",
      name: "Plain shell",
      data: undefined,
      icon: TerminalIcon,
    },
    ...recentAgentRows(agents).map(
      (a): PaletteLabel => ({
        kind: "label",
        name: a.command,
        data: a.command,
        icon: iconForKind(a.kind),
      }),
    ),
  ];
}

/** Palette-only dependencies — anything `ActionContext` doesn't already
 *  provide for the keyboard dispatcher. */
export interface CommandDeps extends ActionContext {
  handleCopyTerminalText: () => void;
  handleCopyTerminalId: () => void;
  handleRunInActiveTerminal: (command: string) => void;
  handleExportScrollbackAsPdf: () => void;
  handleExportSessionAsHtml: () => void;
  committedThemeName: Accessor<string>;
  setPreviewThemeName: (name: string | undefined) => void;
  handleSetTheme: (name: string) => void;
  handleEditActiveIntent: () => void;
  canvasCenterActive: () => void;
  canvasAutoArrange: () => void;
  handleCreateWorktree: (
    repoPath: string,
    name: string,
    initialCommand?: string,
  ) => void;
  handleClose: () => void;
  hostKeys: Accessor<HostKey[]>;
  activeHost: Accessor<HostKey>;
  switchHost: (host: HostKey) => void;
  simulateAlert: () => void;
  handleClearLocalStorage: () => void;
  /** Reset the active terminal to its default size, centered in the viewport. */
  handleResetActiveTileSize: () => void;
  /** Download the saved session as JSON (diagnostic backup). */
  handleExportSession: () => void;
  /** Pick a session JSON file and restore it on top of the current canvas. */
  handleImportSession: () => void;
}

interface TerminalLifecycle {
  handleWake: (id: TerminalId) => UiAction;
  requestSleep: (id: TerminalId) => UiAction;
  requestRestart: (id: TerminalId) => void;
}

interface CanvasPosture {
  layout: () => ViewPostureMode;
  canMaximize: () => boolean;
}

function rootIndexCommands(
  deps: CommandDeps,
  fleet: Accessor<FleetTerminalRow[]>,
  needs: Accessor<readonly NeedsYou[]>,
  works: Accessor<readonly WorkRow[]>,
): PaletteCommand[] {
  return [
    ...terminalSwitchActions(
      fleet(),
      deps.activeHost(),
      deps.switchHost,
      deps.activate,
    ),
    ...(deps.hostKeys().length > 1
      ? hostRootActions(deps.hostKeys(), deps.activeHost(), deps.switchHost)
      : []),

    ...needs().map(
      (item): PaletteAction => ({
        kind: "action",
        name: item.wanted,
        description: item.title,
        section: "needs-you",
        onSelect: () =>
          showWork(
            item.work,
            item.why.why === "question" ? item.why.ask : null,
          ),
      }),
    ),
    ...works().map(
      ([id, work]): PaletteAction => ({
        kind: "action",
        name: work.title,
        description: workSubtitle(work, workHost(work)).join(" · "),
        section: "works",
        onSelect: () => showWork(id),
      }),
    ),
  ];
}

function terminalsCommands(
  deps: CommandDeps,
  fleet: Accessor<FleetTerminalRow[]>,
): PaletteCommand[] {
  const scopeOpen =
    deps
      .hostKeys()
      .some((h) => padiMap.entry(h).state().kind === "connected") ||
    fleet().length > 0;
  return [
    ...(scopeOpen
      ? [
          {
            kind: "group" as const,
            name: TERMINALS_GROUP_NAME,
            description: "Type to filter",
            section: "terminals" as const,
            keybind: ACTIONS.openWorkspaceSwitcher.keybind,
            row: { kind: "command" as const },
            children: (): PaletteItem[] =>
              terminalHostGroups(
                fleet(),
                deps.hostKeys(),
                deps.activeHost(),
                deps.switchHost,
                deps.activate,
              ),
          },
        ]
      : []),
    {
      kind: "group",
      name: NEW_TERMINAL_GROUP,
      section: "terminals",
      row: { kind: "command" },
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
              id: r.repoRoot,
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
  ];
}

function hostsCommands(deps: CommandDeps): PaletteCommand[] {
  return [
    ...(deps.hostKeys().length > 1
      ? [
          {
            kind: "group" as const,
            name: HOSTS_GROUP_NAME,
            description: "Switch canvas host",
            section: "hosts" as const,
            keybind: ACTIONS.openHostSwitcher.keybind,
            rootHidden: true,
            row: { kind: "command" as const },
            children: (): PaletteItem[] =>
              hostRootActions(
                deps.hostKeys(),
                deps.activeHost(),
                deps.switchHost,
              ),
          },
        ]
      : []),

    {
      kind: "value" as const,
      name: "Forward a port…",
      description: "host:port → a door on this machine",
      section: "hosts" as const,
      row: { kind: "command" as const },
      prefill: () => "",
      placeholder: "host:port (or just a port for this host)",
      validate: (value) =>
        forwardInputError(value, deps.hostKeys(), deps.activeHost()),
      onSubmit: (value) =>
        runAction(
          "forward a port",
          forwardFromPalette(value, deps.hostKeys(), deps.activeHost()),
        ),
      children: (): (PaletteLabel | PaletteHint)[] => [
        {
          kind: "hint" as const,
          text: "e.g. pu-dev:5173 — a bare 3000 means the active host",
        },
      ],
    },
  ];
}

function activeTerminalCommands(
  deps: CommandDeps,
  crud: TerminalLifecycle,
): PaletteCommand[] {
  if (deps.activeId() === null) return [];
  return [
    {
      kind: "action" as const,
      name: "Close terminal",
      section: "active-terminal" as const,
      onSelect: () => deps.handleClose(),
    },
    sleepingArm(deps.activeMeta())
      ? {
          kind: "action" as const,
          name: "Wake terminal",
          section: "active-terminal" as const,
          onSelect: () => {
            const id = deps.activeId();
            if (id) runAction("wake terminal", crud.handleWake(id));
          },
        }
      : {
          kind: "action" as const,
          name: "Sleep terminal",
          section: "active-terminal" as const,
          onSelect: () => {
            const id = deps.activeId();
            if (id) runAction("sleep terminal", crud.requestSleep(id));
          },
        },
    ...(activeArm(deps.activeMeta())
      ? [
          {
            kind: "action" as const,
            name: "Restart terminal",
            section: "active-terminal" as const,
            description:
              "A fresh shell in the same tile and folder, splits included — a live agent asks first (press again to confirm)",
            onSelect: () => {
              const id = deps.activeId();
              if (id) crud.requestRestart(id);
            },
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
            name: "Copy terminal ID",
            section: "active-terminal" as const,
            onSelect: () => deps.handleCopyTerminalId(),
          },
          {
            kind: "action" as const,
            name: "Export scrollback as PDF",
            section: "active-terminal" as const,
            onSelect: () => deps.handleExportScrollbackAsPdf(),
          },
          ...(activeArm(deps.activeMeta())?.agent
            ? [
                {
                  kind: "action" as const,
                  name: "Export agent session as HTML",
                  section: "active-terminal" as const,
                  description:
                    "Choose a chat log or full transcript for the current Claude Code, OpenCode, or Codex session",
                  onSelect: () => deps.handleExportSessionAsHtml(),
                },
              ]
            : []),
          actionPaletteCommand("screenshotTerminal", deps, {
            section: "active-terminal",
          }),
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
        ]
      : []),
    themePaletteGroup(
      availableThemes.map((theme) => theme.name),
      deps,
    ),
    actionPaletteCommand("shuffleTheme", deps, {
      section: "active-terminal",
      description:
        "Pick a theme whose background is perceptually distinct from every live terminal",
    }),
    {
      kind: "action" as const,
      name: "Edit intent",
      section: "active-terminal" as const,
      description: "Attach a freeform markdown note to this terminal",
      onSelect: () => deps.handleEditActiveIntent(),
    },
  ];
}

function canvasCommands(
  deps: CommandDeps,
  posture: CanvasPosture,
  tileStore: TileStore,
): PaletteCommand[] {
  if (!supportsSpatialCanvas()) return [];
  return [
    ...(posture.canMaximize()
      ? [
          actionPaletteCommand("toggleCanvasPosture", deps, {
            section: "canvas",
            name: posturedActionLabel(posture.layout()),
          }),
        ]
      : []),
    {
      kind: "action" as const,
      name: "Center on active tile",
      section: "canvas" as const,
      onSelect: () => deps.canvasCenterActive(),
    },
    ...(tileStore.tileCount() > 1
      ? [
          {
            kind: "action" as const,
            name: "Arrange canvas by repo",
            section: "canvas" as const,
            onSelect: () => deps.canvasAutoArrange(),
          },
        ]
      : []),
  ];
}

function uiCommands(deps: CommandDeps, tileStore: TileStore): PaletteCommand[] {
  return [
    ...(tileStore.tileCount() > 0
      ? [actionPaletteCommand("toggleRightPanel", deps, { section: "ui" })]
      : []),
    actionPaletteCommand("toggleDock", deps, { section: "ui" }),
    actionPaletteCommand("toggleConductor", deps, {
      section: "ui",
      name: conductorMode() ? "Leave the conductor" : "Conductor",
      description: "One conversation that drives the terminals on every host",
    }),
    ...(showsAmbientTips()
      ? [
          {
            kind: "action" as const,
            name: "Toggle tip bar",
            description: "Show the tile tip as a bar or as a small tab",
            section: "ui" as const,
            onSelect: () =>
              updatePreferences({
                tipBarCollapsed: !preferences().tipBarCollapsed,
              }),
          },
        ]
      : []),
  ];
}

function agentsCommands(): PaletteCommand[] {
  if (agentDistroListing()?.kind !== "available") return [];
  return [
    {
      kind: "action",
      name: AGENTS_CHECK_NOW.label,
      description: AGENTS_CHECK_NOW.note,
      section: "commands",
      icon: AgentsIcon,
      onSelect: checkAgentsNow,
    },
  ];
}

function debugGroup(deps: CommandDeps): PaletteCommand {
  return {
    kind: "group",
    name: "Debug",
    section: "help",
    description: "Internal diagnostics and scaffolding",
    children: (): PaletteItem[] => [
      {
        kind: "action",
        name: "Diagnostic info",
        description: "Runtime state — renderer, WS, terminals, padi",
        onSelect: () => diagnosticDialog.openDialog(),
      },
      {
        kind: "action",
        name: "Restore state from backup",
        description: "Browse the state-backup rings and restore a snapshot",
        onSelect: () => stateBackupsDialog.openDialog(),
      },
      ...(offerRestartVerb(activeKavalPresence())
        ? [
            {
              kind: "action" as const,
              name: "Restart kaval",
              description:
                "Recycle the terminal daemon and restore your session",
              onSelect: () => runAction("restart kaval", restartDaemon()),
            },
          ]
        : []),
      {
        kind: "action",
        name: "Simulate attention alert",
        onSelect: () => deps.simulateAlert(),
      },
      ...(supportsSpatialCanvas()
        ? [
            {
              kind: "action" as const,
              name: "Reset terminal size",
              description:
                "Restore the active terminal to its default size, centered",
              onSelect: () => deps.handleResetActiveTileSize(),
            },
          ]
        : []),
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
  };
}

function helpCommands(deps: CommandDeps): PaletteCommand[] {
  return [
    actionPaletteCommand("shortcutsHelp", deps, {
      name: "Keyboard shortcuts",
      section: "help",
    }),
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
    debugGroup(deps),
  ];
}

export function createCommands(deps: CommandDeps): Accessor<PaletteCommand[]> {
  const posture = useViewPosture();
  const tileStore = useTileStore();
  const crud = useTerminalCrud();
  const fleet = useFleetTerminalIndex();
  const needs = useNeedsYou();
  const works = useWorks();

  return createMemo((): PaletteCommand[] => [
    ...rootIndexCommands(deps, fleet, needs, works),
    ...terminalsCommands(deps, fleet),
    ...hostsCommands(deps),
    ...activeTerminalCommands(deps, crud),
    ...canvasCommands(deps, posture, tileStore),
    ...uiCommands(deps, tileStore),
    ...agentsCommands(),
    ...helpCommands(deps),
  ]);
}
