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
 * the two ids the domain needs (`daemonProcessId`, `serverVersion`) are
 * INJECTED via `setDaemonProcessId` / `setSpawnServerVersion`, not imported.
 */

// The persisted survivor pairing's type. The pairing is READ + RECORDED entirely
// inside padi's boot reconcile (its conf store is set by padi's own `daemonMain`).
export type { PairedDaemon } from "./pairedDaemon.ts";
// ── scratch / roots ─────────────────────────────────────────────────────
export {
  ensureKoluRoot,
  setDaemonProcessId,
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
// ── padi process rendezvous (W2.2 binder) ───────────────────────────────
// kolu-server's padi BINDER (`server/src/padiBinding.ts`) resolves the SAME
// state-root → socket/gate paths padi computes for itself, so the supervisor and
// the daemon never disagree on identity. Re-exported through this barrel so the
// binder reaches the terminal domain only through @kolu/padi's published entry
// points (the package-boundary seal), not a deep `@kolu/padi/stateRoot` import.
export {
  padiGatePath,
  padiSocketPath,
  resolvePadiStateRoot,
} from "./stateRoot.ts";
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
