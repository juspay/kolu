/**
 * `@kolu/padi/assembly` — the NODE-ONLY barrel for the terminal domain that
 * relocated into this package in W1.M (registry · lifecycle · fold + metadata ·
 * endpoint bindings · scratch · session persistence · MRU trackers · kaval
 * supervision). It re-exports exactly the public API kolu-server's staying web
 * shell (`index.ts`, `surface.ts`, `router.ts`) and the staying `session.test.ts`
 * import — the single seam kolu-server serves the domain through until W1.R makes
 * the package serve `padiSurface` itself.
 *
 * Beside the browser-safe `./surface` contract; this side pulls in `node:` and
 * the daemon runtime, so browser consumers must not import it. The dependency
 * arrow points `@kolu/padi → kolu-common`, never back into `packages/server` —
 * the two server ids the domain needs (`serverProcessId`, `serverVersion`) are
 * INJECTED via `setKoluServerProcessId` / `setSpawnServerVersion`, not imported.
 */

// ── registry / lifecycle ────────────────────────────────────────────────
export {
  activeTerminalCount,
  countActiveClaudeSessions,
  getActiveTerminal,
  getTerminal,
  listTerminals,
  registryMap,
  requireActiveTerminal,
  snapshotFor,
  terminalNotFound,
} from "./terminal-registry.ts";
export type {
  ActiveTerminalProcess,
  TerminalProcess,
} from "./terminal-registry.ts";
export {
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
  snapshotSession,
} from "./terminals.ts";

// ── endpoint bindings ───────────────────────────────────────────────────
export {
  discardLocalSleeping,
  seedSleepingTerminal,
  wakeLocalTerminal,
} from "./terminalEndpoint/local.ts";
export { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
export { adoptSurvivingSession } from "./terminalEndpoint/reattach.ts";
export { startInventoryReconciler } from "./terminalEndpoint/inventoryReconcile.ts";

// ── session persistence ─────────────────────────────────────────────────
export {
  cancelPendingAutosave,
  clearSavedSession,
  getSavedSession,
  initSessionAutoSave,
  saveSession,
  setSavedSession,
  setSavedSessionFromSnapshot,
} from "./session.ts";

// ── native serving (W1.R0) ──────────────────────────────────────────────
export { buildPadiSurfaceDeps } from "./servePadi.ts";

// ── publisher / surface ctx holders ─────────────────────────────────────
export {
  publisher,
  publisherSize,
  terminalsDirtyChannel,
} from "./publisher.ts";
export {
  __resetSurfaceCtxForTest,
  setSurfaceCtx,
  surfaceCtx,
} from "./surfaceCtx.ts";
export { setWorkspaceSurfaceCtx } from "./workspaceSurfaceCtx.ts";

// ── scratch / roots ─────────────────────────────────────────────────────
export {
  ensureKoluRoot,
  setKoluServerProcessId,
  shutdownCleanup,
} from "./koluRoot.ts";
export { saveTerminalFile } from "./terminalScratch.ts";

// ── kaval supervision ───────────────────────────────────────────────────
export {
  ensureLocalEndpoint,
  LOCAL_HOST_ID,
  ptyHostClient,
  setSpawnServerVersion,
} from "./ptyHost/index.ts";
export {
  publishDaemonStatus,
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
export { restartLocalDaemon } from "./ptyHost/restartLocal.ts";
