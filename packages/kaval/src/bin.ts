/**
 * The `kaval` executable — the standalone PTY daemon's entry point.
 *
 * kaval stands watch over your terminals: it owns the node-pty children, mirrors
 * their screens, serves the taps and `ptyHostSurface` over a unix socket, and
 * outlives the clients that dial it (kaval-tui today; kolu-server from B2). Run
 * it on a box where kolu has never been installed and drive it with kaval-tui —
 * a tmux/zellij-shaped pair, minus the multiplexer's session model.
 *
 *   kaval                  serve at $XDG_RUNTIME_DIR/kaval/pty-host.sock
 *   kaval --socket PATH    serve at an explicit path (gate + rcDir sit beside it)
 *
 * This file is the executable, never an import target — it runs the daemon on
 * load. The bin maps the daemon's `DaemonExit` to a process exit code; the
 * lifecycle itself (gate → serve → teardown) is the testable `runKavalDaemon`.
 */

import { parseArgs } from "node:util";
import { daemonExitCode, type Logger } from "@kolu/surface-daemon";
import { runKavalDaemon } from "./daemonMain.ts";

const USAGE = `kaval — the standalone PTY daemon

Usage:
  kaval [--socket PATH]

Options:
  --socket PATH   unix socket to serve on
                  (default: $XDG_RUNTIME_DIR/kaval/pty-host.sock on systemd
                  Linux, else /tmp/kaval-$UID/pty-host.sock). The single-instance
                  gate and per-PTY init-file dir sit beside it.
  -h, --help      show this help

Drive a running kaval with \`kaval-tui list | snapshot <id> | attach <id>\`.`;

/** A minimal structured operator logger — one JSON line per event to stderr,
 *  matching the spine's `(obj, msg)` `Logger` shape. stdout stays clean for any
 *  future machine-readable daemon output. */
function stderrLogger(): Logger {
  const emit =
    (level: string) =>
    (obj: Record<string, unknown>, msg: string): void => {
      const line = JSON.stringify({ ...obj, level, msg });
      process.stderr.write(`${line}\n`);
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

const { values } = parseArgs({
  options: {
    socket: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

runKavalDaemon({ socketOverride: values.socket, log: stderrLogger() })
  .then((exit) => {
    // The success/failure classification lives with `DaemonExit` in the spine
    // (`already-running`/`shutdown` → 0, `serve-failed` → 1), so a new variant
    // is reclassified once at the type's home, not re-decided in every bin.
    process.exit(daemonExitCode(exit));
  })
  .catch((err: unknown) => {
    process.stderr.write(`kaval: ${(err as Error).message}\n`);
    process.exit(1);
  });
