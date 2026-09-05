/** Command palette registry — declarative list of all app-level actions. */

import {
  activeArm,
  type RecentAgent,
  sleepingArm,
} from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import { isValidWorktreeName, WORKTREE_NAME_MESSAGE } from "kolu-git/schemas";
import { randomName } from "memorable-names";
import type { Accessor } from "solid-js";
import { createMemo } from "solid-js";
import { availableThemes } from "terminal-themes";
import { aboutDialog } from "./AboutDialog";
import type {
  PaletteAction,
  PaletteCommand,
  PaletteHint,
  PaletteItem,
  PaletteLabel,
  PaletteValueInput,
} from "./CommandPalette";
import { posturedActionLabel, useViewPosture } from "./canvas/useViewPosture";
import { showsWelcome, supportsSpatialCanvas } from "./capabilities";
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
import {
  hostRootActions,
  terminalHostGroups,
  terminalSwitchActions,
} from "./palette/fleetActions";
import { useFleetTerminalIndex } from "./palette/fleetTerminals";
import { HOSTS_GROUP_NAME } from "./palette/hostsGroup";
import { NEW_TERMINAL_GROUP } from "./palette/newTerminalGroup";
import { TERMINALS_GROUP_NAME } from "./palette/terminalsGroup";
import { runAction } from "./runAction";
import { stateBackupsDialog } from "./StateBackupsDialog";
import { useTerminalCrud } from "./terminal/useTerminalCrud";
import { themePaletteGroup } from "./themePalette";
import { useTileStore } from "./tile/useTileStore";
import { iconForCommand } from "./ui/agentDisplay";
import { TerminalIcon } from "./ui/Icons";
import { welcomeDialog } from "./WelcomeDialog";
import { padiMap } from "./wire";

/** Live worktree-name validator — returns the message to show under the input,
 *  or null when the trimmed name passes.
 *
 *  It runs `kolu-git`'s exported PREDICATE and its user-visible MESSAGE, which
 *  are the very things `WorktreeNameSchema`'s check is built from — exported
 *  "so the client can run the same predicate live in the worktree-naming palette
 *  leaf". Decoding the schema and formatting its failure would read the same rule
 *  through a `SchemaError` renderer whose prose the user never asked for; this
 *  keeps ONE source of truth for the rule and lets the palette own its own
 *  sentence for the empty case (which the schema states as a bare min-length). */
function validateWorktreeName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "branch name cannot be empty";
  return isValidWorktreeName(trimmed) ? null : WORKTREE_NAME_MESSAGE;
}

/** PaletteItems listing each recent agent command — used by the
 *  "Recent agents" drill-in group under Active Terminal. Icons mirror the
 *  worktree-naming leaf so agents render with the same visual treatment
 *  in both palettes. */
function agentItems(
  agents: readonly RecentAgent[],
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
  agents: readonly RecentAgent[],
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
  handleCopyTerminalId: () => void;
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
  // Terminal switcher — activate is enough; row list is useDockOrder (shared
  // with the dock). Host pool still comes from deps.
  // Host pool — root host rows and the Hosts scoped group (⌘⇧H) share
  // hostRootActions so they cannot drift.
  hostKeys: Accessor<HostKey[]>;
  activeHost: Accessor<HostKey>;
  switchHost: (host: HostKey) => void;
  // Debug
  simulateAlert: () => void;
  handleClearLocalStorage: () => void;
  /** Reset the active terminal to its default size, centered in the viewport. */
  handleResetActiveTileSize: () => void;
  /** Download the saved session as JSON (diagnostic backup). */
  handleExportSession: () => void;
  /** Pick a session JSON file and restore it on top of the current canvas. */
  handleImportSession: () => void;
}

export function createCommands(deps: CommandDeps): Accessor<PaletteCommand[]> {
  // Canvas posture — same reactive reader pattern as ChromeBar/Dock. The
  // memo reads `mode()`/`canMaximize()` so the command's label and
  // visibility track posture reactively. The *write* path stays on
  // `deps.toggleCanvasPosture` (the shared `ActionContext` seam the keyboard
  // shortcut also uses), so the two surfaces never drift if App later wraps
  // the toggle with a guard or telemetry.
  const posture = useViewPosture();
  const tileStore = useTileStore();
  const crud = useTerminalCrud();
  // Fleet-wide terminal index — every connected host's terminals, ranked by
  // recency. Active-host-only dock order is not enough for multi-host jump.
  // Split children are excluded at the source (same rule as Dock terminalIds).
  const fleet = useFleetTerminalIndex();
  const terminalRows = () =>
    terminalSwitchActions(
      fleet(),
      deps.activeHost(),
      deps.switchHost,
      deps.activate,
    );
  const hostScopedTerminalGroups = () =>
    terminalHostGroups(
      fleet(),
      deps.hostKeys(),
      deps.activeHost(),
      deps.switchHost,
      deps.activate,
    );
  /** Terminals scope is available once any pool host is connected (even if
   *  the fleet index is still empty — headers paint with 0 counts). */
  const terminalsScopeOpen = () =>
    deps
      .hostKeys()
      .some((h) => padiMap.entry(h).state().kind === "connected") ||
    fleet().length > 0;

  return createMemo((): PaletteCommand[] => [
    // --- Root index: terminals (all hosts) + hosts ---
    // Empty root caps terminals to Recent (~3); a query surfaces all matches
    // flat across hosts (host chip on each row). ⌘⇧K opens Terminals as a
    // flat multi-host list under host headers; dock search deep-links
    // Terminals › $activeHost.
    ...terminalRows(),
    ...(deps.hostKeys().length > 1
      ? hostRootActions(deps.hostKeys(), deps.activeHost(), deps.switchHost)
      : []),

    // --- Terminals section: fleet list + new terminal ---
    ...(terminalsScopeOpen()
      ? [
          {
            kind: "group" as const,
            name: TERMINALS_GROUP_NAME,
            description: "Type to filter",
            section: "terminals" as const,
            keybind: ACTIONS.openWorkspaceSwitcher.keybind,
            row: { kind: "command" as const },
            children: (): PaletteItem[] => hostScopedTerminalGroups(),
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

    // --- Hosts scoped group (⌘⇧H) — same rows as root host index ---
    // rootHidden: children are already promoted as root host rows, so the
    // container stays addressable for openGroup/initialPath without a
    // second Hosts band in the empty-root list.
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

    // --- Forward a port (any host) ---
    // For a port the scanner never saw: one outside every terminal's subtree, a
    // service started before kolu, a daemonized server. Those are exactly the
    // ports no chip can offer, so the palette is the only way to reach them —
    // which is why this is a root command rather than an active-terminal one.
    // `manual`, so nothing but an explicit cancel closes it: kolu has no listener
    // to watch on the user's behalf here, and reaping on "the scanner does not see
    // it" would close every one of these the moment it was opened.
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

    // --- Active Terminal (conditional on focus) ---
    ...(deps.activeId() !== null
      ? [
          {
            kind: "action" as const,
            name: "Close terminal",
            section: "active-terminal" as const,
            onSelect: () => deps.handleClose(),
          },
          // Sleep / Wake — one or the other by the active tile's lifecycle state.
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
          // Live-only actions (split / copy / screenshot / export / recent-agent
          // prefill) need a running PTY, so they're gated on the ACTIVE arm — not
          // merely `activeId() !== null`, which is also true for a SLEEPING tile
          // (F3). A sleeping parent would otherwise sprout an active sub-terminal
          // `TerminalContent` hides behind the dormant body, and copy/screenshot
          // would hit a PTY-less tile. Sleep/Wake/Close/theme/intent above stay on
          // both arms (they touch persisted fields, not a live PTY).
          ...(activeArm(deps.activeMeta())
            ? [
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
                // "Recent agents" — surfaces agent CLIs the user has previously
                // run in any kolu terminal, auto-detected via the preexec OSC
                // 633;E command mark. Prefills into the active PTY, so it needs a
                // live terminal as well as a seen agent.
                ...(recentAgents().length > 0
                  ? [
                      {
                        kind: "group" as const,
                        name: "Recent agents",
                        section: "active-terminal" as const,
                        description:
                          "Prefill an agent CLI into the active terminal",
                        children: (): PaletteItem[] =>
                          agentItems(
                            recentAgents(),
                            deps.handleRunInActiveTerminal,
                          ),
                      },
                    ]
                  : []),
              ]
            : []),
          // Theme is a per-active-terminal property (padi's `chrome.setTheme`
          // takes a terminal id), so both the drill-in chooser and the
          // shuffle action live alongside the other active-terminal
          // commands rather than in a global "Appearance" bucket.
          themePaletteGroup(
            availableThemes.map((theme) => theme.name),
            deps,
          ),
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
        ]
      : []),

    // --- UI (panel/dock visibility) ---
    // Dock visibility is global UI chrome; the right-panel toggle flips the
    // ACTIVE terminal's per-terminal `collapsed` bit (the panel follows the
    // terminal, #959) — the command is still gated on there being a terminal.
    // Hide "Toggle right panel" on an empty workspace: with no terminals the
    // panel host is unmounted (App's `showEmpty`) and `togglePanel()`
    // early-returns, so the command would close the palette and do nothing —
    // exactly the "offering a command that does nothing surfaces as broken"
    // case the canvas-arrange gate above avoids. The header button is disabled
    // for the same reason.
    ...(tileStore.tileCount() > 0
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
        // The state-backup rings (#1658) — the palette flattens leaves, so
        // typing "restore"/"backup" finds it without walking the group.
        {
          kind: "action",
          name: "Restore state from backup",
          description: "Browse the state-backup rings and restore a snapshot",
          onSelect: () => stateBackupsDialog.openDialog(),
        },
        // Restart kaval — recycle the terminal daemon, capturing the session
        // first and offering it for restore on the fresh daemon (B3.2). The
        // kaval rail dialog and the degraded canvas are the primary,
        // state-contextual surfaces; this is the keyboard/search path (the
        // palette flattens leaves, so typing "restart"/"kaval" finds it).
        // Offered as a TOTAL FUNCTION of the active kaval's presence sum
        // ({@link offerRestartVerb}, the same fold the dialog action slot reads):
        // hidden while `warming` (a restart in flight / booting — a no-op), on a
        // PROVEN contract skew (`incompatible` — a restart respawns the same binary;
        // the skew card's "Update & restart kaval" is the recovery), AND over an
        // `unknown`/dead channel (#1793 affordance axis — the palette must not offer
        // an action the channel can't carry out). Reads `activeKavalPresence()` — the
        // ONE named fold the dialog's action slot also reads — so the two surfaces
        // can't disagree by construction. (The button's `restartInFlight()` additionally
        // folds a local-click signal the palette has no access to; the server's
        // restart coalescer backstops the click-but-not-yet-warming race.)
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
        // Spatial-canvas action — hidden off the canvas (mobile / narrow),
        // where the handler would no-op and the command would surface as
        // broken (same gate as the Canvas section's spatial actions above).
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
    },
  ]);
}
