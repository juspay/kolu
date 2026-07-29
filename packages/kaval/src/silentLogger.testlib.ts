import type { Logger } from "@kolu/surface-daemon";

/** Shared no-output logger for kaval unit fixtures. */
export const silentLog: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
