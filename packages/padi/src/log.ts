/** `@kolu/padi` logger — the daemon's OWN pino logger (the node-only side,
 *  beside the browser-safe `./surface`).
 *
 *  Mirrors kolu-server's `log.ts` config (level via `LOG_LEVEL`, pretty-printed
 *  in dev, JSON in production) but is deliberately IDENTITY-FREE: it does NOT
 *  import kolu-server's `hostname.ts` for a `serverHostname`/`serverId` base, so
 *  the dependency arrow points `@kolu/padi → pino`, never back into
 *  `packages/server`.
 *
 *  Two log modes, encoded STRUCTURALLY (no env knob): every importer defaults to
 *  the stdout logger, and ONLY the daemon entrypoint ({@link configureDaemonLog},
 *  called by `runPadiDaemon`) reconfigures to the daemon multistream — the rolled
 *  file AND stderr together. The `--stdio` front, kolu-server's transitive import
 *  of padi domain modules, and any test that doesn't boot the daemon never run
 *  that entrypoint, so they never spawn a file worker; a test that DOES boot the
 *  daemon writes into its own private per-worker state root (harmless). */
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

/** The DAEMON logger: a pino MULTISTREAM — the size-capped rolled FILE (`pino-roll`, 10MB × 3
 *  kept generations, the pino-family rolling transport) AND stderr, together (P0). So a
 *  foreground dev run stays visible, a parent that captures stderr (journald under systemd, or
 *  a detached daemon's crash-catcher file wired by the spawn spine) still works, and every
 *  daemon leaves a bounded, readable file instead of `/dev/null`. Fails LOUD at boot if the
 *  state root is unwritable — never a silently log-less daemon.
 *
 *  `stateRoot` is required (the already-resolved bind path) so this never re-resolves
 *  ambiently after #1334 removed the silent default from {@link padiLogPath}. */
function buildDaemonLogger(stateRoot: string): Logger {
  const file = padiLogPath(stateRoot);
  // Fail-fast writability probe (synchronous, so an unwritable state root crashes the boot
  // loudly rather than the pino-roll worker failing async and the daemon logging nowhere).
  // `mode: 0o700` keeps a freshly-created state root owner-only (consistent with the daemon's
  // other private dirs; a bare mkdir under umask 022 would be 0755).
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  closeSync(openSync(file, "a", 0o600)); // owner-only probe file (the dir is 0700 too)
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

/** Reconfigure padi's logs for a DAEMON boot — the rolled file + stderr multistream. Called
 *  UNCONDITIONALLY by the daemon entrypoint (`runPadiDaemon`) AFTER the state-root is
 *  resolved; because EVERY spawn path runs that same entrypoint, no spawn path can forget
 *  it and silently discard logs. Idempotent. */
export function configureDaemonLog(stateRoot: string): void {
  active = buildDaemonLogger(stateRoot);
}

/** A stable handle forwarding to the ACTIVE logger, so {@link configureDaemonLog} can swap the
 *  destination at daemon boot without every `log.*` call site re-importing. */
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
