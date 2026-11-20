export {
  padiDigest,
  padiGatePath,
  padiRuntimeHome,
  padiSocketPath,
  resolvePadiStateRoot,
} from "@kolu/padi-client/rendezvous";
export { drainResidentOnAgentToolsBakeDrift } from "./agentToolsBake.ts";
export { currentPadiBuildId } from "./daemonBoot/buildId.ts";
export {
  assembleKavalInventory,
  assemblePadiInventory,
  enumerateHostDaemons,
  type HostDaemonScanDeps,
  type KavalProbe,
  probeKavalStatus,
} from "./hostInventory.ts";
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
export { previewFile } from "./preview.ts";
export {
  publishDaemonStatus,
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
export {
  ensureLocalEndpoint,
  ptyHostClient,
  setSpawnServerVersion,
} from "./ptyHost/index.ts";
export {
  notifyDirty,
  publisher,
  publisherSize,
  terminalsDirtyChannel,
} from "./publisher.ts";
export { buildPadiSurfaceDeps } from "./servePadi.ts";
export {
  cancelPendingAutosave,
  freezeAutosave,
  initAutosaveGate,
  unfreezeAutosave,
} from "./session/autosaveGate.ts";
export type { PairedDaemon } from "./session/pairedDaemon.ts";
export {
  clearSavedSession,
  getSavedSession,
  saveSession,
  setSavedSession,
  setSavedSessionFromSnapshot,
} from "./session/session.ts";
export {
  discoverPadiDaemons,
  type PadiDaemon,
  padiKavalHome,
  padiKavalSocketPath,
  padiLogPath,
  padiStderrLogPath,
  residentPadiSocket,
} from "./stateRoot.ts";
export type {
  ActiveTerminalProcess,
  TerminalProcess,
} from "./terminal-registry.ts";
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
