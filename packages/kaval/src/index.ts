export {
  currentBuildId,
  currentCommitHash,
  currentPtyHostIdentity,
} from "./buildId.ts";
export {
  createInProcessPtyHost,
  type InProcessPtyHostDeps,
  type PtyHostBoot,
  type PtyHostServed,
  servePtyHost,
} from "./inProcessPtyHost.ts";
export {
  type PtyHostClient,
  ptyHostClientOver,
} from "./ptyHostClient.ts";
export {
  FanOut,
  type SubscriberDropped,
  SubscriberInvalidated,
  SubscriberOverflow,
} from "./fanOut.ts";
export {
  type CommandRunSubscription,
  createPtyHost,
  DEFAULT_MIRROR_SCROLLBACK,
  type ForegroundSample,
  type ForegroundSubscription,
  type InventorySubscription,
  type PtyAttachment,
  type PtyHandle,
  type PtyHistoryChunk,
  type PtyHost,
  type PtyHostOptions,
  type PtyId,
  type PtyListEntry,
  type PtySpawnOpts,
  type PtySpawnResult,
  SNAPSHOT_SCROLLBACK,
  type ScreenExtent,
} from "./ptyHost.ts";
export {
  DEFAULT_SPAWN_SHELL,
  PTY_HOST_CONTRACT_VERSION,
  SCREEN_CELLS_MAX_CELLS,
  SCREEN_CELLS_MAX_ROWS,
  type PtyHostDataMsg,
  type PtyHostForegroundMsg,
  type PtyHostIdentity,
  PtyHostIdentitySchema,
  type PtyHostInitFile,
  type PtyHostInventoryEvent,
  type PtyHostListEntry,
  type PtyHostSpawnInput,
  type PtyHostSpawnResult,
  type PtyHostSurface,
  type PtyHostSystemInfo,
  type PtyHostSystemVersion,
  ptyHostSurface,
  PtyNotFound,
  SpawnArgvEmpty,
} from "./ptyHostSurface.ts";

export {
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "./serveOverSocket.ts";
export {
  kavalControlSurface,
  kavalDaemonGroup,
  type KavalDaemonSurface,
  serveKavalDaemonSurface,
} from "./daemonSurface.ts";
export {
  type KavalCandidateKind,
  type KavalDaemon,
  discoverKavalCandidates,
  discoverKavalDaemons,
  discoverPtyHostSockets,
  getPtyHostSocketPath,
  isPrivateOwnedDir,
  isSocketInode,
  KAVAL_GATE_FILE,
  KAVAL_LOG_FILE,
  KAVAL_NS_PREFIX,
  type KavalSocketCandidate,
  type KavalSocketResolution,
  kavalLogPath,
  legacyKavalSocketPath,
  PTY_HOST_SOCK_FILE,
  readStateRootManifest,
  resolveRunningKavalSocket,
  STATE_ROOT_MANIFEST_FILE,
  writeStateRootManifest,
} from "./socketPath.ts";
export { assertDaemonSpawnAllowed } from "./daemonSpawnGate.ts";
export { kavalConvergencePolicy } from "./convergencePolicy.ts";
export { removeInitFiles, writeInitFiles } from "./initFiles.ts";
