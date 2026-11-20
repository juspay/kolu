import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import pino, { type Logger } from "pino";
import { padiLogPath } from "./stateRoot.ts";

const level = process.env.LOG_LEVEL ?? "info";
const base = { pid: process.pid };
const prod = process.env.NODE_ENV === "production";

function buildDefaultLogger(): Logger {
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

function buildDaemonLogger(stateRoot: string): Logger {
  const file = padiLogPath(stateRoot);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  closeSync(openSync(file, "a", 0o600));
  const roll = {
    target: "pino-roll",
    level,
    options: { file, size: "10m", limit: { count: 3 }, mkdir: true },
  };
  const stderrTarget = prod
    ? { target: "pino/file", level, options: { destination: 2 } }
    : {
        target: "pino-pretty",
        level,
        options: { colorize: true, singleLine: true, destination: 2 },
      };
  return pino({ level, base, transport: { targets: [roll, stderrTarget] } });
}

let active: Logger = buildDefaultLogger();

/** Reconfigure padi's logs for a DAEMON boot — the rolled file + stderr
 *  multistream. Idempotent; throws if `stateRoot` is unwritable rather than
 *  leaving a silently log-less daemon. */
export function configureDaemonLog(stateRoot: string): void {
  active = buildDaemonLogger(stateRoot);
}

export const log: Logger = new Proxy({} as Logger, {
  get(_t, prop) {
    const v = Reflect.get(active as object, prop);
    return typeof v === "function"
      ? (v as (...a: unknown[]) => unknown).bind(active)
      : v;
  },
  set(_t, prop, value) {
    return Reflect.set(active as object, prop, value);
  },
}) as Logger;

export type { Logger };
