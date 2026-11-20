import type { Logger } from "./index.ts";

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

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
