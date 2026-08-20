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
 * Two log modes, encoded STRUCTURALLY (no env knob), mirroring `@kolu/padi`'s
 * `log.ts`: every importer defaults to the stdout logger, and ONLY the server
 * entrypoint ({@link configureServerLog}, called by `bootKoluWeb`) reconfigures
 * to the multistream — the rolled FILE and stdout together. So a unit test that
 * merely imports this module never spawns a file worker. */
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pino, { type Logger } from "pino";
import { serverHostname, serverProcessId } from "./hostname.ts";

const level = process.env.LOG_LEVEL ?? "info";
const base = {
  pid: process.pid,
  hostname: serverHostname,
  serverId: serverProcessId,
};
const prod = process.env.NODE_ENV === "production";

export const KOLU_SERVER_LOG_FILE = "kolu-server.log";

/** kolu-server's structured log BASE path — `<KOLU_STATE_DIR>/kolu-server.log`, beside
 *  the `config.json` that state root already holds. The twin of padi's `padiLogPath`,
 *  and deliberately under the SAME root the rest of the server's durable state uses, so
 *  "where are the logs" has one answer per stack component.
 *
 *  NOTE this is the base, not a file that ever exists: `pino-roll` appends a generation
 *  number, so the lines land in `kolu-server.log.1` and roll onward to `.2`, `.3`. The
 *  docs name the numbered files for that reason — an operator told to read
 *  `kolu-server.log` finds nothing there.
 *
 *  `stateRoot` is the already-validated root from `state.ts` — pure join, never an
 *  ambient re-read of `KOLU_STATE_DIR` (that env var has exactly one reader). */
export function koluServerLogPath(stateRoot: string): string {
  return join(resolve(stateRoot), KOLU_SERVER_LOG_FILE);
}

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

/** The SERVER logger: a pino MULTISTREAM — the size-capped rolled FILE (`pino-roll`,
 *  10MB × 3 kept generations) AND stdout, together. padi has had this since it became
 *  a daemon; kolu-server never did, and the gap is why juspay/kolu#2183 could not be
 *  attributed: the server's own convergence decision ("stopping live daemon — why",
 *  and the takeover's WARN observation beside it) was written to whatever terminal
 *  `kolu web` happened to be launched from, and died with that terminal. The decision
 *  had always been logged; nothing durable was listening.
 *
 *  stdout stays in the multistream so a foreground run looks exactly as it did, and a
 *  parent that captures stdout (journald under systemd) still gets every line.
 *
 *  Fails LOUD if the state root is unwritable — never a silently log-less server. */
export function serverLogTargets(
  stateRoot: string,
): pino.TransportTargetOptions[] {
  const file = koluServerLogPath(stateRoot);
  const roll = {
    target: "pino-roll",
    level,
    options: {
      file,
      size: "10m",
      // `removeOtherLogFiles` is what makes the cap hold ACROSS RESTARTS. Without it
      // pino-roll prunes only the generations THIS process created, so every restart
      // starts a fresh count and the old ones accumulate untouched — padi, whose
      // config omits it, is sitting on 7 generations (~65MB) against the same
      // `count: 3`. Safe here because the supervisor gate admits one live kolu-server
      // per state root, so there is no sibling process whose logs we could eat.
      limit: { count: 3, removeOtherLogFiles: true },
      mkdir: true,
    },
  };
  const stdoutTarget = prod
    ? { target: "pino/file", level, options: { destination: 1 } }
    : {
        target: "pino-pretty",
        level,
        options: { colorize: true, singleLine: true, destination: 1 },
      };
  return [roll, stdoutTarget];
}

function buildServerLogger(stateRoot: string): Logger {
  // Fail-fast writability probe (synchronous, so an unwritable state root crashes the
  // boot loudly rather than the pino-roll worker failing async and the server logging
  // nowhere). `mode: 0o700` keeps a freshly-created state root owner-only.
  //
  // The probe writes a file it then REMOVES, rather than touching the log path itself.
  // padi's equivalent touches its own `padi.log`, and because pino-roll writes to the
  // NUMBERED generations the untouched base file sits there at zero bytes forever —
  // exactly what an operator opens first, and exactly the wrong answer.
  const file = koluServerLogPath(stateRoot);
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const probe = join(dir, `.${KOLU_SERVER_LOG_FILE}.probe`);
  closeSync(openSync(probe, "w", 0o600));
  rmSync(probe, { force: true });
  return pino({
    level,
    base,
    transport: { targets: serverLogTargets(stateRoot) },
  });
}

let active: Logger = buildDefaultLogger();

/** Reconfigure the server's logs for a real boot — the rolled file + stdout multistream.
 *  Called by `bootKoluWeb` BEFORE anything else, so `--verbose`'s `log.level` override
 *  (applied just after) lands on the logger that survives. Idempotent. */
export function configureServerLog(stateRoot: string): void {
  active = buildServerLogger(stateRoot);
}

/** A stable handle forwarding to the ACTIVE logger, so {@link configureServerLog} can
 *  swap the destination at boot without every `log.*` call site re-importing. */
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
