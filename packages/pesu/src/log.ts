/**
 * pesu's logger — a pino instance (the repo's standard, mirroring
 * `@kolu/padi`'s config): pretty single-line in dev, JSON in production, level
 * via `LOG_LEVEL`. stdout only — a foreground `nix run .#pesu` shows it in the
 * terminal and a systemd unit hands stdout to journald, so there's no file
 * rolling to own here.
 *
 * The whole daemon logs through ONE of these, threaded into the webhook, the
 * engine, the Xyne client, and the coordinator driver, so every inbound
 * delivery, every decision, every outbound call, and every error lands in one
 * stream. NEVER log a secret (the signing secret / bearer token) — config reads
 * them and nothing else passes them to a log call.
 */

import pino, { type Logger } from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const prod = process.env.NODE_ENV === "production";

/** Build pesu's logger. `debug` level (`LOG_LEVEL=debug`) adds the per-poll
 *  coordinator-drive trail and every outbound Xyne update; `info` (the default)
 *  is the readable flow — one line per delivery, decision, and turn boundary. */
export function createLogger(): Logger {
  const base = { pid: process.pid };
  return pino(
    prod
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
}

export type { Logger };
