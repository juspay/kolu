/**
 * `kolu-daemon` — the pty-host daemon process entry.
 *
 * Thin glue, deliberately OUTSIDE the staleKey's hashed closure: the daemon's
 * behaviour is `runPtyHostDaemon` (hashed, this package); this file only wires
 * it to the process — reads the socket override, runs the serve loop, and turns
 * signals into a clean shutdown. It is the binary the server spawns (detached /
 * `systemd-run`); it keeps running because the socket listener holds the event
 * loop open.
 *
 * It lives in this package (so `daemonEntry.ts` can resolve its path and so it
 * shares the build closure under `tsx`), but it has a top-level `main()`, so
 * `index.ts` must NOT import it — and it is EXCLUDED from the staleKey's hashed
 * set (default.nix's `ptyHostSrc` fileFilter + `buildId.closure.test.ts` skip
 * it, kept in lockstep). The reachable-from-index closure stays equal to the
 * hashed set; this process-entry is glue, not wire/behaviour.
 */
import { configureNixShellEnv } from "kolu-pty";
import pino from "pino";
import pkg from "../package.json" with { type: "json" };
import { runPtyHostDaemon } from "./daemon.ts";

// JSON logging straight to stdout — the daemon's stdout/stderr are redirected to
// a log file next to its socket (the spawn path in @kolu/pty-host-daemon). No
// pino-pretty: the daemon is a background process, not an interactive shell.
const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { pid: process.pid },
});

async function main(): Promise<void> {
  // The daemon owns shell-env preparation (cleanEnv runs here), so it must
  // apply the SAME nix-shell filter the server does, or the devshell env leaks
  // into terminals. The whitelist rides KOLU_NIX_ENV_WHITELIST (see socketEnv).
  // The vars consumed here are part of the daemon's env contract (DAEMON_ENV_KEYS
  // in ./env.ts) — the same list spawn.ts forwards into the systemd unit.
  configureNixShellEnv(process.env.KOLU_NIX_ENV_WHITELIST);
  const socketPath = process.env.KOLU_PTY_HOST_SOCKET || undefined;
  const result = await runPtyHostDaemon({
    socketPath,
    version: pkg.version,
    log,
  });

  if (result.kind === "already-running") {
    log.info(
      { pid: result.pid },
      "another pty-host daemon owns the gate — exiting",
    );
    process.exit(0);
  }
  if (result.kind === "serve-failed") {
    log.error(
      { outcome: result.outcome },
      "pty-host daemon could not bind its socket — exiting",
    );
    process.exit(1);
  }

  const { daemon } = result;
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => {
      daemon.close();
      process.exit(0);
    });
  }
  log.info({ socketPath: daemon.socketPath }, "pty-host daemon ready");
  // No explicit keep-alive: the unix-socket listener holds the event loop open.
}

main().catch((err) => {
  log.error({ err }, "pty-host daemon crashed on startup");
  process.exit(1);
});
