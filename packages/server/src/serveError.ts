/** Server-bind failure handling.
 *
 * `serve()` from `@hono/node-server` returns the underlying `http.Server`,
 * which emits an `'error'` event when the listen fails (port in use,
 * privileged port, unresolvable host). With no listener Node rethrows, and
 * the rethrow lands in the global `uncaughtException` handler — so a routine
 * "port already in use" reads like an internal crash. This module turns the
 * common bind failures into a one-line, actionable message and a clean exit.
 */
import type { Logger } from "./log.ts";

export interface ServeBindTarget {
  host: string;
  port: number;
}

/** Map a server-bind failure to a human-readable fatal message, or `null`
 * for an unrecognized error (the caller logs the raw error with structured
 * context so nothing diagnostic is lost). */
export function describeServeError(
  err: NodeJS.ErrnoException,
  { host, port }: ServeBindTarget,
): string | null {
  switch (err.code) {
    case "EADDRINUSE":
      return `Port ${port} is already in use — is kolu already running? Try --port <n>.`;
    case "EACCES":
      return `Permission denied binding ${host}:${port} (privileged port?).`;
    default:
      return null;
  }
}

/** Minimal shape of the server returned by `serve()` that we attach to. */
interface ErrorEmitter {
  on(event: "error", listener: (err: NodeJS.ErrnoException) => void): unknown;
}

/** Attach an `error` handler that reports bind failures and exits cleanly.
 * `log`/`exit` are injected so the handler is testable without a real
 * process exit. */
export function attachServeErrorHandler(
  server: ErrorEmitter,
  {
    host,
    port,
    log,
    exit = process.exit,
  }: ServeBindTarget & {
    log: Pick<Logger, "fatal">;
    exit?: (code: number) => void;
  },
): void {
  server.on("error", (err) => {
    const message = describeServeError(err, { host, port });
    if (message) log.fatal(message);
    else log.fatal({ err }, "failed to start server");
    exit(1);
  });
}
