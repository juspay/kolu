/**
 * osfacts-client — the TypeScript face of the osfacts binary.
 *
 * Zero kolu imports. Zero npm runtime dependencies. The binary's contract
 * only: spawn at a path you supply, refuse a schema version you do not speak,
 * parse typed process, listener, unreadable, and source-error rows, and name
 * the facets a given ask can be answered with. Classification and blindness
 * policy are the consumer's (kolu/padi today; drishti next).
 *
 * The exception, and it is a deliberate one: where a verb's reading has ONE
 * honest domain answer that every consumer would otherwise hand-write the same
 * way, the fold ships here beside the parser — `processIdentity*` over the
 * start-time reading, `osfactsSocketHolders` / `foldSocketOccupancy` over
 * the holder reading. Both keep an "absent" arm that must never collapse into
 * the others, which is exactly the mistake a per-consumer copy makes.
 *
 * The spawn functions are named `<verb><Scope>`, after the binary's own verbs.
 * `snapshotSubtree`, `snapshotPids`, and `snapshotHost` are the three scopes of
 * the `snapshot` verb — processes and sockets — and differ only in which pids
 * they ask about; `snapshotHost` is therefore "every process on this host", not
 * "how the host is doing". `socketHolders` is the `socket-holders` verb, whose
 * scope is a socket PATH rather than a pid set. `host` is the scopeless `host`
 * verb: machine telemetry, no pids at all. They return different types
 * (`SnapshotReading` vs `SocketHoldersReading` vs `HostReading`), so reaching
 * for the wrong one is a type error rather than an empty array.
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
  SOCKET_HOLDERS_SOURCE_FACETS,
  type SocketHoldersSourceFacet,
  type SocketHoldersSourceErrorRow,
  type SocketHolderRow,
  type SocketHoldersReading,
  type SocketHolder,
  type SocketOccupancy,
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
  parseSocketHoldersOutput,
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
  socketHolders,
  foldSocketOccupancy,
  osfactsSocketHolders,
  host,
} from "./client.ts";
