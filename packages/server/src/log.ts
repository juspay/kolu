/** Pino logger — JSON in production, pretty-printed in development.
 *
 * Default level is `info`. Override via `LOG_LEVEL` env var (e.g. `debug`,
 * `warn`, `trace`). The CLI's `--verbose` flag is a hard override applied
 * after construction in `index.ts` and trumps both.
 *
 * Every log line carries `serverId` (the randomUUID from `hostname.ts`) so
 * post-mortem log grepping can pin a line to a specific process run — the
 * diag dir name is `YYYYMMDDTHHMMSS-$$` but ties back to the serverId logged
 * at startup.
 *
 * **Stdio-agent mode** (`kolu --stdio`): stdout is reserved for the oRPC
 * protocol channel. When `--stdio` is in argv, this module forces every
 * pino write to fd 2 at module load — before any other import-time log
 * call. Pino-pretty is dropped too: the parent forwards remote stderr
 * tagged with `[host:<host> remote]`, machine-parseable JSON survives
 * the round-trip better than ANSI-coloured pretty output, and pretty's
 * transport worker thread adds startup latency to the cold-realisation
 * critical path. Lesson #4. */
import pino, { type Logger } from "pino";
import { serverHostname, serverProcessId } from "./hostname.ts";

const level = process.env.LOG_LEVEL ?? "info";
const base = {
  pid: process.pid,
  hostname: serverHostname,
  serverId: serverProcessId,
};

/** True when this process is the stdio agent (`kolu --stdio`). Read at
 *  module load so the logger destination can be decided before any
 *  import-time log call fires. Exported so `index.ts` reuses the same
 *  decision (no second `process.argv.includes(...)` site to drift). */
export const isStdioAgent = process.argv.includes("--stdio");

export const log: Logger = isStdioAgent
  ? pino({ level, base }, pino.destination({ dest: 2, sync: true }))
  : pino(
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
