/** Minimal structured-logging contract — the single authoritative `Logger`
 *  shape for the whole workspace.
 *
 *  This package exists to be a **leaf-safe home** for the type: it has zero
 *  runtime dependencies and zero `kolu-*` dependencies, so even packages that
 *  deliberately avoid depending on `kolu-shared` (e.g. `kolu-io`, which is a
 *  zero-`kolu-*`-deps leaf) can import the same `Logger` instead of
 *  re-declaring a byte-identical private copy. Depending on a types-only,
 *  zero-runtime-dependency package adds no weight and no transitive deps —
 *  that is the whole point of carving it out.
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
