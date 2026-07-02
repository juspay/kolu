/** `@kolu/padi` logger — the daemon's OWN pino logger (the node-only side,
 *  beside the browser-safe `./surface`).
 *
 *  Mirrors kolu-server's `log.ts` config (level via `LOG_LEVEL`, pretty-printed
 *  in dev, JSON in production) but is deliberately IDENTITY-FREE: it does NOT
 *  import kolu-server's `hostname.ts` for a `serverHostname`/`serverId` base, so
 *  the dependency arrow points `@kolu/padi → pino`, never back into
 *  `packages/server`. In W1 padi is assembled in-process by kolu-server, so this
 *  logs to the same stdout beside the server's own logger; W2.2 gives padi its
 *  own process and this becomes its sole logger (`package = process = staleKey`).
 *  The `pid` base is the process id — identical to the server's while in-process. */
import pino, { type Logger } from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const base = { pid: process.pid };

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
