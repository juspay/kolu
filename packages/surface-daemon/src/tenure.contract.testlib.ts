/**
 * The fixture ↔ test protocol for the tenure pins, single-sourced so the two
 * sides can't drift (the pattern `peer-server.lifetime.contract.ts`
 * established one package over): the stderr stage markers the fixture emits
 * and the sentinel exit codes that distinguish an ESCAPED throw/rejection
 * from the guarded crash arm's deliberate exit 1. `.testlib.ts` keeps it out
 * of the daemon staleKeys.
 */

/** Stage markers the fixture bin writes to stderr. */
export const MARKER = {
  /** `onReady` fired — socket bound, gate held. */
  listening: "fixture: listening",
  /** The daemon run resolved; the `DaemonExit` kind follows. */
  exitResolved: (kind: string): string => `fixture: exit-resolved=${kind}`,
  /** The bin's resource-release stage ran. */
  releaseRan: "fixture: release-ran",
} as const;

/** Sentinel exit codes armed at fixture boot: an escaped uncaught exception /
 *  unhandled rejection exits with these instead of Node's default (which is
 *  ALSO 1 and would make every `code === 1` pin vacuous). */
export const ESCAPE_EXIT = {
  uncaughtException: 42,
  unhandledRejection: 43,
} as const;
