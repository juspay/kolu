/**
 * osfacts-client — the TypeScript face of the osfacts binary.
 *
 * Zero kolu imports. Zero npm runtime dependencies. The binary's contract
 * only: spawn at a path you supply, refuse a schema version you do not speak,
 * parse typed process, listener, unreadable, and source-error rows, and name
 * the facets a given ask can be answered with. Classification, fold, and
 * blindness policy are the consumer's (kolu/padi today; drishti next).
 *
 * The spawn functions are named `<verb><Scope>`, after the binary's own verbs.
 * `snapshotSubtree`, `snapshotPids`, and `snapshotHost` are the three scopes of
 * the `snapshot` verb — processes and sockets — and differ only in which pids
 * they ask about; `snapshotHost` is therefore "every process on this host", not
 * "how the host is doing". `host` is the scopeless `host` verb: machine
 * telemetry, no pids at all. They return different types (`SnapshotReading` vs
 * `HostReading`), so reaching for the wrong one is a type error rather than an
 * empty array.
 */

export {
  OSFACTS_FORMAT_VERSION,
  OSFACTS_COMMAND_TIMEOUT_MS,
  OsfactsClientError,
  type ProcessRow,
  type MemoryRow,
  type StartTimeRow,
  type ProcessCpuTimeRow,
  type ProcessUidRow,
  type ProcessCwdRow,
  type ProcessStatusRow,
  type ProcessArgvRow,
  type ListenerRow,
  UNREADABLE_FACETS,
  type UnreadableFacet,
  type UnreadableRow,
  SNAPSHOT_SOURCE_FACETS,
  type SnapshotSourceFacet,
  type SnapshotSourceErrorRow,
  HOST_SOURCE_FACETS,
  type HostSourceFacet,
  type HostSourceErrorRow,
  type LoadRow,
  type HostMemoryRow,
  type SwapRow,
  type CpuRow,
  type NetworkRow,
  type DiskRow,
  type SnapshotFacets,
  type HostFacets,
  type SnapshotReading,
  type HostReading,
  emptySnapshotReading,
  snapshotFacetNames,
  parseSnapshotOutput,
  parseHostOutput,
  snapshotSubtree,
  snapshotHost,
  snapshotPids,
  snapshotPidsSync,
  bakedOsFactsBin,
  processIdentity,
  processIdentityAsync,
  processIdentityFromEnv,
  processIdentityFromEnvAsync,
  host,
} from "./client.ts";
