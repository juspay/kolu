/**
 * The `padi` executable — the per-host terminal-workspace daemon's entry point.
 *
 * padi is the workspace authority for one host: it supervises that host's kaval
 * (owning its PTYs), composes the terminal registry, folds awareness on the
 * host's clock, persists the session under its state-root, and serves it all as
 * one surface (`padiSurface`) plus the frozen control core over a unix socket.
 * kolu-server binds it (from the W2.2 cutover); kaval-tui and a future padi-tui
 * reach the kaval and padi it stands up.
 *
 *   padi                          serve at $XDG_RUNTIME_DIR/padi-<digest>/padi.sock,
 *                                 anchored to the binary's default state-root
 *   padi --state-root PATH        anchor to an explicit state-root (dev/e2e); the
 *                                 digest (and so the socket + its kaval) follow it
 *   padi --socket PATH            serve at an explicit socket (gate sits beside it)
 *
 * This file is the executable, never an import target — it runs the daemon on
 * load. The bin maps the daemon's `DaemonExit` to a process exit code; the
 * lifecycle itself (state-root → adopt kaval → serve → teardown) is the testable
 * `runPadiDaemon`.
 */

import { parseArgs } from "node:util";
import { daemonExitCode, type Logger } from "@kolu/surface-daemon";
import { runPadiDaemon } from "./daemonMain.ts";

const USAGE = `padi — the per-host terminal-workspace daemon

Usage:
  padi [--state-root PATH] [--socket PATH]

Options:
  --state-root PATH   the persistent folder padi anchors to (session · memory ·
                      pairing). Default: $XDG_STATE_HOME/padi (else
                      ~/.local/state/padi). The socket + its kaval are keyed by a
                      digest of this path, so a distinct state-root is a distinct,
                      isolated padi.
  --socket PATH       unix socket to serve on (default: keyed by the state-root
                      digest). The single-instance gate sits beside it.
  --allow-nix-shell-with-env-whitelist LIST
                      forward a Nix-devshell env whitelist to PTY spawns (matches
                      kolu-server's flag), comma-separated.
  -h, --help          show this help

Bind a running padi from kolu-server, or drive its kaval with \`kaval-tui\`.`;

/** A minimal structured operator logger — one JSON line per event to stderr,
 *  matching the spine's `(obj, msg)` `Logger` shape. stdout stays clean. */
function stderrLogger(): Logger {
  const emit =
    (level: string) =>
    (obj: Record<string, unknown>, msg: string): void => {
      process.stderr.write(`${JSON.stringify({ ...obj, level, msg })}\n`);
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
    "state-root": { type: "string" },
    socket: { type: "string" },
    "allow-nix-shell-with-env-whitelist": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

runPadiDaemon({
  stateRoot: values["state-root"],
  socketOverride: values.socket,
  nixShellWhitelist: values["allow-nix-shell-with-env-whitelist"],
  log: stderrLogger(),
})
  .then((exit) => {
    // The success/failure classification lives with `DaemonExit` in the spine
    // (`already-running`/`shutdown` → 0, `serve-failed` → 1), reclassified once at
    // the type's home rather than re-decided in every bin.
    process.exit(daemonExitCode(exit));
  })
  .catch((err: unknown) => {
    process.stderr.write(`padi: ${(err as Error).message}\n`);
    process.exit(1);
  });
