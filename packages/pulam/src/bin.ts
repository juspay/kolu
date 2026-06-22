/**
 * The `pulam` executable — the standalone terminal-awareness daemon's entry.
 *
 * pulam dials a running kaval, runs the awareness sensors (git · PR · agent ·
 * foreground) for every terminal kaval owns, and serves the result as one
 * `awareness` collection that `pulam-tui` reads. It owns no PTYs and holds no
 * lock — it is ephemeral, recomputing from now on every start.
 *
 *   pulam                      dial the local kaval, serve on pulam's socket
 *   pulam --kaval PATH         dial a kaval at an explicit socket
 *   pulam --socket PATH        serve on an explicit socket path
 *   pulam --stdio [--kaval P]  serve over stdin/stdout (what an ssh dial speaks
 *                              to; not for interactive use)
 *
 * Run it on a box where kaval is running and view it with `pulam-tui`.
 * This file is the executable — it runs the daemon on load, never an import
 * target. stdout is the wire in `--stdio` mode, so ALL logging goes to stderr.
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { runArivuDaemon } from "./daemon.ts";

const USAGE = `pulam — the standalone terminal-awareness daemon

Usage:
  pulam [--kaval PATH] [--socket PATH]
  pulam --stdio [--kaval PATH]

Options:
  --kaval PATH    the kaval pty-host socket to dial (default: the running kaval,
                  discovered — a standalone one, or a kolu-server namespaced by
                  listen port; pass this to pick one when several are up).
  --socket PATH   serve the awareness surface on an explicit socket
                  (default: $XDG_RUNTIME_DIR/pulam/awareness.sock). Ignored
                  with --stdio.
  --stdio         serve over stdin/stdout instead of a socket — the transport
                  an ssh dial speaks to. Not for interactive use.
  -h, --help      show this help

View a running pulam with \`pulam-tui\` (the dashboard) or \`pulam-tui --json\`.`;

const { values } = parseArgs({
  options: {
    kaval: { type: "string" },
    socket: { type: "string" },
    stdio: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

// pino to fd 2 (stderr) — NEVER stdout, which is the protocol channel in
// --stdio mode. Over `--stdio` the daemon's stderr is forwarded to the dialing
// viewer, so it defaults to `warn` there: a viewer (especially the alt-screen
// `pulam-tui fleet` board) wants the daemon SILENT about routine info, not a
// flood of "git watcher installed" lines crossing the wire onto its screen.
// A real fatal still prints (the catch below writes a plain line, level-agnostic),
// and the dial's failure reason is captured regardless. `PULAM_LOG_LEVEL`
// overrides for field debugging; the socket path keeps `info`.
const log = pino(
  { level: process.env.PULAM_LOG_LEVEL ?? (values.stdio ? "warn" : "info") },
  pino.destination(2),
);

runArivuDaemon({
  kavalSocket: values.kaval,
  serve: values.stdio
    ? { kind: "stdio" }
    : { kind: "socket", socketPath: values.socket },
  log,
})
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // A plain, human line on stderr — readable in an `--host` dial's streamed
    // output (and surfaced by `dialAgentOnce` as the dial's failure reason),
    // instead of a pino JSON blob. The structured error (with stack) stays at
    // debug for field debugging (PULAM_LOG_LEVEL=debug).
    process.stderr.write(`pulam: ${msg}\n`);
    log.debug({ err }, "pulam: fatal");
    process.exit(1);
  });
