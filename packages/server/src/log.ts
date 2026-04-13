/** Pino logger — JSON in production, pretty-printed in development.
 *
 * Default level is `info`. Override via `LOG_LEVEL` env var (e.g. `debug`,
 * `warn`, `trace`). The CLI's `--verbose` flag is a hard override applied
 * after construction in `index.ts` and trumps both.
 *
 * Every log line carries `serverId` (the randomUUID from `hostname.ts`) so
 * post-mortem log grepping can pin a line to a specific process run — the
 * diag dir name is `YYYYMMDDTHHMMSS-$$` but ties back to the serverId logged
 * at startup. */
import pino, { type Logger } from "pino";
import { serverHostname, serverProcessId } from "./hostname.ts";

const level = process.env.LOG_LEVEL ?? "info";
const base = {
  pid: process.pid,
  hostname: serverHostname,
  serverId: serverProcessId,
};

export const log = pino(
  process.env.NODE_ENV === "production"
    ? { level, base }
    : {
        level,
        base,
        transport: {
          target: "pino-pretty",
          options: { colorize: true, singleLine: true },
        },
      },
);

export type { Logger };
