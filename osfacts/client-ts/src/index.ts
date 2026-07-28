/**
 * osfacts-client — the TypeScript face of the osfacts binary.
 *
 * Zero kolu imports. Zero npm runtime dependencies. The binary's contract
 * only: spawn at a path you supply, refuse a schema version you do not speak,
 * parse typed process, listener, unreadable, and source-error rows.
 * Classification, fold, and blindness policy are the
 * consumer's (kolu/padi today; drishti next).
 */

export {
  OSFACTS_FORMAT_VERSION,
  OSFACTS_COMMAND_TIMEOUT_MS,
  OsfactsClientError,
  type ProcessRow,
  type ProcessIdentity,
  type MemoryRow,
  type StartTimeRow,
  type ProcessCpuTimeRow,
  type ProcessUidRow,
  type ProcessCwdRow,
  type ProcessStatusRow,
  type ProcessArgvRow,
  type ListenerRow,
  type UnreadableFacet,
  type UnreadableRow,
  type SourceErrorRow,
  type SnapshotFacets,
  type HostFacets,
  type OsfactsReading,
  parseOsfactsOutput,
  processIdentity,
  snapshotSubtree,
  snapshotHost,
  snapshotPids,
  snapshotPidsSync,
  host,
  isTcpPort,
} from "./client.ts";
