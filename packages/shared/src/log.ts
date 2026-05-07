/** Minimal structured-logging contract.
 *
 *  Structurally compatible with [pino](https://getpino.io)'s child loggers —
 *  pass `pinoLogger.child({...})` directly anywhere a `Logger` is expected,
 *  no adapter needed. If you don't have a logger to plumb through, accept
 *  `Logger | undefined` and call with `log?.info(...)`; the optional chain
 *  handles "logging disabled" without a guard at every site.
 *
 *  Level guidance:
 *    - `debug` for expected-absent conditions (file not found on a fresh machine)
 *    - `info`  for lifecycle events operators care about
 *    - `warn`  for degraded-but-recoverable states (fallback path engaged)
 *    - `error` for actual failures (I/O errors, callback throws, dropped state)
 */
export type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};
