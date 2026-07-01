/**
 * The {@link PadiBackings} kolu-server injects into `@kolu/padi`'s in-process
 * assembly (the padi plan of record, PR #1649). W1.1 keeps every member backing
 * in `packages/server` and wires it through here; each op mirrors today's
 * `terminal.*` root-oRPC handler so `padiSurface` serves byte-identical
 * behaviour. W1.2–W1.8 progressively move these backings' code into `@kolu/padi`,
 * shrinking this file until the W1.8 seal degenerates to the package boundary.
 */

import type { PadiBackings } from "@kolu/padi/assembly";
import { LOCAL_LOCATION, type TerminalId } from "kolu-common/surface";
import { log } from "./log.ts";
import {
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
import { getSavedSession, saveSession } from "./session.ts";
import {
  getActiveTerminal,
  getTerminal,
  registryMap,
  requireActiveTerminal,
  terminalNotFound,
} from "./terminal-registry.ts";
import {
  discardLocalSleeping,
  seedSleepingTerminal,
  wakeLocalTerminal,
} from "./terminalEndpoint/local.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
import {
  createTerminal,
  killAllTerminals,
  killTerminal,
  setActiveTerminalId,
  setCanvasLayout,
  setRightPanelState,
  setSubPanelState,
  setTerminalIntent,
  setTerminalParent,
  setTerminalTheme,
  sleepTerminal,
} from "./terminals.ts";
import { saveTerminalFile } from "./terminalScratch.ts";
import { exportTranscriptHtml } from "./transcriptExport.ts";

// The in-process (local) endpoint — the fs/git face `padiSurface`'s fs/git/
// watcher members read, resolved through the one `HostLocation` seam.
const localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION);

/** Throw the typed NOT_FOUND if a terminal is absent — the chrome setters' guard
 *  (mirrors router.ts's `requireTerminal`). */
function requireExists(id: TerminalId): void {
  if (!getTerminal(id)) throw terminalNotFound(id);
}

export const padiBackings: PadiBackings = {
  log,
  endpoint: localEndpoint,

  // ── registry projections (raw halves) ──
  readRegistry: () =>
    registryMap((t) => ({ meta: t.meta, snapshot: t.snapshot })),
  readRegistryEntry: (id) => {
    const entry = getTerminal(id);
    return entry ? { meta: entry.meta, snapshot: entry.snapshot } : undefined;
  },
  readDaemonStatuses: () => readDaemonStatuses(),
  readDaemonStatus: (id) => readDaemonStatus(id),

  // ── lifecycle ──
  createTerminal: (input) => {
    // A sub-terminal must hang off a LIVE parent (F3) — the same live-PTY narrow
    // `terminal.create` uses; a sleeping/absent id is "not found".
    if (input.parentId !== undefined) requireActiveTerminal(input.parentId);
    return createTerminal(input.cwd, input.parentId, {
      themeName: input.themeName,
      canvasLayout: input.canvasLayout,
      subPanel: input.subPanel,
      rightPanel: input.rightPanel,
      intent: input.intent,
    });
  },
  killTerminal: async (id) => {
    const info = await killTerminal(id);
    if (!info) throw terminalNotFound(id);
    return info;
  },
  killAllTerminals: () => killAllTerminals(),
  sleepTerminal: (id) => sleepTerminal(id),
  wakeTerminal: (id) => {
    const info = wakeLocalTerminal(id);
    if (!info) throw terminalNotFound(id);
    return info;
  },
  discardSleeping: (id) => {
    discardLocalSleeping(id);
  },
  restoreSleeping: (record) => {
    seedSleepingTerminal(record);
  },
  // Fire-and-forget stream ops: quiet-drop for a terminal killed mid-stream (an
  // expected race, not a fault — #1628), matching the root handlers.
  resize: (id, cols, rows) => getActiveTerminal(id)?.handle.resize(cols, rows),
  sendInput: (id, data) => getActiveTerminal(id)?.handle.write(data),

  // ── chrome ──
  setTheme: (id, themeName) => {
    requireExists(id);
    setTerminalTheme(id, themeName);
  },
  setIntent: (id, intent) => {
    requireExists(id);
    setTerminalIntent(id, intent);
  },
  setParent: (id, parentId) => {
    requireExists(id);
    setTerminalParent(id, parentId);
  },
  setActive: (id) => setActiveTerminalId(id),
  setCanvasLayout: (id, layout) => {
    requireExists(id);
    setCanvasLayout(id, layout);
  },
  setSubPanel: (id, state) => {
    requireExists(id);
    setSubPanelState(id, state);
  },
  setRightPanel: (id, state) => {
    requireExists(id);
    setRightPanelState(id, state);
  },

  // ── screen + attach + exit ──
  screenState: (id) => requireActiveTerminal(id).handle.getScreenState(),
  screenText: (id, startLine, endLine) =>
    requireActiveTerminal(id).handle.getScreenText(startLine, endLine),
  attach: (id, signal) => {
    // Resolve by the terminal's OWN location so a remote tile's attach reaches
    // its host (R9.2); local today.
    const entry = requireActiveTerminal(id);
    return resolveTerminalEndpoint(entry.meta.location).attach(id, signal);
  },
  assertTerminalExists: (id) => requireExists(id),

  // ── bytes ──
  saveTerminalFile: (id, name, data) => saveTerminalFile(id, name, data),

  // ── transcript ──
  exportTranscriptHtml: (id, mode) => exportTranscriptHtml(id, mode),

  // ── session ──
  getSavedSession: () => getSavedSession(),
  setSavedSession: (session) =>
    saveSession({
      terminals: session.terminals,
      activeTerminalId: session.activeTerminalId ?? null,
    }),
};
