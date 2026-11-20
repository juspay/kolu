/** Structurally compatible with [pino](https://getpino.io)'s child loggers —
 *  pass `pinoLogger.child({...})` directly anywhere a `Logger` is expected,
 *  no adapter needed. */
export type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};
