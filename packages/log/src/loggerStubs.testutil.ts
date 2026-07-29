/** Shared structured-logger sinks for tests. Kept on a test-only export so the
 * authoritative {@link Logger} shape and its no-output/collecting fixtures
 * evolve together without adding production runtime behavior. */

import type { Logger } from "./index.ts";

/** Swallow every log line. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Funnel every level's `line` field to one severity-blind test sink. */
export const collectLogger = (onLine: (line: string) => void): Logger => {
  const collect = (obj: Record<string, unknown>): void =>
    onLine(String(obj.line));
  return {
    debug: collect,
    info: collect,
    warn: collect,
    error: collect,
  };
};
