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

// ── injected conf stores (session + activityFeed) ───────────────────────
// kolu-server boot injects the real `confStore`-backed stores here BEFORE serving
// (padi does not import packages/server; the STORAGE stays kolu-server's source of
// truth until W2.2). The `requireX` getters stay padi-internal.
export {
  setPadiActivityFeedStore,
  setPadiLastPairedDaemonStore,
  setPadiSessionStore,
} from "./confStores.ts";
// The persisted survivor pairing's type — kolu-server builds the conf-backed store
// for it (`surface.ts`) and injects it via `setPadiLastPairedDaemonStore`. The
// pairing is READ + RECORDED entirely inside padi's boot reconcile.
export type { PairedDaemon } from "./pairedDaemon.ts";
// ── scratch / roots ─────────────────────────────────────────────────────
export {
  ensureKoluRoot,
  setKoluServerProcessId,
  shutdownCleanup,
} from "./koluRoot.ts";
export {
  __resetPadiSurfaceCtxForTest,
  padiSurfaceCtx,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
// The range-capable serve-dir read kolu-server's re-backed Hono preview route
// calls — the STREAMING form (`previewFile`, bounded heap), the same read
// `preview.read` serves through its base64 wire-wrapper (`readPreview`).
export { previewFile } from "./preview.ts";
export {
  publishDaemonStatus,
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
// ── kaval supervision ───────────────────────────────────────────────────
export {
  ensureLocalEndpoint,
  LOCAL_HOST_ID,
  ptyHostClient,
  setSpawnServerVersion,
} from "./ptyHost/index.ts";
export { restartLocalDaemon } from "./ptyHost/restartLocal.ts";
// ── publisher / surface ctx holder ──────────────────────────────────────
export {
  publisher,
  publisherSize,
  terminalsDirtyChannel,
} from "./publisher.ts";

// ── native serving (W1.R0) ──────────────────────────────────────────────
export { buildPadiSurfaceDeps } from "./servePadi.ts";
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
export type {
  ActiveTerminalProcess,
  TerminalProcess,
} from "./terminal-registry.ts";
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
export { startInventoryReconciler } from "./terminalEndpoint/inventoryReconcile.ts";
// ── endpoint bindings ───────────────────────────────────────────────────
export {
  discardLocalParked,
  discardLocalSleeping,
  seedParkedTerminal,
  seedSleepingTerminal,
  wakeLocalTerminal,
} from "./terminalEndpoint/local.ts";
export {
  adoptSurvivingSession,
  parkSavedSession,
} from "./terminalEndpoint/reattach.ts";
export { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
export { saveTerminalFile } from "./terminalScratch.ts";
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
