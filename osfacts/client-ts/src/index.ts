/**
 * osfacts-client — the TypeScript face of the osfacts binary.
 *
 * Zero kolu imports. Zero npm runtime dependencies. The binary's contract
 * only: spawn at a path you supply, refuse a schema version you do not speak,
 * parse typed P/L/U rows. Classification, fold, and blindness policy are the
 * consumer's (kolu/padi today; drishti next).
 */

export {
  OSFACTS_FORMAT_VERSION,
  OSFACTS_COMMAND_TIMEOUT_MS,
  OsfactsClientError,
  type ProcessRow,
  type ListenerRow,
  type UnreadableRow,
  type OsfactsReading,
  parseOsfactsOutput,
  snapshotSubtree,
  snapshotPids,
  isTcpPort,
} from "./client.ts";
