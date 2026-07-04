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
import { padiLogPath } from "./stateRoot.ts";

const level = process.env.LOG_LEVEL ?? "info";
const base = { pid: process.pid };
const prod = process.env.NODE_ENV === "production";

const prettyTarget = {
  target: "pino-pretty",
  level,
  options: { colorize: true, singleLine: true },
};

/** The DEFAULT logger: pretty in dev, JSON→stdout in prod. Used by every importer that is
 *  NOT the durable daemon — the `--stdio` front, kolu-server's in-process assembly, and the
 *  tests — so importing this module never spawns a file-writing worker against a real
 *  state-root path. */
function buildDefaultLogger(): Logger {
  return pino(
    prod ? { level, base } : { level, base, transport: prettyTarget },
  );
}

/** The DURABLE-DAEMON logger: routes the pino stream through `pino-roll` (P0) to a
 *  DETERMINISTIC, SIZE-CAPPED file under padi's state root ({@link padiLogPath}) — 10MB × 3
 *  kept generations, the pino-family rolling transport (never a hand-rolled rotation). The
 *  PRIMARY bounded log, so a padi that OUTLIVES the parent that spawned it (an ssh front, a
 *  kolu-server) still leaves a readable, bounded log instead of a stdout that went to
 *  /dev/null. Dev also keeps pretty stdout. The raw-stderr crash-catcher (native errors /
 *  unhandled-rejection stacks pino can't see) is the SEPARATE `padi.stderr.log` the spawn
 *  spine captures, bounded by truncate-on-boot. */
function buildDaemonLogger(): Logger {
  const roll = {
    target: "pino-roll",
    level,
    options: {
      file: padiLogPath(),
      size: "10m",
      limit: { count: 3 },
      mkdir: true,
    },
  };
  return pino({
    level,
    base,
    transport: { targets: prod ? [roll] : [roll, prettyTarget] },
  });
}

// The durable daemon (and ONLY it) sets `KOLU_PADI_DAEMON_LOG=1` when it spawns — the
// `--stdio` front sets it in the detached child's env, `daemonEnv` sets it on the local
// systemd/detached spawn. Gating on it (not merely on "am I a padi process") keeps the file
// worker OUT of tests, the front, and in-process assembly, which get the default logger.
export const log =
  process.env.KOLU_PADI_DAEMON_LOG === "1"
    ? buildDaemonLogger()
    : buildDefaultLogger();

export type { Logger };
